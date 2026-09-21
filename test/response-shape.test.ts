/**
 * ล็อกรูปของผลลัพธ์ และคุมค่าคงที่ที่เปลี่ยนแล้วจะไม่มีใครสังเกต
 *
 * ที่มา: `agent-platform` รีวิว `contract 2` ให้เมื่อ 21 ก.ย. แล้ว **ไปตรวจสองข้อ
 * ด้วยมือเอง** ที่ `dis-c6095786` seq 23 — เทียบเลข `contract` สองเรือน และบวกเลข
 * `tasks.open` กับ `health.open_tasks` ว่าตรงกัน
 *
 * สองข้อนั้นคือข้อที่ **ถ้าพังจะไม่มีอะไรฟ้อง** · ถ้าไม่จับไว้เป็นเทสต์ รอบหน้าต้องมีคน
 * มาบวกเลขด้วยมืออีก หรือไม่มีใครบวกเลย — ความรู้ที่อยู่ในหัวผู้รีวิวคนเดียวจะระเหย
 *
 * ไฟล์นี้ไม่ได้ห้ามเปลี่ยนรูปผลลัพธ์ · มันทำให้ **การเปลี่ยนเป็นการเปลี่ยนที่มีคนเห็น**
 * เพิ่มคีย์ใหม่แล้วเทสต์แดง = ถูกต้อง แก้รายการในเทสต์คือการประกาศว่าตั้งใจ
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";
import { CONTRACT_VERSION } from "../src/tool-kit";

const TOKEN = "shape-token-aaaaaaaaaaaaaaaaaaaaaaaaa";
const TEAM = "owner/team-a";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: TOKEN,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

let id = 0;

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<
  Record<string, unknown>
> {
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
      body: JSON.stringify({ jsonrpc: "2.0", id: (id += 1), method, params }),
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
  return (frame.result ?? {}) as Record<string, unknown>;
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<
  Record<string, unknown>
> {
  const result = await rpc("tools/call", { name, arguments: args });
  const payload = (result.content as Array<{ text?: string }> | undefined)?.[0]?.text;
  if (result.isError) throw new Error(payload ?? "tool error");
  return JSON.parse(payload ?? "{}") as Record<string, unknown>;
}

const context = () => callTool("get_workspace_context", { limit: 1 });

beforeEach(async () => {
  await resetDatabase();
});

/**
 * เลข `contract` อยู่สองที่ที่ถูก cache คนละแบบ — บรรทัดแรกของ description ทุก tool
 * ซึ่งค้างอยู่ที่ client จนกว่าจะเชื่อมต่อใหม่ กับผลลัพธ์ซึ่งสร้างสดทุกครั้ง
 *
 * กลไกทั้งหมดมีค่าก็ต่อเมื่อ **สองเรือนตรงกันตอนที่ทุกอย่างปกติ** ไม่งั้นเลขที่ไม่ตรงกัน
 * จะแปลว่าอะไรก็ได้ · `agent-platform` ตรวจข้อนี้ด้วยมือจาก client ของเขาเอง
 */
describe("เลข contract ตรงกันทุกที่", () => {
  it("ทุก tool ขึ้นต้น description ด้วยเลขเดียวกับที่ผลลัพธ์คืน", async () => {
    const listed = await rpc("tools/list");
    const tools = listed.tools as Array<{ name: string; description: string }>;
    const fromResult = (await context()).contract;

    expect(tools.length).toBeGreaterThan(0);
    expect(fromResult).toBe(CONTRACT_VERSION);

    for (const tool of tools) {
      const first = tool.description.split("\n")[0];
      expect(first, `${tool.name} บรรทัดแรกไม่ใช่เลข contract`).toBe(
        `contract ${CONTRACT_VERSION}`,
      );
    }
  });

  it("ไม่มี tool ไหนตกหล่นจากการติดเลข — นับจาก tools/list ของจริง", async () => {
    const listed = await rpc("tools/list");
    const tools = listed.tools as Array<{ name: string; description: string }>;

    const missing = tools.filter((t) => !t.description.startsWith("contract ")).map((t) => t.name);
    expect(missing).toEqual([]);
  });
});

/**
 * ข้อที่ `agent-platform` ชี้ว่าเป็น **ที่เดียวที่การเปลี่ยนความหมายจะซ่อนได้**
 *
 * `tasks.open` กับ `health.open_tasks` พูดถึงของกองเดียวกัน · ถ้าวันหนึ่ง `open`
 * กลายเป็น "open ที่ไม่ได้จอด" มันจะดูสมเหตุสมผลมากจนไม่มีใครสังเกต และนั่นคือ
 * การเปลี่ยนความหมายของคีย์เดิม ซึ่งลาก contract 3 มาทันที
 */
