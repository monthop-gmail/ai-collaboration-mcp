import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "./apply-schema";
import { RequestError, createDiscussion, readMessages } from "../src/db";
import {
  acceptHandoff,
  createHandoff,
  createTask,
  getTask,
  readDecisions,
  readHandoffs,
  readTasks,
  readPlans,
  recordDecision,
  recordPlan,
  resolveDecision,
  updateTask,
} from "../src/db-work";

const chatgpt = { client: "c-chatgpt", name: "ChatGPT" };
const claude = { client: "c-claude", name: "Claude" };
const gemini = { client: "c-gemini", name: "Gemini" };

beforeEach(async () => {
  await resetDatabase();
});

const WS = "ws-001";

describe("decision", () => {
  /**
   * ข้อนี้สำคัญที่สุดของ Phase 2 — ถ้ามีใครเพิ่มทางให้ตั้ง status เองเมื่อไหร่
   * ตารางนี้จะไม่ต่างจากข้อความธรรมดา และหลักการ "เสนอไม่เท่ากับตัดสิน" ก็หายไป
   */
  it("สร้างได้เฉพาะสถานะ proposed", async () => {
    const d = await recordDecision(env.DB, WS, "ใช้ D1", "เพราะต้องการ transaction", chatgpt);

    expect(d.status).toBe("proposed");
    expect(d.decided_by).toBeNull();
    expect(d.decided_at).toBeNull();
  });

  it("เก็บทั้งชื่อและ client ของผู้เสนอ", async () => {
    await recordDecision(env.DB, WS, "ใช้ D1", "เหตุผล", gemini);
    const page = await readDecisions(env.DB, WS, 10);

    expect(page.rows[0]!.proposed_by).toBe("Gemini");
    expect(page.rows[0]!.proposed_by_client).toBe("c-gemini");
  });

  it("ผูกกับกระทู้ที่เป็นที่มาได้", async () => {
    const dis = await createDiscussion(env.DB, WS, "ควรใช้อะไร", chatgpt);
    const d = await recordDecision(env.DB, WS, "ใช้ D1", "เหตุผล", chatgpt, dis.id);

    expect(d.discussion_id).toBe(dis.id);
  });

  it("ผูกกับกระทู้ที่ไม่มีอยู่ไม่ได้", async () => {
    await expect(
      recordDecision(env.DB, WS, "x", "y", chatgpt, "ไม่มีจริง"),
    ).rejects.toThrow(RequestError);
  });

  it("กรองตามสถานะได้ และบอก has_more เมื่อถูกตัด", async () => {
    for (let i = 0; i < 4; i++) {
      await recordDecision(env.DB, WS, `ข้อสรุป ${i}`, "เหตุผล", chatgpt);
    }

    const all = await readDecisions(env.DB, WS, 2);
    expect(all.rows).toHaveLength(2);
    expect(all.has_more).toBe(true);
    expect(all.total).toBe(4);

    const approved = await readDecisions(env.DB, WS, 10, "approved");
    expect(approved.rows).toEqual([]);
    expect(approved.total).toBe(0);
  });
});

describe("task", () => {
  it("เริ่มที่ open และจำผู้สร้าง", async () => {
    const t = await createTask(env.DB, WS, "ย้ายไป D1", "รายละเอียด", chatgpt);

    expect(t.status).toBe("open");
    expect(t.created_by).toBe("ChatGPT");
    expect(t.assigned_to).toBeNull();
    expect(t.updated_by).toBeNull();
  });

  it("แก้สถานะแล้วบันทึกว่าใครแก้", async () => {
    const t = await createTask(env.DB, WS, "งาน", "", chatgpt);
    const after = await updateTask(env.DB, t.id, claude, { status: "done" });

    expect(after.status).toBe("done");
    expect(after.updated_by).toBe("Claude");
    expect(after.updated_at).not.toBeNull();
  });

  /**
   * เรียกโดยไม่เปลี่ยนอะไรแล้วได้ success กลับไป จะทำให้ผู้เรียกเชื่อว่าแก้แล้ว
   * ทั้งที่ไม่ได้แก้ — เป็นรูปแบบเดียวกับบั๊กที่ไล่แก้มาทั้งโปรเจกต์ก่อนหน้า
   */
  it("ไม่ระบุอะไรให้แก้เลย ต้อง error ไม่ใช่เงียบ ๆ ผ่าน", async () => {
    const t = await createTask(env.DB, WS, "งาน", "", chatgpt);
    await expect(updateTask(env.DB, t.id, claude, {})).rejects.toThrow(RequestError);
  });

  it("แก้งานที่ไม่มีอยู่ ต้อง error", async () => {
    await expect(
      updateTask(env.DB, "ไม่มีจริง", claude, { status: "done" }),
    ).rejects.toThrow(RequestError);
  });

  it("กรองตามสถานะและผู้รับผิดชอบได้", async () => {
    const a = await createTask(env.DB, WS, "งาน A", "", chatgpt);
    await createTask(env.DB, WS, "งาน B", "", chatgpt);
    await updateTask(env.DB, a.id, claude, { status: "done", assigned_to: "Claude" });

    const done = await readTasks(env.DB, WS, 10, { status: "done" });
    expect(done.rows.map((t) => t.title)).toEqual(["งาน A"]);

    const mine = await readTasks(env.DB, WS, 10, { assigned_to: "Claude" });
    expect(mine.rows).toHaveLength(1);

    const open = await readTasks(env.DB, WS, 10, { status: "open" });
    expect(open.rows.map((t) => t.title)).toEqual(["งาน B"]);
  });
});

