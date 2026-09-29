/**
 * "ปิดแล้ว" ไม่เท่ากับ "ผลถูกบันทึกแล้ว"
 *
 * วัดไว้ใน `dis-c6095786` seq 36 · ใบที่ `done` 12 ใบล่าสุดมีสามใบที่ `detail`
 * ยังเป็นคำสั่งที่สั่งให้ส่งผลกลับ (`task-47cf3897` · `task-3a1cb147` · `task-d878ce88`)
 * และ **อนุมานจาก `updated_at` ไม่ได้** เพราะเวลาขยับทุกใบที่ปิด ไม่ว่าจะเขียนผลกลับหรือไม่
 *
 * `result_ref` เป็นตัวชี้ ไม่ใช่ที่เก็บผล · `null` แปลว่า **ยังไม่มีใครบันทึกตัวชี้**
 * ไม่ได้แปลว่าไม่มีผล
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";

const TOKEN = "result-ref-token-aaaaaaaaaaaaaaaaaa";
let id = 0;

async function call(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ctx = createExecutionContext();
  const testEnv = {
    ...env,
    MCP_AUTH_TOKEN: TOKEN,
    ALLOWED_ORIGIN_HOSTNAMES: "*",
  } as unknown as Parameters<typeof worker.fetch>[1];

  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${TOKEN}`,
        "x-client-name": "result-team",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (id += 1),
        method: "tools/call",
        params: { name: tool, arguments: args },
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
  return JSON.parse(payload || "{}") as Record<string, unknown>;
}

type Health = {
  done_without_result: { tasks: Array<{ id: string }>; total: number; note: string };
};

async function health(): Promise<Health> {
  const ctx = (await call("get_workspace_context", { limit: 1 })).open_items as {
    health: Health;
  };
  return ctx.health;
}

beforeEach(async () => {
  await resetDatabase();
});

describe("ตัวชี้ผลของงาน", () => {
  it("งานที่เพิ่งเปิดคืน result_ref เป็น null ไม่ใช่คีย์ที่หายไป", async () => {
    const task = await call("create_task", { title: "ใหม่", detail: "" });
    const rows = (await call("get_tasks", { limit: 50 })).tasks as Array<Record<string, unknown>>;
    const row = rows.find((t) => t.id === task.task_id)!;

    expect("result_ref" in row).toBe(true);
    expect(row.result_ref).toBeNull();
  });

  it("บันทึกตัวชี้แล้วอ่านกลับได้ และถอนออกได้", async () => {
    const task = await call("create_task", { title: "มีผล", detail: "" });

    const set = await call("update_task", {
      task_id: task.task_id,
      result_ref: "dis-c6095786#36",
    });
    expect(set.result_ref).toBe("dis-c6095786#36");

    // null ต่างจากไม่ส่งมา — ส่ง null คือถอนตัวชี้ออก
    const cleared = await call("update_task", { task_id: task.task_id, result_ref: null });
    expect(cleared.result_ref).toBeNull();
  });

  it("แก้อย่างอื่นโดยไม่ส่ง result_ref ต้องไม่ล้างตัวชี้ที่มีอยู่", async () => {
    const task = await call("create_task", { title: "อย่าล้างของฉัน", detail: "" });
    await call("update_task", { task_id: task.task_id, result_ref: "dis-x#1" });

    const after = await call("update_task", { task_id: task.task_id, status: "in_progress" });

    expect(after.result_ref).toBe("dis-x#1");
  });
});

describe("health.done_without_result", () => {
  /**
   * **กรณีที่ตัดสินไฟล์นี้**
   *
   * สองใบนี้ `done` เหมือนกัน แก้ครั้งล่าสุดเหมือนกัน ต่างกันแค่มีตัวชี้ผลหรือไม่
   * ตัวนับที่ไปดู `status` หรือ `updated_at` แทนที่จะดู `result_ref` จะนับทั้งคู่
   * หรือไม่นับเลย แล้วช่องนี้ก็ไม่ได้บอกอะไร
   */
  it("นับเฉพาะใบที่ปิดแล้วและไม่มีตัวชี้ผล", async () => {
    const quiet = await call("create_task", { title: "ปิดแบบไม่บอกผล", detail: "" });
    const loud = await call("create_task", { title: "ปิดพร้อมบอกผล", detail: "" });

    await call("update_task", { task_id: quiet.task_id, status: "done" });
    await call("update_task", {
      task_id: loud.task_id,
      status: "done",
      result_ref: "dis-c6095786#36",
    });

    const h = await health();

    expect(h.done_without_result.total).toBe(1);
    expect(h.done_without_result.tasks.map((t) => t.id)).toEqual([quiet.task_id]);
  });

  it("ใบที่ยังไม่ปิดไม่ถูกนับ แม้ไม่มีตัวชี้ผล", async () => {
    await call("create_task", { title: "ยังทำอยู่", detail: "" });

    expect((await health()).done_without_result.total).toBe(0);
  });

  it("note ติดมาเสมอแม้ยอดเป็นศูนย์ และต้องไม่เอ่ยชื่อ tool ฝั่งเขียน", async () => {
    const h = await health();

    expect(h.done_without_result.total).toBe(0);
    // ตัวเลขที่ถูกอ่านผิดครั้งแรกจะถูกเลิกอ่านตลอดไป — note ต้องอยู่ตั้งแต่ยังไม่มีของ
    expect(h.done_without_result.note).toContain("ไม่ได้แปลว่าไม่มีผล");
    // `health` เดินทางไปถึงเส้นอ่านอย่างเดียวด้วย ซึ่ง tool เหล่านี้ถูกซ่อนไว้
    expect(h.done_without_result.note).not.toContain("update_task");
  });
});
