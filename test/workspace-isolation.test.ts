/**
 * ขอบเขตจริงของ `workspace` — บันทึกไว้เป็นเทสต์ แทนที่จะให้ทุกคนไปไล่โค้ดเอง
 *
 * `CLAUDE.md` เขียนไว้ว่า *workspace เป็นการจัดกลุ่ม ไม่ใช่ขอบเขตความปลอดภัย*
 * แต่ประโยคในเอกสารกับพฤติกรรมของระบบ เป็นคนละเรื่องจนกว่าจะมีของมาวัด — ซึ่งเป็น
 * รูปที่โต๊ะนี้ไล่ปิดกันมาทั้งสัปดาห์ · ไฟล์นี้ทำให้ประโยคนั้นมีของรองรับ
 *
 * **ไฟล์นี้ไม่ได้ห้ามเปลี่ยนพฤติกรรม** · ถ้าวันหนึ่งมีคนเพิ่มการกรองด้วย workspace
 * ให้ tool ที่รับแต่ `id` เทสต์จะแดง แล้วคนแก้ต้องตัดสินใจโดยรู้ตัวว่ากำลังเปลี่ยน
 * สัญญา ไม่ใช่เปลี่ยนโดยไม่มีใครเห็น
 *
 * เขียนขึ้นเพื่อตอบ `task-78d0fc6a` ของ Multi-Agent Lab ที่ถามว่า `ws-bench`
 * ใช้ซ้ำได้ไหมและ isolation ต่อหนึ่งรอบวัดควรเป็นอย่างไร
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";
import { DEFAULT_WORKSPACE } from "../src/env";

const TOKEN = "isolation-token-aaaaaaaaaaaaaaaaaa";
const TEAM = "owner/team-a";
const ALPHA = "ws-alpha";
const BETA = "ws-beta";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: TOKEN,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

let id = 0;

async function raw(name: string, args: Record<string, unknown> = {}) {
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
    error?: { message?: string };
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  // tool ที่ไม่มีอยู่ถูกปฏิเสธที่ชั้น JSON-RPC ส่วน tool ที่มีอยู่แต่ทำไม่ได้ ตอบ
  // ที่ `result.isError` · นับทั้งสองทางเป็น "ไม่สำเร็จ" ไม่งั้นตัวตรวจจะมองข้ามครึ่งหนึ่ง
  return {
    isError: frame.error !== undefined || frame.result?.isError === true,
    payload: frame.error?.message ?? frame.result?.content?.[0]?.text ?? "",
  };
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const { isError, payload } = await raw(name, args);
  if (isError) throw new Error(payload);
  return JSON.parse(payload || "{}");
}

/** ไม่มี tool ไหนสร้าง workspace ได้ — แถวนี้ต้องถูกใส่ด้วยมือเสมอ ซึ่งคือข้อค้นพบหนึ่งของใบ */
async function makeWorkspace(wsId: string): Promise<void> {
  await env.DB.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?1, ?2, ?3)")
    .bind(wsId, wsId, "2026-09-24T00:00:00.000Z")
    .run();
}

beforeEach(async () => {
  await resetDatabase();
  await makeWorkspace(ALPHA);
  await makeWorkspace(BETA);
});

/**
 * ครึ่งที่ `workspace` ทำได้จริง — **รายการ**
 */
describe("การไล่รายการถูกแยกตาม workspace จริง", () => {
  it("ของใน ws หนึ่ง ไม่โผล่ในรายการของอีก ws", async () => {
    const a = await call("create_discussion", { workspace: ALPHA, title: "ของ alpha", body: "x" });
    await call("create_task", { workspace: ALPHA, title: "ใบของ alpha" });
    await call("create_discussion", { workspace: BETA, title: "ของ beta", body: "y" });

    const beta = await call("get_workspace_context", { workspace: BETA, limit: 50 });
    const betaTasks = await call("get_tasks", { workspace: BETA, limit: 50 });

    expect(beta.discussions.map((d: any) => d.id)).not.toContain(a.discussion_id);
    expect(beta.total_discussions).toBe(1);
    expect(betaTasks.total).toBe(0);
  });

  it("workspace ที่ไม่มีอยู่ ตอบว่าไม่พบ ไม่ใช่คืนรายการว่าง", async () => {
    const { isError, payload } = await raw("get_workspace_context", { workspace: "ws-ไม่มีจริง" });

    // `absent` ไม่เท่ากับ `empty` — ผู้อ่านต้องแยก *ไม่มี workspace นี้* ออกจาก
    // *มี workspace นี้แต่ยังไม่มีอะไรในนั้น* ได้จากผลลัพธ์เดียว
    expect(isError).toBe(true);
    expect(payload).toContain("ws-ไม่มีจริง");
  });
});

