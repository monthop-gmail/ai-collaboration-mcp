/**
 * การรับ handoff ต้องไม่ลบสัญญาณ `blocked` ของใบงาน
 *
 * ## แผลจริง
 *
 * 10 ต.ค. 2026 ตั้งใบ `task-386847a6` กับ `task-f8d82921` เป็น `blocked` พร้อมเขียนเหตุไว้
 * ครบ ว่าทำอะไรเสร็จ ติดตรงไหน ใครปลดล็อกได้ · แล้วรับ handoff ที่ค้างอยู่สองใบ ·
 * **สถานะเด้งกลับเป็น `in_progress` ทั้งคู่โดยไม่มีอะไรฟ้อง**
 *
 * เหตุที่บล็อกยังอยู่ในบันทึก แต่สัญญาณที่ **เครื่อง** อ่านได้หายไป — `health` กับ `/view`
 * เลิกนับใบนั้นว่าต้องปลดล็อก · ใบที่ติดจริงจึงดูเหมือนใบที่กำลังเดินอยู่
 *
 * ## ทำไมไม่มีด่านไหนจับ
 *
 * ลำดับปกติคือ **รับใบก่อน แล้วค่อยพบว่าติด** — เส้นนั้นไม่เจอปัญหานี้เลย ·
 * มันพังเฉพาะลำดับกลับ คือ **รู้ว่าติดก่อน แล้วค่อยรับใบ** ซึ่งเกิดเมื่อคนทำงานเสร็จ
 * ไปแล้วและย้อนมาเก็บใบที่ค้าง · ไม่มีเทสต์ไหนเดินลำดับนั้น 397 ตัวจึงผ่านหมด
 *
 * `done` ไม่ต้องกันที่นี่ — `handoffState` คืน `obsolete` แล้วโยน error ก่อนถึงจุดนั้น
 * และไฟล์นี้ล็อกไว้ด้วย เพื่อให้รู้ตัวถ้ามีใครย้ายด่านนั้นออก
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";

const TOKEN = "accept-token-aaaaaaaaaaaaaaaaaaaa";
const SENDER = "owner/team-sender";
const TAKER = "owner/team-taker";
const TAKER_TOKEN = "accept-taker-bbbbbbbbbbbbbbbbbbb";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: TOKEN,
  MCP_AUTH_TOKENS: `${TAKER_TOKEN}=${TAKER}`,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

let id = 0;

async function call(
  name: string,
  args: Record<string, unknown> = {},
  as: "sender" | "taker" = "sender",
): Promise<Record<string, any>> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${as === "taker" ? TAKER_TOKEN : TOKEN}`,
        ...(as === "taker" ? {} : { "x-client-name": SENDER }),
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
  const payload = frame.result?.content?.[0]?.text ?? "";
  if (frame.result?.isError) throw new Error(payload);
  return JSON.parse(payload || "{}");
}

/** ใบงานหนึ่งใบที่มี handoff รออยู่ · คืนรหัสทั้งคู่ */
async function taskWithHandoff(): Promise<{ task: string; handoff: string }> {
  const task = (await call("create_task", { title: "ใบที่จะถูกส่งต่อ" })).task_id as string;
  const handoff = (
    await call("create_handoff", {
      task_id: task,
      to: TAKER,
      context: "ส่งต่อให้ทีมที่รับ",
    })
  ).handoff_id as string;
  return { task, handoff };
}

async function statusOf(task: string): Promise<string> {
  const r = await call("get_tasks", { limit: 50 });
  return (r.tasks as Array<{ id: string; status: string }>).find((t) => t.id === task)!.status;
}

beforeEach(async () => {
  await resetDatabase();
});

