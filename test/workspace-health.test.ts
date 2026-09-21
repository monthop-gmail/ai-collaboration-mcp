/**
 * `health` ใน `get_workspace_context` — Phase 1 ข้อ C
 *
 * ยิงผ่าน worker จริงด้วยเหตุผลเดียวกับ `acted-as.test.ts` คือฟังก์ชันที่ถูกแล้วไม่ได้
 * ต่อสายพิสูจน์อะไรไม่ได้ และ repo นี้เพิ่งมีเทสต์ชั้น tool เป็นไฟล์ที่สอง
 *
 * ของที่ต้องพิสูจน์ไม่ใช่แค่ "ตัวเลขออกมา" แต่คือ **ตัวเลขนั้นแยกของที่ต้องแยกได้จริง**
 * เพราะทั้งสี่ช่องมีไว้แก้ปัญหาเดียวกันคือของสองอย่างที่ต้องการการกระทำคนละแบบ
 * ถูกนับรวมกันจนยอดที่ควรฟ้องกลับฟ้องผิดทุกวัน
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";
import { STALE_AFTER_DAYS } from "../src/db-work";

const TOKEN = "health-token-aaaaaaaaaaaaaaaaaaaaaaaa";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: TOKEN,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

let id = 0;

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

interface Health {
  handoffs: { waiting: number; stale: number; inactive: number };
  delegated: {
    handoffs: Array<{ handoff_id: string; addressed_to: string; acted_by: string }>;
    tasks: Array<{ task_id: string; addressed_to: string; acted_by: string }>;
    total: number;
  };
  open_tasks: {
    unstarted: number;
    parked: { tasks: Array<{ id: string; title: string }>; total: number };
  };
  unseen_targets: Array<{
    name: string;
    pending_handoffs: number;
    oldest: string;
    evidence: string;
  }>;
}

const TEAM_A = "owner/team-a";
const TEAM_B = "owner/team-b";

/** ชื่อที่ไม่เคยลงมืออะไร — รูปเดียวกับ `bkmtr` ที่ค้างจริงในโต๊ะมาสี่วัน */
const SITE_NAME = "bkmtr";

async function health(as = TEAM_A): Promise<Health> {
  const context = await callTool(as, "get_workspace_context", { limit: 1 });
  return (context.open_items as { health: Health }).health;
}

beforeEach(async () => {
  await resetDatabase();
});

describe("handoff ที่ค้าง แยกตามอายุ ของทั้งโต๊ะไม่ใช่เฉพาะของผู้เรียก", () => {
  it("ใบที่เพิ่งส่งนับเป็น waiting และเห็นได้จากผู้เรียกที่ไม่ใช่ปลายทาง", async () => {
    const task = await callTool(TEAM_A, "create_task", { title: "งานที่ส่งต่อ" });
    await callTool(TEAM_A, "create_handoff", {
      task_id: task.task_id as string,
      to: TEAM_B,
      context: "ส่งให้ team-b",
    });

    // ผู้เรียกคือ team-a ซึ่งไม่ใช่ปลายทาง — waiting_for_you จึงว่าง แต่ health ต้องเห็น
    const context = await callTool(TEAM_A, "get_workspace_context", { limit: 1 });
    const items = context.open_items as { health: Health; waiting_for_you: { total: number } };

    expect(items.waiting_for_you.total).toBe(0);
    expect(items.health.handoffs).toEqual({ waiting: 1, stale: 0, inactive: 0 });
  });

  it("ใบที่ค้างเกินเส้นย้ายไปนับเป็น stale ไม่ใช่ waiting", async () => {
    const task = await callTool(TEAM_A, "create_task", { title: "งานที่ค้างนาน" });
    const handoff = await callTool(TEAM_A, "create_handoff", {
      task_id: task.task_id as string,
      to: TEAM_B,
      context: "ส่งไว้นานแล้ว",
    });

    // ไม่มี tool ไหนตั้งวันย้อนหลังได้ และไม่ควรมี — เลื่อนวันที่ระดับ DB แทน
    const old = new Date(Date.now() - (STALE_AFTER_DAYS + 1) * 86_400_000).toISOString();
    await env.DB.prepare("UPDATE handoffs SET created_at = ?1 WHERE id = ?2")
      .bind(old, handoff.handoff_id as string)
      .run();

    expect((await health()).handoffs).toEqual({ waiting: 0, stale: 1, inactive: 0 });
  });

  it("งานปิดแล้วใบจะตกยุค ไม่นับรวมกับใบที่ยังต้องมีคนรับ", async () => {
    const task = await callTool(TEAM_A, "create_task", { title: "งานที่ปิดไปก่อน" });
    await callTool(TEAM_A, "create_handoff", {
      task_id: task.task_id as string,
      to: TEAM_B,
      context: "ส่งแล้วงานจบไปทางอื่น",
    });
    await callTool(TEAM_A, "update_task", { task_id: task.task_id as string, status: "done" });

    expect((await health()).handoffs).toEqual({ waiting: 0, stale: 0, inactive: 1 });
  });
});

