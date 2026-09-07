import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CONTRACT_VERSION, handoffReminder, registerTool } from "../src/tool-kit";

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

/**
 * เลข contract เป็นของที่ต้องอยู่ในตำแหน่งตายตัว ไม่ใช่ข้อความอิสระ — ผู้อ่านคือโมเดล
 * ซึ่งเทียบเลขสองตัวได้แม่นกว่าเทียบ prose ตามกติกาใน ADR-0028 ของ agent-platform
 * ถ้าตำแหน่งเพี้ยนเมื่อไหร่ วิธีตรวจว่า client ถือ schema เก่าอยู่ก็ใช้ไม่ได้ทันที
 */
describe("ประกาศเลข contract ให้ทุก tool", () => {
  function capture() {
    const seen: Array<{ name: string; description: string }> = [];
    const server = {
      registerTool: (name: string, config: { description: string }) => {
        seen.push({ name, description: config.description });
      },
    };
    return { seen, server: server as never };
  }

  it("บรรทัดแรกของ description เป็นคำว่า contract ตามด้วยเลขเท่านั้น", () => {
    const { seen, server } = capture();

    registerTool(
      server,
      "some_tool",
      { description: "ทำอะไรสักอย่าง", inputSchema: z.object({}) },
      async () => ({}),
    );

    expect(seen[0]!.description.split("\n")[0]).toBe(`contract ${CONTRACT_VERSION}`);
  });

  it("คำอธิบายเดิมยังอยู่ครบ ไม่ถูกกลืนโดยเลข", () => {
    const { seen, server } = capture();

    registerTool(
      server,
      "some_tool",
      { description: "ทำอะไรสักอย่าง", inputSchema: z.object({}) },
      async () => ({}),
    );

    expect(seen[0]!.description).toContain("ทำอะไรสักอย่าง");
  });

  it("เลข contract เป็นจำนวนเต็ม ไม่ใช่ semver", () => {
    expect(Number.isInteger(CONTRACT_VERSION)).toBe(true);
  });
});