describe("handoff", () => {
  it("ส่งต่อแล้วงานเปลี่ยนผู้รับผิดชอบไปด้วย", async () => {
    const t = await createTask(env.DB, WS, "ย้าย schema", "", chatgpt);
    const { handoff, task } = await createHandoff(
      env.DB,
      t.id,
      "Claude",
      "ทำ schema เสร็จแล้ว เหลือ migration",
      chatgpt,
    );

    expect(handoff.status).toBe("pending");
    expect(handoff.from_name).toBe("ChatGPT");
    // ถ้าสองที่ไม่ตรงกัน คนอ่านตาราง task จะไม่รู้ว่างานย้ายไปแล้ว
    expect(task.assigned_to).toBe("Claude");
  });

  it("รับงานแล้วเปลี่ยนเป็น in_progress และผู้รับคือคนที่เรียก", async () => {
    const t = await createTask(env.DB, WS, "งาน", "", chatgpt);
    const { handoff } = await createHandoff(env.DB, t.id, "ใครก็ได้", "ช่วยที", chatgpt);

    const result = await acceptHandoff(env.DB, handoff.id, gemini);

    expect(result.handoff.accepted_by).toBe("Gemini");
    expect(result.handoff.accepted_client).toBe("c-gemini");
    expect(result.task.status).toBe("in_progress");
    // ชื่อจริงของผู้รับ ไม่ใช่ค่าที่ผู้ส่งพิมพ์ไว้
    expect(result.task.assigned_to).toBe("Gemini");
  });

  it("รับซ้ำไม่ได้ และบอกว่าใครรับไปแล้ว", async () => {
    const t = await createTask(env.DB, WS, "งาน", "", chatgpt);
    const { handoff } = await createHandoff(env.DB, t.id, "Claude", "ช่วยที", chatgpt);
    await acceptHandoff(env.DB, handoff.id, claude);

    await expect(acceptHandoff(env.DB, handoff.id, gemini)).rejects.toThrow(/Claude/);
  });

  it("ส่งต่องานที่ไม่มีอยู่ไม่ได้", async () => {
    await expect(
      createHandoff(env.DB, "ไม่มีจริง", "Claude", "ช่วยที", chatgpt),
    ).rejects.toThrow(RequestError);
  });

  it("กรองเฉพาะที่ยังไม่มีใครรับได้", async () => {
    const a = await createTask(env.DB, WS, "งาน A", "", chatgpt);
    const b = await createTask(env.DB, WS, "งาน B", "", chatgpt);
    const first = await createHandoff(env.DB, a.id, "Claude", "ช่วยที", chatgpt);
    await createHandoff(env.DB, b.id, "Gemini", "ช่วยด้วย", chatgpt);
    await acceptHandoff(env.DB, first.handoff.id, claude);

    const pending = await readHandoffs(env.DB, 10, { status: "pending" });
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0]!.to_whom).toBe("Gemini");

    const forClaude = await readHandoffs(env.DB, 10, { to_whom: "Claude" });
    expect(forClaude.rows).toHaveLength(1);
  });

  it("เส้นทางเต็ม: กระทู้ → decision → task → handoff → รับงาน", async () => {
    const dis = await createDiscussion(env.DB, WS, "ควรใช้ D1 หรือ KV", chatgpt);
    const dec = await recordDecision(env.DB, WS, "ใช้ D1", "ต้องการ transaction", chatgpt, dis.id);
    const task = await createTask(env.DB, WS, "ย้ายไป D1", "ตามข้อสรุป", chatgpt, dis.id);
    const { handoff } = await createHandoff(env.DB, task.id, "Gemini", "เหลือ migration", chatgpt);
    await acceptHandoff(env.DB, handoff.id, gemini);

    const final = await getTask(env.DB, task.id);
    expect(dec.discussion_id).toBe(dis.id);
    expect(final.discussion_id).toBe(dis.id);
    expect(final.status).toBe("in_progress");
    expect(final.assigned_to).toBe("Gemini");
  });
});