describe("ผู้ลงมือจริงไม่ตรงกับผู้ที่บันทึกระบุ", () => {
  it("รับแทนกัน — ขึ้นในรายการ พร้อมชื่อทั้งสองฝั่ง", async () => {
    const task = await callTool(TEAM_A, "create_task", { title: "งานที่มีคนรับแทน" });
    const handoff = await callTool(TEAM_A, "create_handoff", {
      task_id: task.task_id as string,
      to: TEAM_A,
      context: "จ่าหน้าถึง team-a",
    });
    await callTool(TEAM_B, "accept_handoff", { handoff_id: handoff.handoff_id as string });

    const { delegated } = await health();

    expect(delegated.total).toBe(1);
    expect(delegated.handoffs).toEqual([
      {
        handoff_id: handoff.handoff_id,
        task_id: task.task_id,
        addressed_to: TEAM_A,
        acted_by: TEAM_B,
      },
    ]);
  });

  it("แก้ใบของทีมอื่น — ขึ้นในรายการฝั่ง task", async () => {
    const task = await callTool(TEAM_A, "create_task", {
      title: "ใบของ team-a",
      assigned_to: TEAM_A,
    });
    await callTool(TEAM_B, "update_task", {
      task_id: task.task_id as string,
      status: "in_progress",
    });

    const { delegated } = await health();

    expect(delegated.total).toBe(1);
    expect(delegated.tasks[0]).toMatchObject({
      task_id: task.task_id,
      addressed_to: TEAM_A,
      acted_by: TEAM_B,
    });
  });

  it("เจ้าของทำเอง — ไม่ขึ้น ไม่ว่าจะฝั่งไหน", async () => {
    const task = await callTool(TEAM_A, "create_task", {
      title: "ใบที่เจ้าของทำเอง",
      assigned_to: TEAM_A,
    });
    await callTool(TEAM_A, "update_task", {
      task_id: task.task_id as string,
      status: "in_progress",
    });
    const handoff = await callTool(TEAM_A, "create_handoff", {
      task_id: task.task_id as string,
      to: TEAM_B,
      context: "ส่งถึง team-b และ team-b รับเอง",
    });
    await callTool(TEAM_B, "accept_handoff", { handoff_id: handoff.handoff_id as string });

    const { delegated } = await health();

    expect(delegated).toEqual({ handoffs: [], tasks: [], total: 0 });
  });

  /**
   * ชื่อที่ต่างกันแค่ตัวพิมพ์คือคนเดียวกัน ไม่ใช่การทำแทน
   *
   * ใช้เกณฑ์เดียวกับที่ `waiting_for_you` จับคู่ชื่อ ถ้าที่นี่เข้มกว่า ทีมที่พิมพ์ชื่อ
   * ตัวใหญ่ปนจะถูกรายงานว่าทำแทนตัวเองทุกครั้งที่แตะใบของตัวเอง
   */
  it("ชื่อเดียวกันคนละตัวพิมพ์ ไม่นับเป็นการทำแทน", async () => {
    const task = await callTool(TEAM_A, "create_task", {
      title: "ใบที่เจ้าของพิมพ์ชื่อตัวใหญ่",
      assigned_to: "Owner/Team-A",
    });
    await callTool(TEAM_A, "update_task", { task_id: task.task_id as string, status: "blocked" });

    expect((await health()).delegated.total).toBe(0);
  });
});

