/**
 * `quiet_for_days` ใน `get_workspace_context` — ครึ่งที่ทำได้ของ Phase 1 ข้อ D
 *
 * ของที่ต้องกันไม่ให้เกิดคือสิ่งที่เราเขียนเตือนตัวเองไว้ที่ dis-c6095786 seq 5 ข้อ 3
 * ว่าถ้า server กรองให้เองโดย default ค่า `discussions` เดิมจะเปลี่ยนความหมายจาก
 * "ทั้งหมด" เป็น "เฉพาะที่ยังเคลื่อนไหว" ซึ่งเป็นการเปลี่ยนความหมายของคีย์เดิม
 * ไม่ใช่การเพิ่มคีย์ แล้วจะลาก contract 3 มาโดยไม่มีใครตั้งใจ
 *
 * เทสต์ชุดนี้จึงวัดสองอย่างพอ ๆ กัน คือ **การกรองทำงาน** และ **ไม่กรองเมื่อไม่ได้ขอ**
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";

const TOKEN = "quiet-token-aaaaaaaaaaaaaaaaaaaaaaaaa";
const TEAM = "owner/team-a";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: TOKEN,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

let id = 0;

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${TOKEN}`,
        "x-client-name": TEAM,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (id += 1),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  const text = await response.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const frame = JSON.parse(line ? line.slice(5) : text) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  const payload = frame.result?.content?.[0]?.text;
  if (frame.result?.isError) throw new Error(payload ?? "tool error");
  return JSON.parse(payload ?? "{}") as Record<string, unknown>;
}

interface Context {
  discussions: Array<{ id: string; title: string }>;
  has_more: boolean;
  total_discussions: number;
  quiet_discussions: { threshold_days: number | null; hidden: number };
}

async function context(args: Record<string, unknown> = {}): Promise<Context> {
  return (await callTool("get_workspace_context", args)) as unknown as Context;
}

const DAY = 86_400_000;

/** เลื่อนเวลาของทุกอย่างในกระทู้ให้เก่าลง — ไม่มี tool ไหนทำได้ และไม่ควรมี */
async function backdate(discussionId: string, days: number): Promise<void> {
  const when = new Date(Date.now() - days * DAY).toISOString();
  await env.DB.prepare("UPDATE messages SET created_at = ?1 WHERE discussion_id = ?2")
    .bind(when, discussionId)
    .run();
  await env.DB.prepare("UPDATE discussions SET created_at = ?1 WHERE id = ?2")
    .bind(when, discussionId)
    .run();
}

async function discussion(title: string, body = "ข้อความแรก"): Promise<string> {
  const created = await callTool("create_discussion", { title, body });
  return created.discussion_id as string;
}

beforeEach(async () => {
  await resetDatabase();
});

describe("ไม่ขอ ไม่กรอง", () => {
  it("ไม่ส่งพารามิเตอร์ ได้ครบทุกกระทู้ และบอกว่าไม่ได้กรอง", async () => {
    const quiet = await discussion("กระทู้ที่เงียบไปแล้ว");
    await discussion("กระทู้ที่เพิ่งคุยกัน");
    await backdate(quiet, 60);

    const result = await context();

    expect(result.discussions).toHaveLength(2);
    expect(result.total_discussions).toBe(2);
    // null ไม่ใช่ 0 — "ไม่ได้กรอง" ต้องแยกออกจาก "กรองแล้วไม่มีอะไรโดนซ่อน"
    expect(result.quiet_discussions).toEqual({ threshold_days: null, hidden: 0 });
  });

  it("กรองแล้วไม่มีอะไรเข้าเกณฑ์ ต่างจากไม่ได้กรอง ดูจากผลลัพธ์เดียวได้", async () => {
    await discussion("กระทู้ที่เพิ่งคุยกัน");

    const result = await context({ quiet_for_days: 30 });

    expect(result.discussions).toHaveLength(1);
    expect(result.quiet_discussions).toEqual({ threshold_days: 30, hidden: 0 });
  });
});

describe("ขอแล้วกรอง และบอกเสมอว่าซ่อนไปกี่อัน", () => {
  it("กระทู้ที่เงียบเกินเกณฑ์หายไปจากรายการ แต่ยอดรวมยังนับมันอยู่", async () => {
    const quiet = await discussion("กระทู้ที่เงียบไปแล้ว");
    const active = await discussion("กระทู้ที่เพิ่งคุยกัน");
    await backdate(quiet, 60);

    const result = await context({ quiet_for_days: 30 });

    expect(result.discussions.map((d) => d.id)).toEqual([active]);
    expect(result.quiet_discussions).toEqual({ threshold_days: 30, hidden: 1 });
    // ความหมายของ total_discussions ห้ามเปลี่ยนตามการกรอง
    expect(result.total_discussions).toBe(2);
  });

  it("เกณฑ์ยาวขึ้น กระทู้เดิมกลับมา ไม่ใช่หายถาวร", async () => {
    const quiet = await discussion("กระทู้ที่เงียบไปแล้ว");
    await backdate(quiet, 60);

    expect((await context({ quiet_for_days: 30 })).quiet_discussions.hidden).toBe(1);
    expect((await context({ quiet_for_days: 90 })).quiet_discussions.hidden).toBe(0);
  });

  /**
   * ยอดที่ซ่อนต้องนับของที่ถูกกรองจริง ไม่ใช่เอายอดรวมลบยอดที่คืน เพราะ `limit`
   * ตัดจากรายการเดียวกัน ถ้าลบกันเฉย ๆ กระทู้ที่แค่เกินเพดานจะถูกรายงานว่าเงียบ
   */
  it("เพดาน limit ไม่ทำให้ยอดที่ซ่อนเพี้ยน", async () => {
    await discussion("กระทู้ ก");
    await discussion("กระทู้ ข");
    await discussion("กระทู้ ค");

    const result = await context({ quiet_for_days: 30, limit: 1 });

    expect(result.discussions).toHaveLength(1);
    expect(result.has_more).toBe(true);
    expect(result.quiet_discussions).toEqual({ threshold_days: 30, hidden: 0 });
  });
});

describe("กระทู้ที่ยังไม่มีใครตอบ", () => {
  /**
   * ถ้าใช้เวลาของข้อความล่าสุดอย่างเดียว กระทู้ที่เพิ่งเปิดแล้วยังไม่มีใครตอบจะไม่มี
   * เวลาให้เทียบ แล้วหายไปทันทีที่มีคนกรอง ซึ่งกลับหัวกับสิ่งที่คนกรองอยากได้
   */
  it("เพิ่งเปิดและยังไม่มีข้อความ ยังนับว่าเคลื่อนไหว", async () => {
    await callTool("create_discussion", { title: "กระทู้ที่เพิ่งเปิดและยังเงียบ" });

    const result = await context({ quiet_for_days: 30 });

    expect(result.discussions).toHaveLength(1);
    expect(result.quiet_discussions.hidden).toBe(0);
  });

  it("เปิดไว้นานแล้วยังไม่มีใครตอบ ถือว่าเงียบตามวันที่เปิด", async () => {
    const created = await callTool("create_discussion", { title: "กระทู้ที่เปิดทิ้งไว้" });
    await backdate(created.discussion_id as string, 60);

    const result = await context({ quiet_for_days: 30 });

    expect(result.discussions).toHaveLength(0);
    expect(result.quiet_discussions.hidden).toBe(1);
  });
});
