/**
 * OAC-1 — เทียบ APPROVAL_SECRET แบบ constant-time และบันทึก `decided_by_method`
 *
 * ทุกข้อในไฟล์นี้ต้องตายถ้า `timingSafeEqualStr` ถูกเปลี่ยนให้คืน `true` เสมอ —
 * ทั้งเทสต์ของ helper เอง และเทสต์ "รหัสผิดต้องถูกปฏิเสธ" ของทั้งสองทางเข้า
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "./apply-schema";
import { RequestError } from "../src/db";
import {
  readDecisions,
  recordDecision,
  resolveDecision,
  setDecisionScope,
} from "../src/db-work";
import { timingSafeEqualStr } from "../src/timing-safe";

const claude = { client: "c-claude", name: "Claude" };
const WS = "ws-001";
// ค่าทดสอบเท่านั้น ไม่ใช่รหัสจริง
const SECRET = "test-secret-not-real";

beforeEach(async () => {
  await resetDatabase();
});

describe("timingSafeEqualStr", () => {
  it("เท่ากัน → true", () => {
    expect(timingSafeEqualStr(SECRET, SECRET)).toBe(true);
    expect(timingSafeEqualStr("รหัสไทย", "รหัสไทย")).toBe(true);
  });

  it("ต่าง 1 ตัวอักษร → false", () => {
    expect(timingSafeEqualStr("abcdef", "abcdeg")).toBe(false);
    expect(timingSafeEqualStr("xbcdef", "abcdef")).toBe(false);
  });

  it("ความยาวต่าง → false", () => {
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
    expect(timingSafeEqualStr("abcd", "abc")).toBe(false);
    expect(timingSafeEqualStr("", "a")).toBe(false);
    // ส่วนที่ซ้อนกันเป็น 0 ทั้งหมด — ต้องจับได้จากความยาวเท่านั้น
    expect(timingSafeEqualStr("a", "a\u0000")).toBe(false);
  });

  it("ว่างกับว่าง → true", () => {
    expect(timingSafeEqualStr("", "")).toBe(true);
  });
});

describe("resolve_decision · decided_by_method", () => {
  it("รหัสถูก → human + approval_secret", async () => {
    const dec = await recordDecision(env.DB, WS, "t", "d", claude);
    const { decision } = await resolveDecision(
      env.DB, dec.id, "approved", "x", claude, { code: SECRET, secret: SECRET },
    );
    expect(decision.decided_by_kind).toBe("human");
    expect(decision.decided_by_method).toBe("approval_secret");
    expect(decision.decided_by_sub).toBeNull();

    const row = (await readDecisions(env.DB, WS, 10)).rows[0]!;
    expect(row.decided_by_kind).toBe("human");
    expect(row.decided_by_method).toBe("approval_secret");
    expect(row.decided_by_sub).toBeNull();
  });

  it("ไม่ส่งรหัส → relayed + none", async () => {
    const dec = await recordDecision(env.DB, WS, "t", "d", claude);
    const { decision } = await resolveDecision(env.DB, dec.id, "approved", "x", claude);
    expect(decision.decided_by_kind).toBe("relayed");
    expect(decision.decided_by_method).toBe("none");
    expect(decision.decided_by_sub).toBeNull();

    const row = (await readDecisions(env.DB, WS, 10)).rows[0]!;
    expect(row.decided_by_method).toBe("none");
    expect(row.decided_by_sub).toBeNull();
  });

  it("ไม่มีทางได้ owner_signed", async () => {
    const a = await recordDecision(env.DB, WS, "a", "d", claude);
    const b = await recordDecision(env.DB, WS, "b", "d", claude);
    await resolveDecision(env.DB, a.id, "approved", "x", claude, { code: SECRET, secret: SECRET });
    await resolveDecision(env.DB, b.id, "rejected", "x", claude);
    const { rows } = await readDecisions(env.DB, WS, 10);
    for (const r of rows) expect(r.decided_by_method).not.toBe("owner_signed");
  });

  it("รหัสผิด → ปฏิเสธด้วยข้อความเดิม และไม่ปิดใบ", async () => {
    const dec = await recordDecision(env.DB, WS, "t", "d", claude);
    await expect(
      resolveDecision(env.DB, dec.id, "approved", "x", claude, {
        code: "wrong-code", secret: SECRET,
      }),
    ).rejects.toThrow(new RequestError("approval_code ไม่ถูกต้อง — ไม่ได้ปิด decision ให้"));

    const row = (await readDecisions(env.DB, WS, 10)).rows[0]!;
    expect(row.status).toBe("proposed");
    expect(row.decided_by_method).toBeNull();
  });

  it("รหัสยาวกว่าแต่ขึ้นต้นด้วยรหัสจริง → ปฏิเสธ", async () => {
    const dec = await recordDecision(env.DB, WS, "t", "d", claude);
    await expect(
      resolveDecision(env.DB, dec.id, "approved", "x", claude, {
        code: `${SECRET}x`, secret: SECRET,
      }),
    ).rejects.toThrow(RequestError);
  });
});

describe("set_decision_scope", () => {
  it("รหัสผิด → ปฏิเสธด้วยข้อความเดิม และไม่เปลี่ยน scope", async () => {
    const dec = await recordDecision(env.DB, WS, "t", "d", claude);
    await resolveDecision(env.DB, dec.id, "approved", "x", claude, { code: SECRET, secret: SECRET });

    await expect(
      setDecisionScope(env.DB, dec.id, "workspace", claude, { code: "wrong-code", secret: SECRET }),
    ).rejects.toThrow(new RequestError("approval_code ไม่ถูกต้อง — ไม่ได้เปลี่ยน scope ให้"));

    const row = (await readDecisions(env.DB, WS, 10)).rows[0]!;
    expect(row.scope).toBe("project");
  });

  it("รหัสถูก → ปักได้", async () => {
    const dec = await recordDecision(env.DB, WS, "t", "d", claude);
    await resolveDecision(env.DB, dec.id, "approved", "x", claude, { code: SECRET, secret: SECRET });
    const d = await setDecisionScope(env.DB, dec.id, "workspace", claude, { code: SECRET, secret: SECRET });
    expect(d.scope).toBe("workspace");
    expect(d.decided_by_method).toBe("approval_secret");
  });
});

describe("ชุดคีย์ของแถว decision", () => {
  it("ทุกแถวมี decided_by_method และ decided_by_sub · ใบที่ยังไม่ปิดเป็น null", async () => {
    const created = await recordDecision(env.DB, WS, "open", "d", claude);
    expect(created).toHaveProperty("decided_by_method", null);
    expect(created).toHaveProperty("decided_by_sub", null);

    const closed = await recordDecision(env.DB, WS, "closed", "d", claude);
    await resolveDecision(env.DB, closed.id, "approved", "x", claude);

    for (const summary of [false, true]) {
      const { rows } = await readDecisions(env.DB, WS, 10, undefined, undefined, summary);
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(Object.keys(r)).toContain("decided_by_method");
        expect(Object.keys(r)).toContain("decided_by_sub");
        expect(r.decided_by_sub).toBeNull();
      }
      const open = rows.find((r) => r.id === created.id)!;
      expect(open.decided_by_method).toBeNull();
      expect(rows.find((r) => r.id === closed.id)!.decided_by_method).toBe("none");
    }
  });
});