describe("plan", () => {
  it("บันทึกแล้วอ่านกลับได้ พร้อมผู้เขียนจาก connection", async () => {
    const p = await recordPlan(env.DB, WS, "ย้ายไป D1", "ขั้นตอนหนึ่งสองสาม", gemini);

    expect(p.created_by).toBe("Gemini");
    expect(p.created_by_client).toBe("c-gemini");
    expect(p.supersedes).toBeNull();
  });

  it("ผูกกับกระทู้และข้อสรุปที่เป็นที่มาได้", async () => {
    const dis = await createDiscussion(env.DB, WS, "ควรใช้อะไร", chatgpt);
    const dec = await recordDecision(env.DB, WS, "ใช้ D1", "เหตุผล", chatgpt, dis.id);
    const p = await recordPlan(env.DB, WS, "แผน", "ขั้นตอน", chatgpt, {
      discussionId: dis.id,
      decisionId: dec.id,
    });

    expect(p.discussion_id).toBe(dis.id);
    expect(p.decision_id).toBe(dec.id);
  });

  it.each([
    ["กระทู้", { discussionId: "ไม่มีจริง" }],
    ["ข้อสรุป", { decisionId: "ไม่มีจริง" }],
    ["แผนที่จะเขียนทับ", { supersedes: "ไม่มีจริง" }],
  ])("ผูกกับ%sที่ไม่มีอยู่ไม่ได้", async (_label, links) => {
    await expect(
      recordPlan(env.DB, WS, "แผน", "ขั้นตอน", chatgpt, links),
    ).rejects.toThrow(RequestError);
  });

  /**
   * หัวใจของ Plan — แผนเก่าที่กองรวมกับแผนใหม่คือกับดักเดียวกับผลที่ถูกตัดแล้ว
   * ดูเหมือนครบ ผู้อ่านไม่มีทางรู้ว่าอันไหนใช้อยู่
   */
  it("แผนที่ถูกเขียนทับหายไปจากผลลัพธ์", async () => {
    const first = await recordPlan(env.DB, WS, "แผนแรก", "แบบเดิม", chatgpt);
    const second = await recordPlan(env.DB, WS, "แผนใหม่", "แบบใหม่", gemini, {
      supersedes: first.id,
    });

    const current = await readPlans(env.DB, WS, 10);
    expect(current.rows.map((p) => p.id)).toEqual([second.id]);
    expect(current.total).toBe(1);
  });

  it("ขอดูของเก่าด้วยก็ได้ และยังตามรอยได้ว่าอะไรแทนอะไร", async () => {
    const first = await recordPlan(env.DB, WS, "แผนแรก", "แบบเดิม", chatgpt);
    await recordPlan(env.DB, WS, "แผนใหม่", "แบบใหม่", gemini, { supersedes: first.id });

    const all = await readPlans(env.DB, WS, 10, { includeSuperseded: true });
    expect(all.total).toBe(2);
    expect(all.rows.find((p) => p.supersedes === first.id)).toBeDefined();
  });

  it("เขียนทับต่อกันหลายชั้น เหลือตัวล่าสุดตัวเดียว", async () => {
    const v1 = await recordPlan(env.DB, WS, "v1", "หนึ่ง", chatgpt);
    const v2 = await recordPlan(env.DB, WS, "v2", "สอง", chatgpt, { supersedes: v1.id });
    const v3 = await recordPlan(env.DB, WS, "v3", "สาม", chatgpt, { supersedes: v2.id });

    const current = await readPlans(env.DB, WS, 10);
    expect(current.rows.map((p) => p.id)).toEqual([v3.id]);
  });

  it("กรองเฉพาะแผนของกระทู้หนึ่งได้", async () => {
    const dis = await createDiscussion(env.DB, WS, "กระทู้", chatgpt);
    await recordPlan(env.DB, WS, "ของกระทู้", "x", chatgpt, { discussionId: dis.id });
    await recordPlan(env.DB, WS, "ลอย ๆ", "y", chatgpt);

    const page = await readPlans(env.DB, WS, 10, { discussionId: dis.id });
    expect(page.rows.map((p) => p.title)).toEqual(["ของกระทู้"]);
  });

  it("บอก has_more เมื่อผลถูกตัด", async () => {
    for (let i = 0; i < 4; i++) await recordPlan(env.DB, WS, `แผน ${i}`, "x", chatgpt);

    const page = await readPlans(env.DB, WS, 2);
    expect(page.rows).toHaveLength(2);
    expect(page.has_more).toBe(true);
    expect(page.total).toBe(4);
  });
});

