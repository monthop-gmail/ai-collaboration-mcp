/**
 * รันชุด vector ของฝั่ง gateway กับ adapter ของเราจริง ๆ
 *
 * ชุดอยู่ที่ `fixtures/adapter-conformance/` ก็อปมาจาก `internal-mcp-gateway`
 * ที่ `7dbea5f` — ห้ามแก้ไฟล์นั้นเอง เพราะถ้าแก้ ชุดจะเลิกวัดสิ่งที่อีกฝั่งวัด
 *
 * **ทำไมไม่เรียก `conformance/run.js` ของเขาตรง ๆ**
 *
 * `run.js` เรียก `adapter.verify(...)` แบบไม่มี `await` ซึ่งใช้ได้กับ adapter อ้างอิง
 * ที่ตรวจลายเซ็นด้วย `node:crypto` แบบ synchronous แต่บน Worker ไม่มีทางเลือกอื่น
 * นอกจาก WebCrypto ซึ่งเป็น async ทั้งหมด — ถ้ารัน harness ของเขาตรง ๆ จะได้
 * `got.ok === undefined` ทุก vector แล้วตีความผิดว่า adapter เราพัง
 *
 * ไฟล์นี้จึงทำ runner ของตัวเองที่ await แต่ **ใช้ vector, jwks และตรรกะตัดสิน
 * ผ่านหรือไม่ผ่านชุดเดียวกับเขาทุกตัวอักษร** ไม่ได้ผ่อนเกณฑ์ให้ตัวเอง
 */
import { describe, expect, it } from "vitest";
import {
  createAdapter,
  jwksSourceMismatch,
  CLAIM_CONTRACT,
  JWKS_SOURCES,
  REJECT_REASONS,
} from "../src/jwt";
import gwTestJwks from "./fixtures/gateway-test-runtime/jwks.json";
import runtimeJwks from "./fixtures/gateway-runtime/jwks.json";
import jwks from "./fixtures/adapter-conformance/jwks.json";
import doc from "./fixtures/adapter-conformance/vectors.json";

interface Vector {
  id: string;
  why: string;
  token: string;
  operation?: string;
  order?: number;
  requires?: string;
  expect: { ok: boolean; sub?: string; reason?: string };
}

const vectors = (doc.vectors as Vector[]).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

function adapter(trackJti: boolean) {
  return createAdapter({
    issuer: doc.issuer,
    audience: doc.audience,
    // ค่าที่ห้าที่ harness ของฝั่ง gateway ส่งมาตั้งแต่ commit 12ade57 — ไม่แกะจาก
    // ท้าย audience เอง เพราะการแกะทำให้ด่าน `cid` เทียบ audience กับตัวมันเอง
    connectorId: doc.connector_id,
    getJwks: () => jwks,
    trackJti,
  });
}

/** ตรรกะเดียวกับ `printReport` ของเขา คือผ่านเมื่อ ok ตรงและ sub หรือ reason ตรง */
async function runAll(trackJti: boolean) {
  const a = adapter(trackJti);
  const results: { id: string; status: "pass" | "fail" | "skipped"; detail: string }[] = [];

  for (const v of vectors) {
    if (v.requires === "trackJti" && !trackJti) {
      results.push({ id: v.id, status: "skipped", detail: "adapter ประกาศว่าไม่เก็บ seen-jti" });
      continue;
    }
    const got = await a.verify(v.token, { operation: v.operation });
    const pass = v.expect.ok
      ? got.ok === true && got.principal.sub === v.expect.sub
      : got.ok === false && got.reason === v.expect.reason;
    results.push({
      id: v.id,
      status: pass ? "pass" : "fail",
      detail: got.ok ? `ok sub=${got.principal.sub}` : `reason=${got.reason}`,
    });
  }
  return results;
}

