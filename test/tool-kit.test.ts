import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CONTRACT_VERSION, handoffReminder, registerTool, run } from "../src/tool-kit";

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

describe("ตารางยังไม่ถูกสร้าง", () => {
  /**
   * `no such table` เป็นข้อความดิบของ D1 ที่บอกไม่ได้ว่าต้องทำอะไรต่อ คนที่เพิ่ง
   * deploy ครั้งแรกแล้ว schema ยังไม่ขึ้นจะนึกว่าโค้ดพัง ทั้งที่เหลืออีกคำสั่งเดียว
   */
  it("แปลข้อความดิบของ D1 เป็นคำสั่งที่รันได้", async () => {
    const result = (await run(async () => {
      throw new Error("D1_ERROR: no such table: messages");
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("npm run db:remote");
    expect(result.content[0]!.text).toContain("รันซ้ำได้");
  });

  it("ข้อผิดพลาดอื่นไม่ถูกแปลเป็นเรื่อง schema", async () => {
    const result = (await run(async () => {
      throw new Error("something else entirely");
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("something else entirely");
    expect(result.content[0]!.text).not.toContain("db:remote");
  });
});