describe("ปิด decision", () => {
  async function proposed() {
    const dis = await createDiscussion(env.DB, WS, "ควรใช้อะไร", chatgpt);
    const dec = await recordDecision(env.DB, WS, "ใช้ D1", "เหตุผล", chatgpt, dis.id);
    return { dis, dec };
  }

  it("อนุมัติแล้วบันทึกผู้ปิดและเหตุผล", async () => {
    const { dec } = await proposed();
    const { decision } = await resolveDecision(
      env.DB, dec.id, "approved", "ทีมเห็นพ้อง", claude,
    );

    expect(decision.status).toBe("approved");
    expect(decision.decided_by).toBe("Claude");
    expect(decision.decided_by_client).toBe("c-claude");
    expect(decision.decided_reason).toBe("ทีมเห็นพ้อง");
    expect(decision.decided_at).not.toBeNull();
  });

  it("ปฏิเสธของที่ซ้ำได้ — ปัญหาที่ Cursor ชนจริง", async () => {
    const { dec } = await proposed();
    const { decision } = await resolveDecision(
      env.DB, dec.id, "rejected", "ซ้ำกับอีกอัน", claude,
    );
    expect(decision.status).toBe("rejected");

    const stillOpen = await readDecisions(env.DB, WS, 10, "proposed");
    expect(stillOpen.total).toBe(0);
  });

  /**
   * ไม่มีรหัส = `relayed` ไม่ใช่ `human` ผู้เรียกยกระดับตัวเองไม่ได้ เพราะวัดมาแล้วว่า
   * สิ่งที่ agent รายงานเกี่ยวกับการกระทำของตัวเองเชื่อไม่ได้
   */
  it("ไม่ส่งรหัสมา ได้ relayed", async () => {
    const { dec } = await proposed();
    const { decision } = await resolveDecision(env.DB, dec.id, "approved", "x", claude);
    expect(decision.decided_by_kind).toBe("relayed");
  });

  it("ส่งรหัสถูก ได้ human", async () => {
    const { dec } = await proposed();
    const { decision } = await resolveDecision(
      env.DB, dec.id, "approved", "x", claude, { code: "s3cret", secret: "s3cret" },
    );
    expect(decision.decided_by_kind).toBe("human");
  });

  /** พิมพ์รหัสผิดแล้วได้ผลที่อ่อนกว่าที่ตั้งใจโดยไม่มีใครบอก คือความล้มเหลวแบบเงียบ */
  it("ส่งรหัสผิด ต้อง error ไม่ใช่ลดชั้นเงียบ ๆ", async () => {
    const { dec } = await proposed();
    await expect(
      resolveDecision(env.DB, dec.id, "approved", "x", claude, {
        code: "ผิด", secret: "s3cret",
      }),
    ).rejects.toThrow(RequestError);

    const after = await readDecisions(env.DB, WS, 10, "proposed");
    expect(after.total).toBe(1);
  });

  it("ส่งรหัสมาแต่เซิร์ฟเวอร์ไม่ได้ตั้งไว้ ต้อง error", async () => {
    const { dec } = await proposed();
    await expect(
      resolveDecision(env.DB, dec.id, "approved", "x", claude, { code: "อะไรก็ได้" }),
    ).rejects.toThrow(RequestError);
  });

  it("ปิดซ้ำไม่ได้ และบอกว่าใครปิดไปแล้ว", async () => {
    const { dec } = await proposed();
    await resolveDecision(env.DB, dec.id, "approved", "x", claude);

    await expect(
      resolveDecision(env.DB, dec.id, "rejected", "y", gemini),
    ).rejects.toThrow(/Claude/);
  });

  it("ประกาศกลับเข้ากระทู้ให้ทุกคนเห็น", async () => {
    const { dis, dec } = await proposed();
    const before = await readMessages(env.DB, dis.id, 0, 50);

    const { announced } = await resolveDecision(
      env.DB, dec.id, "approved", "ทีมเห็นพ้อง", claude,
    );

    const after = await readMessages(env.DB, dis.id, 0, 50);
    expect(announced).toBe(true);
    expect(after.total).toBe(before.total + 1);
    expect(after.messages.at(-1)!.body).toContain("ทีมเห็นพ้อง");
    expect(after.messages.at(-1)!.author_name).toBe("Claude");
  });

  it("decision ที่ไม่ได้ผูกกระทู้ ก็ปิดได้ แค่ไม่มีที่ประกาศ", async () => {
    const dec = await recordDecision(env.DB, WS, "ลอย ๆ", "เหตุผล", chatgpt);
    const { announced, decision } = await resolveDecision(
      env.DB, dec.id, "approved", "x", claude,
    );
    expect(announced).toBe(false);
    expect(decision.status).toBe("approved");
  });

  it("ปิด decision ที่ไม่มีอยู่ ต้อง error", async () => {
    await expect(
      resolveDecision(env.DB, "ไม่มีจริง", "approved", "x", claude),
    ).rejects.toThrow(RequestError);
  });
});
