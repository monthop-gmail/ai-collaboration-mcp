import { describe, expect, it } from "vitest";
import { handoffReminder } from "../src/tool-kit";

/**
 * ข้อความนี้คือสิ่งเดียวที่กัน agent เล่าว่า "ส่งต่อแล้ว" ทั้งที่แค่ตั้งผู้รับผิดชอบ
 * ถ้ามันหายไปหรือเงื่อนไขเพี้ยน จะไม่มีอะไรฟ้อง — เกิดขึ้นมาแล้วจริงกับ ChatGPT
 */
describe("เตือนว่าตั้งผู้รับผิดชอบไม่ใช่การส่งต่อ", () => {
  it("มีชื่อผู้รับผิดชอบ ต้องเตือน", () => {
    const note = handoffReminder("Gemini");
    expect(note).toContain("Gemini");
    expect(note).toContain("create_handoff");
    expect(note).toContain("get_handoffs");
  });

  it.each([
    ["ไม่ได้ตั้ง", undefined],
    ["เป็น null", null],
    ["ว่างเปล่า", ""],
    ["มีแต่ช่องว่าง", "   "],
  ])("%s → ไม่ต้องเตือน", (_label, value) => {
    expect(handoffReminder(value)).toBeUndefined();
  });
});