describe("upstream adapter — ชุด vector ของ gateway", () => {
  it("ครบ 24 vector ตามที่สัญญาระบุ ไม่ขาดไม่เกิน", () => {
    expect(vectors).toHaveLength(24);
  });

  /**
   * ประกาศ `trackJti: false` แบบที่จะใช้จริงบน Worker — กลุ่ม replay ต้องถูก
   * **รายงานว่าข้าม** ไม่ใช่ผ่านเงียบ ๆ ซึ่งเป็นกลไกที่สัญญาบังคับไว้
   */
  it("รันแบบที่จะใช้จริงบน Worker (trackJti: false) — ผ่านทุกข้อที่ไม่ได้ข้าม", async () => {
    const results = await runAll(false);
    const failed = results.filter((r) => r.status === "fail");

    expect(failed, JSON.stringify(failed, null, 2)).toHaveLength(0);
    expect(results.filter((r) => r.status === "skipped").map((r) => r.id)).toEqual([
      "replay_first_use",
      "replay_second_use",
    ]);
    expect(results.filter((r) => r.status === "pass")).toHaveLength(22);
  });

  /**
   * รันซ้ำแบบเก็บ `jti` เพื่อพิสูจน์ว่าตรรกะข้อ 5 ถูก แม้เราจะไม่เปิดใช้บน Worker
   * — การประกาศ false เป็นเพราะที่เก็บใช้ไม่ได้ ไม่ใช่เพราะเขียนไม่ได้
   */
  it("เปิด trackJti ในโพรเซสเดียว — ผ่านครบ 24 รวมกลุ่ม replay", async () => {
    const results = await runAll(true);
    const failed = results.filter((r) => r.status === "fail");

    expect(failed, JSON.stringify(failed, null, 2)).toHaveLength(0);
    expect(results.filter((r) => r.status === "pass")).toHaveLength(24);
  });
});

describe("กติกาที่อยู่เหนือทุกข้อ", () => {
  /**
   * claim ทุกตัวต้องอยู่ฝ่ายใดฝ่ายหนึ่ง ไม่มี claim ที่อยู่เฉย ๆ
   *
   * ฝั่ง gateway เจอแผลนี้สองครั้ง (`ops` แล้ว `cid`) เพราะครั้งแรกแก้ที่ตัวอย่าง
   * ไม่ได้แก้ที่ชนิดของปัญหา เทสต์นี้อ่าน claim จากโทเคนจริงในชุด vector แล้วบังคับว่า
   * ทุกตัวต้องถูกจัดประเภทไว้แล้ว — claim ใหม่ที่โผล่มาในชุดรุ่นถัดไปจะทำให้เทสต์แดง
   */
  it("ทุก claim ในโทเคนจริงถูกจัดประเภทแล้ว ไม่มีตัวไหนลอย", () => {
    const classified = new Set<string>([
      ...CLAIM_CONTRACT.enforced,
      ...CLAIM_CONTRACT.diagnostics,
    ]);

    const seen = new Set<string>();
    for (const v of vectors) {
      const segment = v.token.split(".")[1];
      if (!segment) continue;
      const padded = segment.replaceAll("-", "+").replaceAll("_", "/");
      try {
        const payload = JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)));
        if (payload && typeof payload === "object") {
          for (const key of Object.keys(payload)) seen.add(key);
        }
      } catch {
        // vector ที่ตั้งใจให้ผิดรูป ไม่มี payload ให้อ่าน ข้ามไป
      }
    }

    expect(seen.size).toBeGreaterThan(0);
    expect([...seen].filter((c) => !classified.has(c))).toEqual([]);
  });

  it("enforced กับ diagnostics ไม่ทับกัน", () => {
    const overlap = CLAIM_CONTRACT.enforced.filter((c) =>
      (CLAIM_CONTRACT.diagnostics as readonly string[]).includes(c),
    );
    expect(overlap).toEqual([]);
  });

  /**
   * รหัสปฏิเสธเป็นชุดปิด ไม่ใช่ข้อความอิสระ — ฝั่ง gateway เคยพลาดข้อนี้เอง
   * ด้วยการคัดลอกข้อความของ upstream มาเป็นเหตุผลของตัวเอง ทำให้ audit นับไม่ได้
   */
  it("รหัสที่ชุด vector คาดไว้ทุกตัว อยู่ในชุดปิดของเรา", () => {
    const expected = new Set(
      vectors.filter((v) => !v.expect.ok).map((v) => v.expect.reason as string),
    );
    const ours = new Set<string>(REJECT_REASONS);
    expect([...expected].filter((r) => !ours.has(r))).toEqual([]);
  });
});

describe("ข้อจำกัดที่ adapter ประกาศเอง", () => {
  /**
   * ทะเบียนฝั่ง gateway อ่านค่านี้ได้โดยไม่ต้องเชื่อคำบรรยายในเอกสาร
   * `trackJti: true` ที่ผิด แย่กว่า `trackJti: false` ที่ถูก
   */
  it("ไม่เก็บ jti → ประกาศ jti_replay_not_tracked", () => {
    expect(adapter(false).limitations).toContain("jti_replay_not_tracked");
  });

  it("เก็บ jti → ไม่ประกาศข้อนั้น", () => {
    expect(adapter(true).limitations).not.toContain("jti_replay_not_tracked");
  });

  it("JWKS ฝังค่าคงที่ในรอบแรก → ประกาศ jwks_pinned_not_fetched ทุกกรณี", () => {
    expect(adapter(false).limitations).toContain("jwks_pinned_not_fetched");
    expect(adapter(true).limitations).toContain("jwks_pinned_not_fetched");
  });
});