describe("งานเปิดที่จอดไว้ แยกจากงานเปิดที่ยังไม่มีใครเริ่ม", () => {
  it("detail ขึ้นต้นด้วยคำนั้น ถือว่าจอด และไม่ถูกนับเป็นงานที่ยังไม่เริ่ม", async () => {
    await callTool(TEAM_A, "create_task", { title: "งานที่ยังไม่มีใครเริ่ม" });
    const parked = await callTool(TEAM_A, "create_task", {
      title: "งานที่รอ trigger",
      detail: "PARKED / trigger-based follow-up · อย่าเริ่มเพียงเพราะใบนี้มีอยู่",
    });

    const { open_tasks } = await health();

    expect(open_tasks.unstarted).toBe(1);
    expect(open_tasks.parked.total).toBe(1);
    expect(open_tasks.parked.tasks[0]).toMatchObject({ id: parked.task_id });
  });

  it("title ขึ้นต้นด้วยคำนั้นก็ได้ เพราะบางใบเขียนไว้ที่หัวเรื่อง", async () => {
    await callTool(TEAM_A, "create_task", { title: "PARKED — รอผลจากอีกทีม" });

    const { open_tasks } = await health();

    expect(open_tasks.unstarted).toBe(0);
    expect(open_tasks.parked.total).toBe(1);
  });

  /**
   * เส้นที่คมกว่าพลาดใบที่จอดจริงบางใบ ซึ่งยอมรับได้ เพราะแก้ได้ด้วยการแก้ใบ
   * ส่วนการเดาผิดแก้ไม่ได้ด้วยอะไรเลย — `task-b4f135bd` ในโต๊ะจริงเป็นใบแบบนี้
   */
  it("เอ่ยคำนั้นกลางข้อความ ไม่นับว่าจอด", async () => {
    await callTool(TEAM_A, "create_task", {
      title: "งานที่พูดถึงการจอด",
      detail: "ห้าม PARKED ใบนี้ ต้องเริ่มทันที",
    });

    const { open_tasks } = await health();

    expect(open_tasks.unstarted).toBe(1);
    expect(open_tasks.parked.total).toBe(0);
  });

  it("งานที่เริ่มแล้วไม่อยู่ในสองกองนี้เลย", async () => {
    const task = await callTool(TEAM_A, "create_task", { title: "งานที่เริ่มแล้ว" });
    await callTool(TEAM_A, "update_task", {
      task_id: task.task_id as string,
      status: "in_progress",
    });

    const { open_tasks } = await health();

    expect(open_tasks.unstarted).toBe(0);
    expect(open_tasks.parked.total).toBe(0);
  });
});

/**
 * ข้อนี้เป็นคำตอบของข้อ A ที่ผมบอกไว้ที่ dis-c6095786 seq 10 ว่ายังไม่มี
 *
 * `ho-2f5c61d4` ส่งถึง `bkmtr` ซึ่งเป็นชื่อ worker ไม่ใช่ team_id และค้างมาสี่วัน
 * ผู้ส่งรู้กติกาและเขียนค่าที่ถูกไว้ในใบเดียวกัน แล้วยังใส่ค่าที่ผิดในช่อง — คำเตือน
 * ตอนสร้างที่บอกว่า "นี่ไม่ใช่ team_id" จึงไม่ช่วยเลย เพราะเขารู้อยู่แล้ว
 *
 * สิ่งที่จับเคสนี้ได้คือหลักฐานคนละชนิด: ชื่อนั้น**ไม่เคยลงมืออะไรในโต๊ะนี้** และมัน
 * ต้องขึ้นซ้ำทุกวันที่ยังไม่มีใครแก้ ไม่ใช่เตือนครั้งเดียวตอนสร้างแล้วหายไป
 */
