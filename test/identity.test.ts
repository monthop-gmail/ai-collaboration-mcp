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

const { resolveAuthor, readClientNameHeader, staticIdentityFor } =
  await import("../src/identity");

const config = (name: string) => ({ name, source: "config" as const });
const header = (name: string) => ({ name, source: "header" as const });

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
    expect(resolveAuthor(config("Claude Code"))).toEqual({
      client: "static-bearer",
      name: "Claude Code",
    });
  });

  /**
   * ชื่อจาก header ปลอมได้ ใครถือ token ก็ประกาศตัวเป็นอะไรก็ได้ จึงต้องแยกให้เห็น
   * ใน `client` ว่าแถวนี้เชื่อถือได้น้อยกว่าแถวที่มาจาก OAuth
   */
  it("ชื่อจาก header ถูกทำเครื่องหมายว่ามาจาก header", () => {
    withProps(undefined);
    expect(resolveAuthor(header("Manus"))).toEqual({
      client: "static-header:Manus",
      name: "Manus",
    });
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

/**
 * ตาราง alias เปลี่ยนแค่ป้ายชื่อ ไม่แตะตัวตนจริง และต้องทนกับค่าที่ตั้งผิดรูปแบบ
 * เพราะมันมาจาก config ที่คนพิมพ์เอง ไม่ใช่จากโปรแกรม
 */
describe("แก้ชื่อที่แสดงผ่าน CLIENT_NAME_ALIASES", () => {
  it("เปลี่ยนชื่อที่ตรงกับตาราง", () => {
    withProps({ clientId: "abc", clientName: "Google" });
    expect(resolveAuthor(undefined, "Google=Gemini").name).toBe("Gemini");
  });

  it("ไม่แตะ client ที่เป็นตัวตนจริง", () => {
    withProps({ clientId: "abc", clientName: "Google" });
    expect(resolveAuthor(undefined, "Google=Gemini").client).toBe("abc");
  });

  it("ชื่อที่ไม่อยู่ในตารางปล่อยผ่านตามเดิม", () => {
    withProps({ clientId: "abc", clientName: "Claude" });
    expect(resolveAuthor(undefined, "Google=Gemini").name).toBe("Claude");
  });

  it("ตั้งหลายคู่ได้", () => {
    withProps({ clientId: "abc", clientName: "Foo" });
    expect(resolveAuthor(undefined, "Google=Gemini, Foo = Bar").name).toBe("Bar");
  });

  it.each([
    ["ไม่ได้ตั้งเลย", undefined],
    ["ว่างเปล่า", ""],
    ["ไม่มีเครื่องหมายเท่ากับ", "Google"],
    ["ฝั่งซ้ายว่าง", "=Gemini"],
    ["ฝั่งขวาว่าง", "Google="],
    ["มีแต่ comma", ",,,"],
  ])("%s → ใช้ชื่อเดิม ไม่พัง", (_label, aliases) => {
    withProps({ clientId: "abc", clientName: "Google" });
    expect(resolveAuthor(undefined, aliases).name).toBe("Google");
  });

  it("ไม่แตะเส้น static bearer", () => {
    withProps(undefined);
    expect(resolveAuthor(config("Claude Code"), "Claude Code=อย่างอื่น").name).toBe(
      "Claude Code",
    );
  });
});

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://example.com/mcp", { headers });
}

/** คลี่ผลลัพธ์ในเทสที่รู้ว่าต้องสำเร็จ ให้ assertion อ่านง่าย */
function nameOf(result: { ok: boolean } & Record<string, unknown>) {
  if (!result.ok) throw new Error("คาดว่าจะสำเร็จ แต่ได้: " + JSON.stringify(result));
  return (result as { identity?: { name: string } }).identity;
}

describe("อ่านชื่อจาก X-Client-Name", () => {
  it("อ่านชื่อธรรมดาได้", () => {
    expect(nameOf(readClientNameHeader(requestWith({ "x-client-name": "Manus" })))).toEqual(
      header("Manus"),
    );
  });

  it.each([
    ["ไม่มี header", {}],
    ["ค่าว่าง", { "x-client-name": "" }],
    ["มีแต่ช่องว่าง", { "x-client-name": "   " }],
  ])("%s → ไม่ได้ชื่อ", (_label, headers) => {
    expect(nameOf(readClientNameHeader(requestWith(headers)))).toBeUndefined();
  });

  it("team_id ที่มีเครื่องหมายทับใช้ได้", () => {
    const id = "monthop-gmail/agent-builder-pi-poc";
    expect(nameOf(readClientNameHeader(requestWith({ "x-client-name": id })))?.name).toBe(id);
  });

  it("ยาว 140 ตัวพอดียังผ่าน", () => {
    const id = "a".repeat(39) + "/" + "b".repeat(100);
    expect(nameOf(readClientNameHeader(requestWith({ "x-client-name": id })))?.name).toBe(id);
  });

  /**
   * ห้ามตัดเงียบ — ชื่อที่ถูกตัดจะไม่ตรงกับที่ผู้ส่งงานพิมพ์ไว้ใน to_whom แล้วงาน
   * จะส่งไม่ถึงโดยไม่มีใคร error ตกลงกับ ChatGPT ไว้ในกระทู้ dis-28697bf3 ว่าให้
   * คืน error ที่ผู้เรียกเห็นชัดแทน
   */
  it("ยาวเกิน 140 ต้องได้ error ไม่ใช่ชื่อที่ถูกตัด", () => {
    const result = readClientNameHeader(
      requestWith({ "x-client-name": "a".repeat(141) }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/141/);
  });

  /**
   * อักขระควบคุมจริง ๆ อย่าง NUL หรือขึ้นบรรทัดใหม่ ถูกปฏิเสธตั้งแต่ชั้น HTTP แล้ว
   * (`new Request` โยน `Invalid header value`) ตัวที่ผ่านเข้ามาได้จริงคือพวกที่
   * มองไม่เห็นอย่าง zero-width space ซึ่งใช้ทำให้ชื่อดูเหมือนคนอื่นได้ทั้งที่คนละค่า
   */
  it("ตัดอักขระที่มองไม่เห็นออก กันชื่อที่ดูเหมือนกันแต่คนละค่า", () => {
    const got = nameOf(readClientNameHeader(requestWith({ "x-client-name": "Ma\u200Bnus" })));
    expect(got?.name).toBe("Manus");
  });
});

describe("ลำดับความสำคัญของชื่อสำรอง", () => {
  it("header ชนะค่าที่ผู้ดูแลตั้งไว้", () => {
    const got = staticIdentityFor(requestWith({ "x-client-name": "Manus" }), "Claude Code");
    expect(nameOf(got)).toEqual(header("Manus"));
  });

  it("ไม่มี header ก็ใช้ค่าที่ผู้ดูแลตั้ง", () => {
    expect(nameOf(staticIdentityFor(requestWith({}), "Claude Code"))).toEqual(
      config("Claude Code"),
    );
  });

  it("ไม่มีทั้งคู่ ก็ไม่มีชื่อ", () => {
    expect(nameOf(staticIdentityFor(requestWith({}), undefined))).toBeUndefined();
  });

  it("ชื่อยาวเกินส่งต่อ error ออกมา ไม่ถอยไปใช้ค่าสำรอง", () => {
    const got = staticIdentityFor(
      requestWith({ "x-client-name": "a".repeat(200) }),
      "Claude Code",
    );
    expect(got.ok).toBe(false);
  });

  /**
   * ข้อสำคัญที่สุด — client ที่ผ่าน OAuth แล้วแนบ header ชื่ออื่นมาด้วย ต้องปลอมตัว
   * เป็นคนอื่นไม่ได้
   */
  it("OAuth ชนะ header เสมอ", () => {
    withProps({ clientId: "abc123", clientName: "Gemini" });
    expect(resolveAuthor(header("ขอเป็น ChatGPT"))).toEqual({
      client: "abc123",
      name: "Gemini",
    });
  });
});
