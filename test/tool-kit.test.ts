import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CONTRACT_VERSION, actedAs, handoffReminder, registerTool, run } from "../src/tool-kit";

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

/**
 * Phase 1 ข้อ B ของ vNext — task-16e0acde
 *
 * โต๊ะนี้มีเคสจริงสี่ครั้งที่ผู้ลงมือไม่ใช่ผู้ที่บันทึกระบุ และทุกครั้งไม่มีอะไรผิด
 * สิ่งที่ผิดคือบันทึกอ่านแล้วเหมือนผู้ที่ถูกระบุเป็นคนทำ
 */
describe("ใครลงมือ เทียบกับใครที่บันทึกระบุ", () => {
  it("ตรงกัน — รายงานว่าไม่ได้ทำแทน และไม่มีข้อความเตือน", () => {
    const got = actedAs("monthop-gmail/agent-platform", "monthop-gmail/agent-platform");

    expect(got.delegated).toBe(false);
    expect(got.addressed_to).toBe("monthop-gmail/agent-platform");
    expect(got.acted_by).toBe("monthop-gmail/agent-platform");
    expect(got).not.toHaveProperty("note");
  });

  /** เคสจริง ho-0df9ca9c จ่าหน้าถึง itops-mcp-hub แต่ Cursor เป็นคนกดรับ */
  it("ไม่ตรงกัน — รายงานทั้งสองชื่อพร้อมข้อความที่บอกว่าทำได้ ไม่ใช่ว่าผิด", () => {
    const got = actedAs("monthop-champaruang/itops-mcp-hub", "Cursor");

    expect(got.delegated).toBe(true);
    expect(got.addressed_to).toBe("monthop-champaruang/itops-mcp-hub");
    expect(got.acted_by).toBe("Cursor");
    expect(got.note).toContain("monthop-champaruang/itops-mcp-hub");
    expect(got.note).toContain("Cursor");
    expect(got.note).toContain("allowed");
  });

  /**
   * ไม่มีเจ้าของ ต้องแยกออกจากมีเจ้าของแล้วตรงกัน — ผู้อ่านแยกได้จาก addressed_to
   * ที่อยู่ในผลลัพธ์เดียวกัน ไม่ต้องเดาจาก delegated อย่างเดียว
   */
  it("ใบไม่มีเจ้าของ — ไม่ใช่การทำแทน และบอกได้ว่าไม่มีใครถูกระบุ", () => {
    for (const empty of [null, undefined, "", "   "]) {
      const got = actedAs(empty, "Cursor");
      expect(got.delegated).toBe(false);
      expect(got.addressed_to).toBeNull();
      expect(got.acted_by).toBe("Cursor");
    }
  });

  it("ไม่รู้ว่าใครลงมือ — ไม่เดาว่าตรงหรือไม่ตรง", () => {
    const got = actedAs("monthop-gmail/ai-collaboration-mcp", null);

    expect(got.delegated).toBe(false);
    expect(got.acted_by).toBeNull();
    expect(got.addressed_to).toBe("monthop-gmail/ai-collaboration-mcp");
  });

  it("มีฟิลด์เสมอ ไม่ใช่โผล่เฉพาะตอนไม่ตรง", () => {
    for (const got of [actedAs("a", "a"), actedAs("a", "b"), actedAs(null, "b")]) {
      expect(got).toHaveProperty("addressed_to");
      expect(got).toHaveProperty("acted_by");
      expect(got).toHaveProperty("delegated");
    }
  });
});