/**
 * ครึ่งที่ `workspace` **ไม่ได้ทำ** — และเป็นครึ่งที่ benchmark ต้องรู้
 *
 * tool ที่รับแต่ `id` ไม่ได้ถามว่า id นั้นอยู่ workspace ไหน · รหัสที่หลุดออกไป
 * ในข้อความ ในใบงาน หรือในรายงาน ใช้ลงมือข้าม workspace ได้ทันที
 */
describe("การลงมือด้วย id ข้าม workspace ได้ และนั่นคือพฤติกรรมที่เป็นอยู่", () => {
  it("โพสต์ลงกระทู้ของอีก workspace ได้ ด้วยรหัสกระทู้อย่างเดียว", async () => {
    const a = await call("create_discussion", { workspace: ALPHA, title: "ของ alpha", body: "x" });

    // ผู้เรียกไม่ได้บอกเลยว่าตั้งใจอยู่ ws ไหน · `post_message` ไม่มีพารามิเตอร์ให้บอกด้วย
    const posted = await call("post_message", {
      discussion_id: a.discussion_id,
      body: "ข้ามมาจากที่อื่น",
    });

    expect(posted.seq).toBe(2);
  });

  it("แก้ใบงานของอีก workspace ได้ ด้วยรหัสใบอย่างเดียว", async () => {
    const t = await call("create_task", { workspace: ALPHA, title: "ใบของ alpha" });

    const updated = await call("update_task", { task_id: t.task_id, status: "done" });

    expect(updated.status).toBe("done");
  });

  it("อ่านกระทู้ของอีก workspace ได้ แต่ผลลัพธ์บอกเองว่าอยู่ ws ไหน", async () => {
    const a = await call("create_discussion", { workspace: ALPHA, title: "ของ alpha", body: "x" });

    const read = await call("get_discussion", { discussion_id: a.discussion_id });

    // อ่านได้ แต่ **บอกความจริง** — ผู้เรียกที่ตรวจช่องนี้จับได้ว่าเดินข้ามเขต
    expect(read.discussion.workspace).toBe(ALPHA);
  });
});

/**
 * ข้อที่ราคาสูงที่สุดสำหรับ runner อัตโนมัติ
 *
 * พารามิเตอร์ `workspace` มีค่า default และค่านั้นคือ **โต๊ะจริง** · runner ที่ลืม
 * ส่งพารามิเตอร์จะไม่ได้ error และไม่ได้เขียนลงที่ของตัวเอง — มันเขียนลง production
 * โดยที่ทุกอย่างดูสำเร็จปกติ
 */
describe("ลืมส่ง workspace แล้วไปไหน", () => {
  it("ไม่ส่ง workspace แปลว่าลงโต๊ะจริง ไม่ใช่ลงที่ที่ผู้เรียกเพิ่งทำงานอยู่", async () => {
    await call("create_discussion", { workspace: ALPHA, title: "ของ alpha", body: "x" });

    const forgot = await call("create_discussion", { title: "ลืมส่ง workspace", body: "y" });
    const read = await call("get_discussion", { discussion_id: forgot.discussion_id });

    expect(read.discussion.workspace).toBe(DEFAULT_WORKSPACE);
    expect(read.discussion.workspace).not.toBe(ALPHA);

    // และมันไปโผล่ในรายการของโต๊ะจริงด้วย ไม่ได้ลอยอยู่เฉย ๆ
    const production = await call("get_workspace_context", { limit: 50 });
    expect(production.discussions.map((d: any) => d.id)).toContain(forgot.discussion_id);
  });
});

/**
 * ไม่มีทางล้างของในรอบวัด — จึงต้องใช้ workspace ใหม่ต่อรอบ ไม่ใช่ใช้ซ้ำ
 *
 * ข้อความลบไม่ได้ ไม่มี tool ลบ และจะไม่มี · `get_workspace_context` เป็นคำสั่งแรก
 * ที่ runner ทุกตัวเรียก ถ้าใช้ workspace ซ้ำ รอบที่สองจะเห็นของรอบแรกเป็นบริบท
 */
describe("ไม่มีการล้าง จึงใช้ซ้ำไม่ได้", () => {
  it("ไม่มี tool ไหนลบหรือรีเซ็ตอะไรได้เลย", async () => {
    const list = await call("get_workspace_context", { workspace: ALPHA, limit: 1 });
    expect(list).toBeTruthy();

    const { isError } = await raw("delete_discussion", { discussion_id: "dis-x" });
    expect(isError).toBe(true);
  });

  it("ของรอบก่อนยังอยู่ให้รอบถัดไปเห็นเป็นบริบท", async () => {
    await call("create_discussion", { workspace: ALPHA, title: "รอบที่ 1", body: "x" });
    await call("create_task", { workspace: ALPHA, title: "ใบของรอบที่ 1" });

    // รอบที่สองเริ่มด้วยคำสั่งเดียวกับที่ runner ทุกตัวเรียกเป็นอย่างแรก
    const round2 = await call("get_workspace_context", { workspace: ALPHA, limit: 50 });

    expect(round2.total_discussions).toBe(1);
    expect(round2.open_items.tasks.open).toBe(1);
  });
});