describe("audience ของ connector ตัวเดียว", () => {
  /**
   * adapter ที่รับ "โทเคนใดก็ได้ที่ออกโดย gateway" คือ adapter ที่ผิด
   * ข้อนี้ยิงตรงไม่ผ่านชุด vector เพราะ vector ผูกกับ audience เดียว
   */
  it("โทเคนที่ถูกทุกข้อ แต่ adapter ตั้ง audience เป็น connector อื่น ต้องไม่ผ่าน", async () => {
    const other = createAdapter({
      issuer: doc.issuer,
      audience: "mcp://gw.example.internal/connector/someone-else",
      connectorId: "someone-else",
      getJwks: () => jwks,
    });
    const valid = vectors.find((v) => v.id === "valid_read")!;

    const got = await other.verify(valid.token, { operation: valid.operation });
    expect(got.ok).toBe(false);
    expect(got.ok === false && got.reason).toBe("audience_mismatch");
  });
});

describe("cid เทียบกับ connector ที่ประกาศไว้ ไม่ใช่กับตัว audience เอง", () => {
  /**
   * ข้อที่ฝั่ง gateway ยืนยันใน seq 21 ว่าการแกะ connector จากท้าย audience อ่อนกว่า
   *
   * เคสนี้ตั้ง audience ตรงกับโทเคนทุกตัวอักษร แต่ประกาศ connector เป็นอีกตัว
   * adapter ที่แกะเอาจากท้าย audience จะได้ `collab-readonly-test` แล้วผ่านด่านนี้
   * ส่วน adapter ที่เทียบกับค่าที่ประกาศไว้ ต้องปฏิเสธ
   */
  it("audience ตรง แต่ connector ที่ประกาศไว้คนละตัว ต้องไม่ผ่าน", async () => {
    const mislabelled = createAdapter({
      issuer: doc.issuer,
      audience: doc.audience,
      connectorId: "some-other-connector",
      getJwks: () => jwks,
    });
    const valid = vectors.find((v) => v.id === "valid_read")!;

    const got = await mislabelled.verify(valid.token, { operation: valid.operation });
    expect(got.ok).toBe(false);
    expect(got.ok === false && got.reason).toBe("connector_mismatch");
  });

  it("กุญแจจากชุดทดสอบสาธารณะ ต้องประกาศตัวในทะเบียนข้อจำกัด", () => {
    const fixture = createAdapter({
      issuer: doc.issuer,
      audience: doc.audience,
      connectorId: doc.connector_id,
      getJwks: () => jwks,
      jwksSource: "fixture",
    });
    const real = createAdapter({
      issuer: doc.issuer,
      audience: doc.audience,
      connectorId: doc.connector_id,
      getJwks: () => jwks,
      jwksSource: "gateway",
    });

    expect(fixture.limitations).toContain("jwks_is_public_test_fixture");
    expect(real.limitations).not.toContain("jwks_is_public_test_fixture");
  });
});

/**
 * ชนิดของกุญแจ — ประกาศไว้เฉย ๆ ไม่พอ ต้องตรงกับตัวกุญแจจริง
 *
 * ค่าที่ประกาศผิดคือค่าที่อันตรายที่สุด เพราะคนตั้งจะเชื่อว่า deployment นั้น
 * ปลอดภัยกว่าความจริง — การ์ดนี้ใช้เครื่องหมายเดียวกับที่ฝั่ง gateway ใส่ไว้ใน
 * `kid` ของกุญแจทดสอบทุกดอก จึงไม่ต้องตกลงกันใหม่และไม่ต้องเชื่อคำประกาศอย่างเดียว
 */
