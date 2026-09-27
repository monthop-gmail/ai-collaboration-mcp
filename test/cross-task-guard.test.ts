/**
 * ด่านกันการเขียนลงผิดใบ — และขอบเขตที่มันทำได้จริง
 *
 * 27 ก.ย. มีการเขียนบันทึกผลของงาน ThaiACC ลงในใบของ CARE แล้วกดปิด ส่วนใบ ThaiACC
 * ตัวจริงยังเปิดอยู่โดยไม่มีใครดู (`dis-65f4fe3e` seq 8) · `care-agent-platform`
 * จับได้เองและซ่อมสถานะใบของตัวเอง
 *
 * ## สิ่งที่วัดแล้วและเปลี่ยนแนวทางทั้งหมด
 *
 * ตัวแยกที่ดูน่าจะใช้ได้ — *"ผู้ลงมือเคยรับ handoff บนใบนั้นไหม"* — **เป็นโมฆะโดย
 * โครงสร้าง** เพราะ `acceptHandoff` ตั้ง `assigned_to` เป็นชื่อผู้รับ · เส้นทางที่ถูกต้อง
 * จึงไม่เคยปรากฏเป็น delegated เลยแม้แต่ใบเดียว
 *
 * วัดบน production แล้ว — ใบที่ `updated_by` ต่างจาก `assigned_to` มี **31 ใบ** และ
 * **27 ใบเป็น `done`** · กลุ่ม "รับ handoff แล้วแก้" ได้ **ศูนย์จากศูนย์** ไม่ใช่ศูนย์
 * เพราะข้อมูลน้อย
 *
 * **แปลว่าแยกเคสที่ผิดออกจากเคสที่ถูกด้วยตัวตนไม่ได้** · เทสต์ชุดนี้จึงล็อกสิ่งที่
 * ทำได้จริง คือ **ยื่นข้อมูลให้ผู้เรียกจับได้เอง** ไม่ใช่เดาแทนผู้เรียก
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";

const TOKEN = "guard-token-aaaaaaaaaaaaaaaaaaaaaaa";
const OWNER = "owner/team-care";
const OTHER = "owner/team-thaiacc";
const OTHER_TOKEN = "guard-other-bbbbbbbbbbbbbbbbbbbb";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: TOKEN,
  MCP_AUTH_TOKENS: `${OTHER_TOKEN}=${OTHER}`,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

let id = 0;

async function call(
  name: string,
  args: Record<string, unknown> = {},
  as: "owner" | "other" = "owner",
): Promise<Record<string, any>> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${as === "other" ? OTHER_TOKEN : TOKEN}`,
        ...(as === "other" ? {} : { "x-client-name": OWNER }),
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

const CARE_TITLE = "[CARE] ใบของทีมดูแลผู้ป่วย";

async function careTask(): Promise<string> {
  const t = await call("create_task", { title: CARE_TITLE, assigned_to: OWNER });
  return t.task_id as string;
}

beforeEach(async () => {
  await resetDatabase();
});

/**
 * ช่องที่บอกว่า **ใบไหน** — ช่องเดียวที่จะจับเคสนี้ได้
 *
 * ตอนเกิดเหตุ ทุกช่องที่ผลลัพธ์คืนกลับมาถูกต้องทั้งหมด `task_id` ก็ถูก `status` ก็ถูก
 * — **มันเป็นของใบอื่นเท่านั้น** · ผู้เรียกไม่มีอะไรให้ทักตัวเองเลย
 */
describe("ผลลัพธ์บอกว่าเป็นใบไหน", () => {
  it("update_task คืน title มาด้วย", async () => {
    const task = await careTask();

    const updated = await call("update_task", { task_id: task, status: "in_progress" });

    expect(updated.title).toBe(CARE_TITLE);
  });

  it("accept_handoff คืน task_title มาด้วย", async () => {
    const task = await careTask();
    const h = await call("create_handoff", {
      task_id: task,
      to: OTHER,
      context: "ส่งต่อให้ทีมอื่นดู",
    });

    const accepted = await call("accept_handoff", { handoff_id: h.handoff_id }, "other");

    expect(accepted.task_title).toBe(CARE_TITLE);
  });
});

/**
 * คำเตือนต้องมาตอนที่เคสจริงหน้าตาแบบนั้น และ **ต้องไม่มาตอนอื่น**
 *
 * ข้อหลังสำคัญเท่าข้อแรก — คำเตือนที่ขึ้นทุกครั้งคือคำเตือนที่ทุกคนเลิกอ่าน
 * ซึ่งเป็นโรคเดียวกับ CI แดงที่ไม่ใช่ของจริง
 */
