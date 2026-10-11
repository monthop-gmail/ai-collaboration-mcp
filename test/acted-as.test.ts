/**
 * ยืนยันว่า `acted_as` ไปถึงผลลัพธ์ของ tool จริง ไม่ใช่แค่ฟังก์ชันคืนค่าถูก
 *
 * `tool-kit.test.ts` พิสูจน์ว่า `actedAs()` คำนวณถูก แต่ฟังก์ชันที่ถูกแล้วไม่ได้ต่อสาย
 * พิสูจน์อะไรไม่ได้เลย — เป็นบทเรียนที่ทั้งโต๊ะเจอกันหกครั้งในสัปดาห์นี้ ทั้ง `session`
 * ที่มีในทะเบียนแต่ไม่มีโค้ดไหนอ่าน และ `ops` กับ `cid` ที่มีคนใส่ค่าแต่ไม่มีใครตรวจ
 *
 * ไฟล์นี้จึงยิงผ่าน worker จริงเหมือนที่ผู้เรียกทำ ไม่ได้เรียกฟังก์ชันตรง
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { applySchema } from "./apply-schema";

const TOKEN = "acted-as-token-aaaaaaaaaaaaaaaaaaaaaaaa";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: TOKEN,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

let id = 0;

/** เรียก tool ในนามของชื่อที่กำหนด — ชื่อมาจาก `X-Client-Name` เหมือนผู้เรียกจริง */
async function callTool(
  as: string,
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
        "x-client-name": as,
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

type ActedAs = {
  addressed_to: string | null;
  acted_by: string | null;
  delegated: boolean;
  same_party_different_case: boolean;
  note?: string;
};

const TEAM_A = "owner/team-a";
const TEAM_B = "owner/team-b";

beforeEach(async () => {
  await applySchema();
});

async function taskAssignedToA(): Promise<string> {
  const task = await callTool(TEAM_A, "create_task", {
    title: "งานสำหรับทดสอบว่าใครลงมือ",
    assigned_to: TEAM_A,
  });
  return task.task_id as string;
}

describe("accept_handoff บอกได้ว่าผู้รับตรงกับผู้ที่จ่าหน้าถึงหรือไม่", () => {
  it("คนละคนกับที่จ่าหน้าถึง — รายงานว่าทำแทน และยังรับได้ตามปกติ", async () => {
    const taskId = await taskAssignedToA();
    const handoff = await callTool(TEAM_A, "create_handoff", {
      task_id: taskId,
      to: TEAM_A,
      context: "ส่งถึง team-a แต่จะให้ team-b เป็นคนกดรับ",
    });

    const result = await callTool(TEAM_B, "accept_handoff", {
      handoff_id: handoff.handoff_id as string,
    });
    const acted = result.acted_as as ActedAs;

    // รับได้จริง ไม่ถูกบล็อก — ถ้าบล็อก งานที่ไซต์จะไม่เดิน
    expect(result.task_status).toBe("in_progress");
    expect(acted.delegated).toBe(true);
    expect(acted.addressed_to).toBe(TEAM_A);
    expect(acted.acted_by).toBe(TEAM_B);
    expect(acted.note).toContain("allowed");
  });

  it("คนเดียวกับที่จ่าหน้าถึง — ไม่ใช่การทำแทน และไม่มีข้อความเตือน", async () => {
    const taskId = await taskAssignedToA();
    const handoff = await callTool(TEAM_A, "create_handoff", {
      task_id: taskId,
      to: TEAM_B,
      context: "ส่งถึง team-b และ team-b เป็นคนกดรับเอง",
    });

    const result = await callTool(TEAM_B, "accept_handoff", {
      handoff_id: handoff.handoff_id as string,
    });
    const acted = result.acted_as as ActedAs;

    expect(acted.delegated).toBe(false);
    expect(acted.addressed_to).toBe(TEAM_B);
    expect(acted).not.toHaveProperty("note");
  });
});

describe("update_task บอกได้ว่าผู้แก้ตรงกับเจ้าของใบหรือไม่", () => {
  it("คนอื่นแก้ใบของทีมอื่น — รายงานว่าทำแทน และยังแก้ได้ตามปกติ", async () => {
    const taskId = await taskAssignedToA();

    const result = await callTool(TEAM_B, "update_task", {
      task_id: taskId,
      status: "done",
    });
    const acted = result.acted_as as ActedAs;

    expect(result.status).toBe("done");
    expect(acted.delegated).toBe(true);
    expect(acted.addressed_to).toBe(TEAM_A);
    expect(acted.acted_by).toBe(TEAM_B);
  });

  it("เจ้าของใบแก้เอง — ไม่ใช่การทำแทน", async () => {
    const taskId = await taskAssignedToA();

    const result = await callTool(TEAM_A, "update_task", { task_id: taskId, status: "done" });
    const acted = result.acted_as as ActedAs;

    expect(acted.delegated).toBe(false);
    expect(acted.addressed_to).toBe(TEAM_A);
  });

  /**
   * ใบไม่มีเจ้าของ ต้องแยกออกจากใบที่มีเจ้าของแล้วตรงกัน — ทั้งสองกรณี `delegated`
   * เป็น false เหมือนกัน ผู้อ่านจึงต้องดู `addressed_to` ซึ่งอยู่ในผลลัพธ์เดียวกัน
   */
  it("ใบไม่มีเจ้าของ — ไม่ใช่การทำแทน และบอกได้ว่าไม่มีใครถูกระบุ", async () => {
    const task = await callTool(TEAM_A, "create_task", { title: "งานที่ยังไม่มีเจ้าของ" });

    const result = await callTool(TEAM_B, "update_task", {
      task_id: task.task_id as string,
      status: "in_progress",
    });
    const acted = result.acted_as as ActedAs;

    expect(acted.delegated).toBe(false);
    expect(acted.addressed_to).toBeNull();
    expect(acted.acted_by).toBe(TEAM_B);
  });
});

/**
 * ทีมเดียวกันที่สะกดคนละตัวพิมพ์ — **ไม่ใช่การทำงานแทนกัน**
 *
 * ## แผลจริง
 *
 * 11 ต.ค. 2026 ZCode รับใบที่จ่าหน้า `ZCode` ด้วย header ที่สะกด `zcode` ·
 * `acted_as` ตอบ `delegated: true` พร้อมโน้ตว่า *"The record names 'ZCode' but
 * 'zcode' did this"* ขณะที่ `health.delegated` **ไม่นับใบนั้นเลย** เพราะเทียบด้วย
 * `lower()` — **คำเดียวกันในสัญญาเดียวกัน ตอบตรงข้ามกันบนใบเดียวกัน**
 *
 * แล้ว ZCode บันทึกลงโต๊ะว่าเป็นพฤติกรรมที่ถูกต้องตามสัญญา (`dis-3b5cb137` seq 63)
 * ซึ่งโต๊ะลบไม่ได้ · ถ้าไม่แก้ มันจะกลายเป็น baseline ให้ runtime ตัวต่อไปอ้าง
 *
 * ## ทำไมไม่มีด่านไหนจับ
 *
 * เทสต์เดิมมีสองขั้วคือ *ชื่อตรงกันเป๊ะ* กับ *คนละชื่อไปเลย* · **ไม่มีเคสที่ชื่อ
 * เดียวกันแต่พิมพ์ไม่ตรง** ซึ่งเป็นเคสที่เกิดจริงเพราะชื่อมาจาก config ที่คนพิมพ์เอง
 */
describe("ทีมเดียวกัน สะกดคนละตัวพิมพ์", () => {
  const LOWER = "owner/team-a";
  const UPPER = "Owner/Team-A";

  /** **กรณีที่ตัดสินไฟล์นี้** — ลำดับเดียวกับที่ ZCode ทำ */
  it("รับใบที่จ่าหน้าตัวพิมพ์ใหญ่ ด้วย header ตัวพิมพ์เล็ก — ไม่ใช่การทำแทน", async () => {
    const task = (await callTool(UPPER, "create_task", { title: "ใบของทีมเดียวกัน" }))
      .task_id as string;
    const handoff = (
      await callTool(UPPER, "create_handoff", { task_id: task, to: UPPER, context: "ส่งต่อ" })
    ).handoff_id as string;

    const r = await callTool(LOWER, "accept_handoff", { handoff_id: handoff });
    const acted = r.acted_as as ActedAs;

    expect(acted.addressed_to).toBe(UPPER);
    expect(acted.acted_by).toBe(LOWER);
    expect(acted.delegated).toBe(false);
    expect(acted.same_party_different_case).toBe(true);
  });

  it("บอกเหตุไว้ในโน้ต และบอกว่าต้องไปแก้ที่ไหน", async () => {
    const task = (await callTool(UPPER, "create_task", { title: "ใบ", assigned_to: UPPER }))
      .task_id as string;

    const r = await callTool(LOWER, "update_task", { task_id: task, status: "in_progress" });
    const acted = r.acted_as as ActedAs;

    expect(acted.delegated).toBe(false);
    expect(acted.same_party_different_case).toBe(true);
    // โน้ตต้องปฏิเสธการตีความว่าเป็น delegation ให้ชัด ไม่ใช่แค่เงียบ
    expect(acted.note).toContain("SAME party");
    expect(acted.note).toContain("NOT delegation");
    // และบอกทางแก้ — ผู้อ่านคือโมเดล ไม่ใช่คนที่เปิด repo
    expect(acted.note).toContain("X-Client-Name");
  });

  it("ตรงกันเป๊ะ — ไม่ใช่ทั้งการทำแทนและไม่ใช่การสะกดต่าง และไม่มีโน้ต", async () => {
    const task = (await callTool(LOWER, "create_task", { title: "ใบ", assigned_to: LOWER }))
      .task_id as string;

    const r = await callTool(LOWER, "update_task", { task_id: task, status: "in_progress" });
    const acted = r.acted_as as ActedAs;

    expect(acted.delegated).toBe(false);
    expect(acted.same_party_different_case).toBe(false);
    expect(acted.note).toBeUndefined();
  });

  it("คนละทีมจริง — ยังรายงานว่าทำแทน และไม่ใช่เรื่องการสะกด", async () => {
    const task = (await callTool(TEAM_A, "create_task", { title: "ใบ", assigned_to: TEAM_A }))
      .task_id as string;

    const r = await callTool(TEAM_B, "update_task", { task_id: task, status: "in_progress" });
    const acted = r.acted_as as ActedAs;

    expect(acted.delegated).toBe(true);
    expect(acted.same_party_different_case).toBe(false);
    expect(acted.note).toContain("did this");
  });

  /**
   * ตรงกับ `health.delegated` ซึ่งเทียบด้วย `lower()` — สองที่ต้องตอบเหมือนกัน
   * เพราะความไม่ตรงกันของสองที่นี้คือตัวบั๊กเอง
   */
  it("ตอบตรงกับ health.delegated บนใบเดียวกัน", async () => {
    const task = (await callTool(UPPER, "create_task", { title: "ใบ", assigned_to: UPPER }))
      .task_id as string;
    const r = await callTool(LOWER, "update_task", { task_id: task, status: "in_progress" });
    expect((r.acted_as as ActedAs).delegated).toBe(false);

    const ctx = await callTool(LOWER, "get_workspace_context", { limit: 1 });
    const health = (ctx.open_items as { health: { delegated: { tasks: Array<{ task_id: string }> } } })
      .health.delegated;

    expect(health.tasks.filter((t) => t.task_id === task)).toEqual([]);
  });
});