describe("ปลายทางที่ไม่เคยลงมืออะไรในโต๊ะนี้", () => {
  it("ชื่อที่ไม่เคยปรากฏเป็นผู้กระทำ ขึ้นพร้อมหลักฐานว่าดูจากอะไร", async () => {
    const task = await callTool(TEAM_A, "create_task", { title: "งานที่ไซต์" });
    await callTool(TEAM_A, "create_handoff", {
      task_id: task.task_id as string,
      to: SITE_NAME,
      context: "ส่งถึงชื่อ worker ไม่ใช่ team_id",
    });

    const { unseen_targets } = await health();

    expect(unseen_targets).toHaveLength(1);
    expect(unseen_targets[0]).toMatchObject({ name: SITE_NAME, pending_handoffs: 1 });
    // ถ้อยคำต้องเป็นหลักฐานที่สังเกตได้ ไม่ใช่ข้อสรุปว่าชื่อนี้ไม่มีตัวตน
    expect(unseen_targets[0].evidence).toContain("ไม่เคย");
    expect(unseen_targets[0].evidence).not.toContain("ไม่มีตัวตน");
  });

  /**
   * เกณฑ์คือการกระทำที่ทิ้งร่องรอย ไม่ใช่การถูกเอ่ยถึง ถ้าใช้ `assigned_to` หรือ
   * `to_whom` เป็นหลักฐาน ทุกชื่อจะยืนยันตัวเองได้ด้วยการถูกส่งงาน
   */
  it("ถูกส่งงานอย่างเดียวไม่นับว่าเคยลงมือ แม้จะมีใบจ่าหน้าถึงหลายใบ", async () => {
    for (const title of ["งานที่ไซต์ ก", "งานที่ไซต์ ข"]) {
      const task = await callTool(TEAM_A, "create_task", { title, assigned_to: SITE_NAME });
      await callTool(TEAM_A, "create_handoff", {
        task_id: task.task_id as string,
        to: SITE_NAME,
        context: "ส่งถึงไซต์",
      });
    }

    const { unseen_targets } = await health();

    expect(unseen_targets).toHaveLength(1);
    expect(unseen_targets[0].pending_handoffs).toBe(2);
  });

  it("ชื่อที่เคยโพสต์แล้ว ไม่ขึ้น แม้จะยังไม่เคยรับ handoff", async () => {
    const discussion = await callTool(TEAM_A, "create_discussion", {
      title: "กระทู้สำหรับทดสอบ",
      body: "เปิดกระทู้",
    });
    await callTool(TEAM_B, "post_message", {
      discussion_id: discussion.discussion_id as string,
      body: "team-b เคยโพสต์แล้ว",
      kind: "note",
    });

    const task = await callTool(TEAM_A, "create_task", { title: "งานที่ส่งถึง team-b" });
    await callTool(TEAM_A, "create_handoff", {
      task_id: task.task_id as string,
      to: TEAM_B,
      context: "ส่งถึงทีมที่เคยโพสต์",
    });

    expect((await health()).unseen_targets).toEqual([]);
  });

  it("ใบที่มีคนรับไปแล้ว ไม่ถูกยกมาอีก เพราะไม่เหลืออะไรให้ใครทำ", async () => {
    const task = await callTool(TEAM_A, "create_task", { title: "งานที่ไซต์" });
    const handoff = await callTool(TEAM_A, "create_handoff", {
      task_id: task.task_id as string,
      to: SITE_NAME,
      context: "ส่งถึงไซต์",
    });
    // คนอื่นรับแทน ซึ่งเป็นสิ่งที่เกิดจริงกับ ho-0df9ca9c
    await callTool(TEAM_B, "accept_handoff", { handoff_id: handoff.handoff_id as string });

    const { unseen_targets, delegated } = await health();

    expect(unseen_targets).toEqual([]);
    // แต่ต้องไปโผล่อีกช่องหนึ่งแทน ไม่ใช่หายไปเฉย ๆ
    expect(delegated.total).toBe(1);
  });
});

describe("โต๊ะที่ไม่มีอะไรค้าง", () => {
  it("ทุกช่องเป็นศูนย์และเป็นรายการว่าง ไม่ใช่หายไปจากผลลัพธ์", async () => {
    expect(await health()).toEqual({
      handoffs: { waiting: 0, stale: 0, inactive: 0 },
      delegated: { handoffs: [], tasks: [], total: 0 },
      open_tasks: { unstarted: 0, parked: { tasks: [], total: 0 } },
      unseen_targets: [],
    });
  });
});