describe("health แตกยอดเดิม ไม่ได้หักยอดเดิม", () => {
  async function counts() {
    const ctx = await context();
    const open = ctx.open_items as {
      tasks: Record<string, number>;
      health: { open_tasks: { unstarted: number; parked: { total: number } } };
    };
    return {
      open: open.tasks.open ?? 0,
      unstarted: open.health.open_tasks.unstarted,
      parked: open.health.open_tasks.parked.total,
    };
  }

  it("open เท่ากับ unstarted บวก parked เสมอ", async () => {
    await callTool("create_task", { title: "งานที่ยังไม่มีใครเริ่ม" });
    await callTool("create_task", { title: "งานที่รอ trigger", detail: "PARKED / รอเงื่อนไข" });
    await callTool("create_task", { title: "งานที่ยังไม่มีใครเริ่มอีกใบ" });

    const { open, unstarted, parked } = await counts();

    expect(open).toBe(3);
    expect(unstarted + parked).toBe(open);
    expect(parked).toBe(1);
  });

  it("ยังเท่ากันเมื่อไม่มีงานจอดเลย", async () => {
    await callTool("create_task", { title: "งานเดียว" });

    const { open, unstarted, parked } = await counts();

    expect(parked).toBe(0);
    expect(unstarted + parked).toBe(open);
  });

  /**
   * งานที่เริ่มแล้วต้องไม่อยู่ในสองกองนี้ — ถ้าหลุดเข้ามา สมการจะยังเท่ากันแต่ผิด
   * ความหมาย จึงต้องยืนยันว่า `open` ไม่ได้นับ `in_progress` ด้วย
   */
  it("งานที่เริ่มแล้วไม่ถูกนับในสมการนี้", async () => {
    const task = await callTool("create_task", { title: "งานที่เริ่มแล้ว" });
    await callTool("update_task", { task_id: task.task_id as string, status: "in_progress" });
    await callTool("create_task", { title: "งานที่ยังไม่เริ่ม" });

    const { open, unstarted, parked } = await counts();

    expect(open).toBe(1);
    expect(unstarted + parked).toBe(open);
  });
});

/**
 * รายการคีย์ที่ล็อกไว้ — ไม่ได้ห้ามเพิ่ม แต่บังคับให้การเพิ่มเป็นเรื่องที่ตั้งใจ
 *
 * `agent-platform` ตอบไว้ที่ seq 23 ว่าไม่มีสัญญาใบไหนอธิบายผลลัพธ์ของ tool นี้เลย
 * แปลว่า **ไม่มีใครข้างนอกถือ schema ให้เราเทียบ** รายการนี้จึงเป็นที่เดียวที่รูปของ
 * คำตอบถูกเขียนไว้เป็นของที่เครื่องตรวจได้
 */
describe("รูปของผลลัพธ์ถูกล็อกไว้", () => {
  it("get_workspace_context คืนคีย์ระดับบนชุดนี้", async () => {
    expect(Object.keys(await context()).sort()).toEqual([
      "contract",
      "discussions",
      "has_more",
      "open_items",
      "participants",
      "quiet_discussions",
      "standing_rules",
      "total_discussions",
      "workspace",
      "you_are",
    ]);
  });

  it("open_items คืนคีย์ชุดนี้", async () => {
    const ctx = await context();
    expect(Object.keys(ctx.open_items as object).sort()).toEqual([
      "decisions_awaiting",
      "handoffs_inactive",
      "handoffs_pending",
      "health",
      "latest_plan",
      "plans_current",
      "tasks",
      "waiting_for_you",
    ]);
  });

  it("health คืนสี่ช่องนี้", async () => {
    const open = (await context()).open_items as { health: object };
    expect(Object.keys(open.health).sort()).toEqual([
      "delegated",
      "handoffs",
      "open_tasks",
      "unseen_targets",
    ]);
  });

  /**
   * `acted_as` ต้องมีทุกครั้ง ไม่ใช่โผล่เฉพาะตอนที่ไม่ตรงกัน — ฟิลด์ที่โผล่เฉพาะตอน
   * ผิดปกติจะถูกมองข้ามตอนที่มันโผล่ · หลักเดียวกับที่ `create_task` คืน `handoff`
   * เป็น `null` เสมอ
   */
  it("acted_as มีในผลของ update_task เสมอ แม้ไม่ได้ทำแทนใคร", async () => {
    const task = await callTool("create_task", { title: "ใบของตัวเอง", assigned_to: TEAM });
    const result = await callTool("update_task", {
      task_id: task.task_id as string,
      status: "done",
    });

    expect(result).toHaveProperty("acted_as");
    expect((result.acted_as as { delegated: boolean }).delegated).toBe(false);
  });
});