describe("ใบที่ยังไม่มีใครเริ่ม — การรับใบต้องเลื่อนให้", () => {
  it("open กลายเป็น in_progress และบอกว่าการรับใบเป็นคนเลื่อน", async () => {
    const { task, handoff } = await taskWithHandoff();

    const r = await call("accept_handoff", { handoff_id: handoff }, "taker");

    expect(r.task_status).toBe("in_progress");
    expect(r.task_status_source).toBe("accept");
    expect(r.task_status_note).toContain("in_progress");
    expect(await statusOf(task)).toBe("in_progress");
  });
});

describe("ใบที่ติดอยู่ — การรับใบต้องไม่ลบสัญญาณนั้น", () => {
  /**
   * **กรณีที่ตัดสินไฟล์นี้**
   *
   * ลำดับคือ *ตั้ง `blocked` ก่อน แล้วค่อยรับใบ* ซึ่งเป็นลำดับที่เกิดตอน 10 ต.ค.
   * ถ้าสลับลำดับเป็นรับก่อนแล้วตั้ง `blocked` เทสต์จะผ่านแม้บั๊กยังอยู่
   */
  it("blocked ยังเป็น blocked หลังรับใบ", async () => {
    const { task, handoff } = await taskWithHandoff();
    await call("update_task", { task_id: task, status: "blocked", note: "รอทีมอื่นปลดล็อก" });

    const r = await call("accept_handoff", { handoff_id: handoff }, "taker");

    expect(r.task_status).toBe("blocked");
    expect(await statusOf(task)).toBe("blocked");
  });

  it("บอกว่าไม่ได้เลื่อนให้ และบอกว่าต้องทำอะไรต่อ", async () => {
    const { task, handoff } = await taskWithHandoff();
    await call("update_task", { task_id: task, status: "blocked" });

    const r = await call("accept_handoff", { handoff_id: handoff }, "taker");

    // ผู้อ่านต้องแยก *ไม่ได้เลื่อน* ออกจาก *เลื่อนแล้ว* ได้จากผลลัพธ์เดียว
    expect(r.task_status_source).toBe("unchanged");
    expect(r.task_status_note).toContain("update_task");
  });

  /**
   * การรับใบยัง **ทำงานของตัวเองครบ** — ที่ไม่ทำคือเลื่อนสถานะเท่านั้น
   *
   * ถ้าข้อนี้พัง แปลว่าแก้บั๊กด้วยการตัดการรับใบทิ้ง ไม่ใช่ด้วยการกันสถานะ
   */
  it("ยังบันทึกผู้รับและยังย้าย assigned_to ให้ตามปกติ", async () => {
    const { handoff } = await taskWithHandoff();
    await call("update_task", {
      task_id: (await call("get_tasks", { limit: 5 })).tasks[0].id,
      status: "blocked",
    });

    const r = await call("accept_handoff", { handoff_id: handoff }, "taker");

    expect(r.accepted_by).toBe(TAKER);
    expect(r.task_assigned_to).toBe(TAKER);
    expect(r.acted_as.acted_by).toBe(TAKER);
  });

  it("ปลดล็อกเองได้ตามที่ข้อความบอก — ทางออกไม่ได้ถูกปิด", async () => {
    const { task, handoff } = await taskWithHandoff();
    await call("update_task", { task_id: task, status: "blocked" });
    await call("accept_handoff", { handoff_id: handoff }, "taker");

    await call("update_task", { task_id: task, status: "in_progress" }, "taker");

    expect(await statusOf(task)).toBe("in_progress");
  });
});

describe("ด่านที่มีอยู่แล้วต้องไม่หายไปตอนแก้", () => {
  it("ใบที่ done แล้ว รับไม่ได้ตั้งแต่ต้น ไม่ใช่รับได้แล้วคงสถานะ", async () => {
    const { task, handoff } = await taskWithHandoff();
    await call("update_task", { task_id: task, status: "done", result_ref: "dis-x#1" });

    await expect(call("accept_handoff", { handoff_id: handoff }, "taker")).rejects.toThrow(
      /เสร็จไปแล้ว/,
    );
    expect(await statusOf(task)).toBe("done");
  });
});
