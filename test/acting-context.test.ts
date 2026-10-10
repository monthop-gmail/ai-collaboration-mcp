/**
 * `acting_context` — บริบทที่ผู้เรียกประกาศว่าทำงานแทนใคร
 *
 * อนุมัติแบบขอบเขตแคบที่ `dis-3b5cb137` seq 44 · คีย์เดียว สาม tool
 * (`update_task` · `accept_handoff` · `resolve_decision`) · parameter ไม่ใช่ header
 *
 * **เหตุผลที่มี** วัดได้ว่ามี 48 ใบใน `ws-001` ที่ผู้ลงมือ ≠ ผู้ที่ใบระบุ (40 ใบเป็นการปิด)
 * และคำถามว่า *ช่วยทำแทนที่ถูกต้อง หรือปิดผิดใบ* ตอบจากระเบียนไม่ได้เลย ·
 * 27 ก.ย. 2026 มีการปิดใบของอีกทีมโดยทุกช่องที่ระบบคืนมาถูกต้องหมด มันเป็นของใบอื่นเท่านั้น
 *
 * ไฟล์นี้พิสูจน์เกณฑ์หลักฐานห้าข้อที่ `seq 44` ขอก่อนขยายขอบเขต
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";

const TOKEN = "acting-ctx-token-aaaaaaaaaaaaaaaaaaaa";
const SECRET = "acting-ctx-approval-secret";

let id = 0;

type Result = Record<string, unknown>;
type ActedAs = {
  addressed_to: string | null;
  acted_by: string | null;
  delegated: boolean;
  acting_context: string | null;
};

/** ยิงจริงผ่าน route · ชื่อผู้เรียกมาจาก `X-Client-Name` เหมือนทีม repo ใช้จริง */
async function call(
  as: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Result> {
  const ctx = createExecutionContext();
  const testEnv = {
    ...env,
    MCP_AUTH_TOKEN: TOKEN,
    APPROVAL_SECRET: SECRET,
    ALLOWED_ORIGIN_HOSTNAMES: "*",
  } as unknown as Parameters<typeof worker.fetch>[1];

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
  const payload = frame.result?.content?.[0]?.text ?? "{}";
  if (frame.result?.isError) throw new Error(payload);
  return JSON.parse(payload) as Result;
}

beforeEach(async () => {
  await resetDatabase();
});

/** ข้อ 1 ของ seq 44 */
describe("เข้ากันย้อนหลัง — ไม่ส่ง acting_context ต้องเหมือนเดิมทุกประการ", () => {
  it("update_task ที่ไม่ส่งบริบท ยังทำงานเหมือนเดิม และคีย์มีอยู่เป็น null", async () => {
    const task = (await call("team-a", "create_task", { title: "งาน", detail: "" }))
      .task_id as string;

    const after = await call("team-a", "update_task", { task_id: task, status: "done" });
    const acted = after.acted_as as ActedAs;

    expect(after.status).toBe("done");
    // คีย์ต้อง **มีอยู่** และเป็น null — ไม่ใช่หายไปจากผลลัพธ์ (absent ≠ empty)
    expect("acting_context" in acted).toBe(true);
    expect(acted.acting_context).toBeNull();
  });

  it("accept_handoff และ resolve_decision ที่ไม่ส่งบริบท ก็คืน null เช่นกัน", async () => {
    const task = (await call("team-a", "create_task", { title: "ส่งต่อ", detail: "" }))
      .task_id as string;
    const ho = (await call("team-a", "create_handoff", {
      task_id: task,
      to: "team-b",
      context: "x",
    })).handoff_id as string;

    const accepted = await call("team-b", "accept_handoff", { handoff_id: ho });
    expect((accepted.acted_as as ActedAs).acting_context).toBeNull();

    const dec = (await call("team-a", "record_decision", { title: "ใบ", detail: "x" }))
      .decision_id as string;
    const closed = await call("team-a", "resolve_decision", {
      decision_id: dec,
      verdict: "approved",
      reason: "ok",
    });
    expect("acting_context" in closed).toBe(true);
    expect(closed.acting_context).toBeNull();
  });
});

/** ข้อ 2 ของ seq 44 — กรณีที่เป็นเหตุผลของฟีเจอร์นี้ */
describe("งานข้ามทีม — บริบททำให้เจตนาถูกประกาศไว้", () => {
  /**
   * **กรณีที่ตัดสินไฟล์นี้**
   *
   * สองคำขอนี้ `delegated: true` เหมือนกันทุกประการ ต่างกันแค่ประกาศบริบทหรือไม่
   * ถ้าบริบทไม่ถูกบันทึกคู่กับ `delegated` ผู้อ่านจะแยกสองกรณีนี้ไม่ออก
   * ซึ่งคือสภาพก่อนมีฟีเจอร์นี้
   */
  it("ปิดใบของทีมอื่นโดยประกาศบริบท แยกออกจากการปิดโดยไม่ประกาศได้", async () => {
    const mine = (await call("team-b", "create_task", { title: "ของ team-b", detail: "" }))
      .task_id as string;
    await call("team-b", "update_task", { task_id: mine, assigned_to: "team-b" });

    const quiet = (await call("team-b", "create_task", { title: "อีกใบของ team-b", detail: "" }))
      .task_id as string;
    await call("team-b", "update_task", { task_id: quiet, assigned_to: "team-b" });

    // team-a ปิดใบของ team-b — ประกาศว่าทำแทนใคร
    const loud = await call("team-a", "update_task", {
      task_id: mine,
      status: "done",
      acting_context: "monthop-gmail/team-b",
    });
    // team-a ปิดอีกใบ — ไม่ประกาศอะไร
    const silent = await call("team-a", "update_task", { task_id: quiet, status: "done" });

    const a = loud.acted_as as ActedAs;
    const b = silent.acted_as as ActedAs;

    expect(a.delegated).toBe(true);
    expect(b.delegated).toBe(true);
    expect(a.acting_context).toBe("monthop-gmail/team-b");
    expect(b.acting_context).toBeNull();
  });

  it("รับ handoff ของทีมอื่นพร้อมประกาศบริบท", async () => {
    const task = (await call("team-a", "create_task", { title: "งาน", detail: "" }))
      .task_id as string;
    const ho = (await call("team-a", "create_handoff", {
      task_id: task,
      to: "team-b",
      context: "x",
    })).handoff_id as string;

    const accepted = await call("team-c", "accept_handoff", {
      handoff_id: ho,
      acting_context: "monthop-gmail/team-b",
    });
    const acted = accepted.acted_as as ActedAs;

    expect(acted.addressed_to).toBe("team-b");
    expect(acted.acted_by).toBe("team-c");
    expect(acted.delegated).toBe(true);
    expect(acted.acting_context).toBe("monthop-gmail/team-b");
  });
});

/** ข้อ 3 ของ seq 44 — ข้อที่สำคัญที่สุดด้านความปลอดภัย */
describe("บริบทที่ผิด ว่าง หรือกำมะลอ ต้องไม่เปลี่ยนตัวตนหรือสิทธิ์", () => {
  it("ประกาศบริบทเป็นชื่อคนอื่น ก็ยังถูกบันทึกว่าตัวเองลงมือ", async () => {
    const task = (await call("team-a", "create_task", { title: "งาน", detail: "" }))
      .task_id as string;

    const r = await call("team-a", "update_task", {
      task_id: task,
      status: "done",
      // อ้างว่าเป็นคนอื่น — ต้องไม่มีผลต่อ acted_by
      acting_context: "team-zzz",
    });
    const acted = r.acted_as as ActedAs;

    expect(r.updated_by).toBe("team-a");
    expect(acted.acted_by).toBe("team-a");
    expect(acted.acting_context).toBe("team-zzz");
  });

  /**
   * **บริบทต้องไม่ยกระดับหลักฐานการอนุมัติ**
   *
   * `decided_by_kind` เป็น `human` ได้เฉพาะเมื่อส่งรหัสอนุมัติที่ถูกต้อง · ถ้าบริบท
   * ยกระดับได้ มันจะกลายเป็นทางอ้อมรอบ `APPROVAL_SECRET` ซึ่งเป็นสิ่งเดียวที่ยืนยัน
   * ว่ามีคนอยู่ตรงนั้นจริง
   */
  it("บริบทไม่ยกระดับ decided_by_kind จาก relayed เป็น human", async () => {
    const dec = (await call("team-a", "record_decision", { title: "ใบ", detail: "x" }))
      .decision_id as string;

    const r = await call("team-a", "resolve_decision", {
      decision_id: dec,
      verdict: "approved",
      reason: "ไม่ได้ส่งรหัส",
      acting_context: "monthop-gmail",
    });

    expect(r.decided_by_kind).toBe("relayed");
    expect(r.acting_context).toBe("monthop-gmail");
  });

  it("สตริงว่างและช่องว่างล้วน = ไม่ได้ประกาศ และผู้เรียกเห็นเองจากผลลัพธ์", async () => {
    const task = (await call("team-a", "create_task", { title: "งาน", detail: "" }))
      .task_id as string;

    for (const value of ["", "   "]) {
      const r = await call("team-a", "update_task", {
        task_id: task,
        status: "in_progress",
        acting_context: value,
      });
      expect((r.acted_as as ActedAs).acting_context).toBeNull();
    }
  });

  it("บริบทยาวเกินเพดาน ถูกปฏิเสธ ไม่ใช่ตัดเงียบ", async () => {
    const task = (await call("team-a", "create_task", { title: "งาน", detail: "" }))
      .task_id as string;

    await expect(
      call("team-a", "update_task", {
        task_id: task,
        status: "done",
        acting_context: "x".repeat(201),
      }),
    ).rejects.toThrow();
  });
});

/** ข้อ 4 ของ seq 44 */
describe("เก็บแล้วอ่านกลับได้ตรงกัน", () => {
  it("บริบทที่ประกาศตอนแก้ใบ อ่านกลับได้จาก get_tasks", async () => {
    const task = (await call("team-a", "create_task", { title: "งาน", detail: "" }))
      .task_id as string;
    await call("team-a", "update_task", {
      task_id: task,
      status: "done",
      acting_context: "monthop-gmail/team-b",
    });

    const rows = (await call("team-a", "get_tasks", { limit: 50 })).tasks as Array<
      Record<string, unknown>
    >;
    const row = rows.find((t) => t.id === task)!;

    expect(row.acting_context).toBe("monthop-gmail/team-b");
  });

  it("ตัดช่องว่างหัวท้ายก่อนเก็บ", async () => {
    const task = (await call("team-a", "create_task", { title: "งาน", detail: "" }))
      .task_id as string;
    const r = await call("team-a", "update_task", {
      task_id: task,
      status: "done",
      acting_context: "  monthop-gmail/team-b  ",
    });

    expect((r.acted_as as ActedAs).acting_context).toBe("monthop-gmail/team-b");
  });

  /**
   * บริบทเป็นของ **การกระทำ** ไม่ใช่ของใบ · การรับใบไม่ควรทับบริบทที่ใบเคยมี
   * ถ้าเขียนลงทั้งใบและ handoff การรับครั้งถัดไปจะกลบของครั้งก่อนเงียบ ๆ
   */
  it("รับ handoff ไม่ทับบริบทที่ใบงานเคยประกาศไว้", async () => {
    const task = (await call("team-a", "create_task", { title: "งาน", detail: "" }))
      .task_id as string;
    await call("team-a", "update_task", { task_id: task, acting_context: "ของใบงาน" });

    const ho = (await call("team-a", "create_handoff", {
      task_id: task,
      to: "team-b",
      context: "x",
    })).handoff_id as string;
    await call("team-b", "accept_handoff", { handoff_id: ho, acting_context: "ของการรับใบ" });

    const rows = (await call("team-a", "get_tasks", { limit: 50 })).tasks as Array<
      Record<string, unknown>
    >;
    expect(rows.find((t) => t.id === task)!.acting_context).toBe("ของใบงาน");
  });
});

/** ข้อ 5 ของ seq 44 */
describe("ผู้บริโภคเดิมยังอ่านได้", () => {
  it("คีย์เดิมใน acted_as ยังอยู่ครบ และไม่มีคีย์ชื่อซ้อนกับตัวตน", async () => {
    const task = (await call("team-a", "create_task", { title: "งาน", detail: "" }))
      .task_id as string;
    const r = await call("team-a", "update_task", {
      task_id: task,
      status: "done",
      acting_context: "monthop-gmail/team-b",
    });

    expect(Object.keys(r.acted_as as object).sort()).toEqual([
      "acted_by",
      "acting_context",
      "addressed_to",
      "delegated",
    ]);
    // ไม่เพิ่ม authenticated_actor — ชื่อผู้ลงมืออยู่ที่ updated_by อยู่แล้ว
    expect("authenticated_actor" in r).toBe(false);
    // ยังไม่เพิ่ม context_source จนกว่าจะมีบริบทที่ตรวจได้จริง
    expect("context_source" in r).toBe(false);
  });
});
