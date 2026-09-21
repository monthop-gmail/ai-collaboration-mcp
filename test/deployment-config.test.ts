/**
 * ตรวจไฟล์ตั้งค่าของ deployment เอง ไม่ใช่ตรวจโค้ดที่อ่านมัน
 *
 * ทั้ง repo มีเทสต์ที่พิสูจน์ว่า adapter ตรวจโทเคนถูก การ์ดชนิดกุญแจทำงาน และ
 * ตั้งค่าไม่ครบแล้วได้ `500` — **แต่ไม่มีเทสต์ไหนเคยอ่าน `wrangler.poc.jsonc`**
 *
 * แปลว่าไฟล์ที่ประกาศว่า deployment นี้เชื่อใคร เป็นไฟล์เดียวในเส้นทางที่ไม่มีใคร
 * ตรวจเลย · พิมพ์ `gateway` ผิดเป็น `gatewy` หรือวาง JWKS ของ fixture ไว้คู่กับ
 * `source: gateway` จะรู้ตอน deploy แล้วเท่านั้น ซึ่งคือตอนที่ของจริงเชื่อผิดคนไปแล้ว
 *
 * เจอช่องนี้ตอน cutover ไปใช้กุญแจ runtime จริง (dis-514ae7a7 seq 51)
 */
import { describe, expect, it } from "vitest";
import raw from "../wrangler.poc.jsonc?raw";
import { JWKS_SOURCES, jwksSourceMismatch, type JwksSource } from "../src/jwt";

/**
 * ตัดเฉพาะบรรทัดที่เป็นคอมเมนต์ทั้งบรรทัด
 *
 * **ห้ามตัด `//` ที่ไหนก็ได้** เพราะค่า `GATEWAY_JWT_ISSUER` เป็น URL ที่มี `//`
 * อยู่กลางสตริง การตัดแบบหยาบจะทำให้ไฟล์ที่ถูกต้องพังตอน parse แล้วเทสต์จะฟ้อง
 * สิ่งที่ไม่ได้ผิด
 */
function parseJsonc(text: string): Record<string, unknown> {
  const stripped = text
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  return JSON.parse(stripped) as Record<string, unknown>;
}

const config = parseJsonc(raw);
const vars = config.vars as Record<string, string>;

/** ห้าตัวที่ `gatewaySetup()` ต้องมีครบ ขาดตัวใดตัวหนึ่งคือ 500 ตอนรัน */
const GATEWAY_VARS = [
  "GATEWAY_JWT_ISSUER",
  "GATEWAY_JWT_AUDIENCE",
  "GATEWAY_CONNECTOR_ID",
  "GATEWAY_JWKS_SOURCE",
  "GATEWAY_JWKS",
] as const;

describe("ไฟล์ตั้งค่าของ deployment ทดสอบ", () => {
  it("ตั้งค่า gateway ครบทั้งห้าตัว ไม่มีตัวไหนว่าง", () => {
    for (const name of GATEWAY_VARS) {
      expect(vars[name], `${name} หายไปหรือว่าง`).toBeTruthy();
    }
  });

  it("ประกาศชนิดของกุญแจด้วยค่าที่ระบบรู้จัก", () => {
    expect(JWKS_SOURCES).toContain(vars.GATEWAY_JWKS_SOURCE);
  });

  /**
   * ข้อที่สำคัญที่สุดในไฟล์นี้ — **ชนิดที่ประกาศต้องตรงกับกุญแจที่วางไว้จริง**
   *
   * `dec-2ce7ba09` ห้าม promote กุญแจ fixture ไปเป็นของจริง · การ์ดในโค้ดบังคับข้อนี้
   * ตอนบูต แต่บังคับตอนบูตแปลว่ารู้หลัง deploy · เทสต์นี้ทำให้รู้ก่อน
   */
  it("ชนิดที่ประกาศตรงกับกุญแจที่วางไว้จริง", () => {
    const jwks = JSON.parse(vars.GATEWAY_JWKS) as { keys: Array<Record<string, unknown>> };
    const source = vars.GATEWAY_JWKS_SOURCE as JwksSource;

    expect(jwksSourceMismatch(jwks, source)).toBeUndefined();
  });

  /**
   * ถ้าวันหนึ่งมีคนวางกุญแจส่วนตัวลงไฟล์นี้ ต้องแดงก่อน commit ไม่ใช่ก่อน deploy
   *
   * ไฟล์นี้อยู่ใน git และ repo เป็นสาธารณะ — ความผิดพลาดนี้ย้อนไม่ได้จริง ๆ
   * ต่างจากค่าอื่นในไฟล์ที่แก้แล้ว deploy ใหม่ก็จบ
   */
  it("JWKS ที่วางไว้เป็นกุญแจสาธารณะล้วน", () => {
    const jwks = JSON.parse(vars.GATEWAY_JWKS) as { keys: Array<Record<string, unknown>> };

    expect(jwks.keys.length).toBeGreaterThan(0);
    for (const key of jwks.keys) {
      expect(key.kid, "กุญแจไม่มี kid — adapter จับคู่ไม่ได้").toBeTruthy();
      for (const field of ["d", "p", "q", "dp", "dq", "qi"]) {
        expect(key, `กุญแจ ${String(key.kid)} มีช่อง ${field}`).not.toHaveProperty(field);
      }
    }
  });
});
