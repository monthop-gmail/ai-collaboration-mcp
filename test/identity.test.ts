import { describe, expect, it, vi } from "vitest";

/**
 * `getMcpAuthContext` อ่านค่าจาก context ของ request ที่กำลังทำงานอยู่ ซึ่งไม่มี
 * ตอนรัน test จึง mock ไว้เพื่อทดสอบ **การตีความ props** ซึ่งเป็นจุดที่ตัวตน
 * ของผู้โพสต์ถูกตัดสิน
 */
const authContext = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("agents/mcp/server", () => ({
  getMcpAuthContext: () => authContext.value,
}));

const { resolveAuthor } = await import("../src/identity");

function withProps(props: unknown) {
  authContext.value = props === undefined ? undefined : { props };
}

describe("ตัวตนจาก OAuth", () => {
  it("ใช้ clientId กับ clientName ที่ฝังมาใน token", () => {
    withProps({ clientId: "abc123", clientName: "Gemini" });
    expect(resolveAuthor()).toEqual({ client: "abc123", name: "Gemini" });
  });

  it("ไม่มี clientName ก็ใช้ clientId เป็นชื่อแทน ดีกว่าไม่มีชื่อ", () => {
    withProps({ clientId: "abc123" });
    expect(resolveAuthor()).toEqual({ client: "abc123", name: "abc123" });
  });

  it("clientName ว่างเปล่าถือว่าไม่มี", () => {
    withProps({ clientId: "abc123", clientName: "" });
    expect(resolveAuthor().name).toBe("abc123");
  });
});

describe("เส้น static bearer ที่ไม่มี OAuth", () => {
  it("ไม่มี auth context เลย ใช้ชื่อสำรอง", () => {
    withProps(undefined);
    expect(resolveAuthor()).toEqual({
      client: "static-bearer",
      name: "Static bearer",
    });
  });

  it("ตั้งชื่อผ่าน STATIC_CLIENT_NAME ได้", () => {
    withProps(undefined);
    expect(resolveAuthor("Claude Code").name).toBe("Claude Code");
  });

  it("ชื่อที่มีแต่ช่องว่างถือว่าไม่ได้ตั้ง", () => {
    withProps(undefined);
    expect(resolveAuthor("   ").name).toBe("Static bearer");
  });
});

/**
 * props มาจาก token ที่ server เป็นคนออก แต่ถ้าโครงสร้างเพี้ยนไป (เช่นเปลี่ยน
 * รูปแบบแล้ว token เก่ายังไม่หมดอายุ) ต้องถอยไปใช้ชื่อสำรอง ไม่ใช่ระเบิด หรือ
 * แย่กว่านั้นคือปล่อยให้ค่าที่ไม่ใช่ string กลายเป็นชื่อผู้โพสต์
 */
describe("props ที่รูปแบบไม่ตรง", () => {
  it.each([
    ["ไม่มี clientId", { clientName: "Claude" }],
    ["clientId ไม่ใช่ string", { clientId: 42, clientName: "Claude" }],
    ["clientId ว่าง", { clientId: "", clientName: "Claude" }],
    ["props ว่างเปล่า", {}],
  ])("%s → ถอยไปใช้ชื่อสำรอง", (_label, props) => {
    withProps(props);
    expect(resolveAuthor().client).toBe("static-bearer");
  });

  it("clientName ที่ไม่ใช่ string ไม่หลุดไปเป็นชื่อผู้โพสต์", () => {
    withProps({ clientId: "abc123", clientName: { evil: true } });
    expect(resolveAuthor().name).toBe("abc123");
  });
});