describe("คำเตือนขึ้นเฉพาะ transition ที่ผลกระทบสูง โดยคนที่ไม่ใช่เจ้าของใบ", () => {
  it("คนอื่นกดปิดใบที่ไม่ใช่ของตัวเอง — เตือน พร้อม title เจ้าของใบ และผู้ลงมือ", async () => {
    const task = await careTask();

    const updated = await call("update_task", { task_id: task, status: "done" }, "other");

    expect(updated.cross_task_warning).toBeTruthy();
    const warning = updated.cross_task_warning as string;
    expect(warning).toContain(CARE_TITLE);
    expect(warning).toContain(OWNER);
    expect(warning).toContain(OTHER);
    expect(warning).toContain("done");
  });

  it("เจ้าของใบปิดใบตัวเอง — ไม่เตือน", async () => {
    const task = await careTask();

    const updated = await call("update_task", { task_id: task, status: "done" });

    expect(updated).not.toHaveProperty("cross_task_warning");
  });

  /**
   * `in_progress` ไม่เปลี่ยนความหมายของใบในสายตาคนอื่น — ใบยังอยู่ในรายการงานค้าง
   * ส่วน `done` ทำให้มันหายไปจากรายการของทุกคน
   */
  it("คนอื่นแก้เป็น in_progress — ไม่เตือน เพราะย้อนง่ายและไม่ซ่อนใบ", async () => {
    const task = await careTask();

    const updated = await call("update_task", { task_id: task, status: "in_progress" }, "other");

    expect(updated).not.toHaveProperty("cross_task_warning");
    // แต่ acted_as ยังบอกว่าผู้ลงมือไม่ใช่ผู้ที่ใบระบุ ตามเดิม
    expect(updated.acted_as.delegated).toBe(true);
  });

  it("blocked ก็เตือน เพราะเปลี่ยนความหมายของใบเหมือนกัน", async () => {
    const task = await careTask();

    const updated = await call("update_task", { task_id: task, status: "blocked" }, "other");

    expect(updated.cross_task_warning).toBeTruthy();
  });

  /**
   * รับ handoff แล้วปิด คือเส้นทางที่ถูกต้องและเกิดตลอดบนโต๊ะนี้
   *
   * ต้องไม่เตือน — และเหตุผลที่ไม่เตือนไม่ใช่เพราะเราตรวจ handoff แต่เพราะ
   * `accept_handoff` ตั้ง `assigned_to` เป็นชื่อผู้รับไปแล้ว ผู้ลงมือจึง**เป็น**เจ้าของใบ
   *
   * ข้อนี้คือเหตุผลที่ตัวแยก "เคยรับ handoff ไหม" เป็นโมฆะ — มันไม่มีเคสให้แยก
   */
  it("รับ handoff แล้วปิด — ไม่เตือน เพราะผู้รับกลายเป็นเจ้าของใบไปแล้ว", async () => {
    const task = await careTask();
    const h = await call("create_handoff", { task_id: task, to: OTHER, context: "ส่งต่อ" });
    await call("accept_handoff", { handoff_id: h.handoff_id }, "other");

    const updated = await call("update_task", { task_id: task, status: "done" }, "other");

    expect(updated).not.toHaveProperty("cross_task_warning");
    expect(updated.acted_as.delegated).toBe(false);
    expect(updated.assigned_to).toBe(OTHER);
  });
});

/**
 * คำเตือนสองเรื่องเกิดพร้อมกันได้ และต้องไม่กลบกัน
 */
describe("ช่องคำเตือนแยกจากกัน", () => {
  it("เปลี่ยนเจ้าของและปิดใบในคำสั่งเดียว ได้คำเตือนทั้งสองช่อง", async () => {
    const task = await careTask();

    const updated = await call(
      "update_task",
      { task_id: task, status: "done", assigned_to: "owner/team-สาม" },
      "other",
    );

    // note มาจาก handoffReminder — เตือนว่าเปลี่ยนเจ้าของแต่ไม่ได้ส่งต่อจริง
    expect(updated.note).toBeTruthy();
    // cross_task_warning มาจากการปิดใบที่ไม่ใช่ของตัวเอง
    expect(updated.cross_task_warning).toBeTruthy();
    expect(updated.note).not.toBe(updated.cross_task_warning);
  });
});