describe("ประกาศชนิดของกุญแจต้องตรงกับกุญแจจริง", () => {
  it("รับสามชนิด ไม่ขาดไม่เกิน", () => {
    expect([...JWKS_SOURCES]).toEqual(["fixture", "gateway-test", "gateway"]);
  });

  it("ชุด conformance ประกาศเป็น fixture ผ่าน", () => {
    expect(jwksSourceMismatch(jwks, "fixture")).toBeUndefined();
  });

  it("ชุด gateway test runtime ประกาศเป็น gateway-test ผ่าน", () => {
    expect(jwksSourceMismatch(gwTestJwks, "gateway-test")).toBeUndefined();
  });

  it("เอากุญแจทดสอบไปประกาศว่าเป็นของจริง ต้องไม่ผ่าน ทั้งสองชนิด", () => {
    expect(jwksSourceMismatch(jwks, "gateway")).toContain("conformance-");
    expect(jwksSourceMismatch(gwTestJwks, "gateway")).toContain("gw-test-");
  });

  it("ประกาศสลับชนิดกันเอง ต้องไม่ผ่าน", () => {
    expect(jwksSourceMismatch(gwTestJwks, "fixture")).toBeTruthy();
    expect(jwksSourceMismatch(jwks, "gateway-test")).toBeTruthy();
  });

  it("กุญแจที่ไม่มีเครื่องหมายทดสอบ ประกาศเป็น gateway ได้", () => {
    const real = { keys: [{ kty: "RSA", kid: "prod-2026-09", alg: "RS256" }] };
    expect(jwksSourceMismatch(real, "gateway")).toBeUndefined();
  });

  it("กุญแจ gateway-test ประกาศถูก → ทะเบียนบอกว่ายังไม่ใช่ของจริง", () => {
    const a = createAdapter({
      issuer: doc.issuer,
      audience: doc.audience,
      connectorId: doc.connector_id,
      getJwks: () => gwTestJwks,
      jwksSource: "gateway-test",
    });
    expect(a.limitations).toContain("jwks_is_gateway_test_key");
    expect(a.limitations).not.toContain("jwks_is_public_test_fixture");
  });
});

/**
 * กุญแจของ gateway ตัวจริงที่ deploy แล้ว — วัดสองข้อของ runbook ข้อ 8 ล่วงหน้า
 *
 * `trueforge` deploy ขึ้น `internal-mcp-gateway-test.monthop-gmail.workers.dev` เมื่อ
 * 18 ก.ย. (commit `66bcad7` ของ `internal-mcp-gateway`) และเผยแพร่ JWKS เป็นสาธารณะ
 * เราจึงดึงมาวัดฝั่งเราได้เลย **โดยไม่ต้องรอให้เส้นทางยิงถึงกันได้ก่อน** ซึ่งตอนนี้
 * ยังยิงไม่ถึงเพราะ Worker ยิง Worker ในบัญชีเดียวกันโดน Cloudflare บล็อก (1042)
 *
 * ข้อที่สองสำคัญกว่าข้อแรก — **การพิสูจน์ว่ากุญแจใหม่ใช้ได้ ไม่ได้พิสูจน์ว่ากุญแจเก่า
 * ใช้ไม่ได้แล้ว** ต้องยิงด้วยของเก่าแล้วดูว่าถูกปฏิเสธจริง เป็นทิศที่สองของภัยข้อ 9
 */
describe("กุญแจของ gateway ตัวจริง", () => {
  const PRIVATE_FIELDS = ["d", "p", "q", "dp", "dq", "qi"] as const;

  it("ที่เผยแพร่ออกมาเป็นกุญแจสาธารณะล้วน ไม่มีส่วนที่ต้องปิด", () => {
    for (const key of runtimeJwks.keys as Array<Record<string, unknown>>) {
      for (const field of PRIVATE_FIELDS) {
        expect(key, `กุญแจ ${String(key.kid)} มีช่อง ${field}`).not.toHaveProperty(field);
      }
    }
  });

  it("ประกาศเป็น gateway ได้ เพราะไม่มีเครื่องหมายของกุญแจทดสอบ", () => {
    expect(jwksSourceMismatch(runtimeJwks, "gateway")).toBeUndefined();
  });

  it("ประกาศเป็น fixture ไม่ได้ ของจริงจะถูกเรียกว่าของทดสอบไม่ได้", () => {
    expect(jwksSourceMismatch(runtimeJwks, "fixture")).toBeTruthy();
  });

  /**
   * ข้อนี้คือการยืนยันล่วงหน้าว่า cutover จะไม่ทิ้งประตูหลังไว้
   *
   * `valid_read` มี `exp` ไกลถึงปี 2100 และอยู่ในรีโปสาธารณะ ใครก็หยิบไปยิงได้
   * หลังเปลี่ยนมาใช้กุญแจ runtime มันต้องตายทันที ไม่ใช่ยังใช้ได้เงียบ ๆ
   */
  it("โทเคน fixture ที่ยังไม่หมดอายุ ตายทันทีเมื่อ JWKS เป็นของ runtime", async () => {
    const validRead = vectors.find((v) => v.id === "valid_read")!;
    const afterCutover = createAdapter({
      issuer: doc.issuer,
      audience: doc.audience,
      connectorId: doc.connector_id,
      getJwks: () => runtimeJwks,
      jwksSource: "gateway",
    });

    const got = await afterCutover.verify(validRead.token, { operation: "read" });

    expect(got.ok).toBe(false);
    expect(got.ok === false && got.reason).toBe("unknown_kid");
  });
});
