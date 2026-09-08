import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "./apply-schema";
import { createDiscussion, postMessage } from "../src/db";
import { handleView } from "../src/view";
import type { Env } from "../src/env";

const chatgpt = { client: "c-chatgpt", name: "ChatGPT" };
const WS = "ws-001";
const TOKEN = "s3cret-view";

/** env ของ test ไม่มี secret ของหน้านี้ จึงประกอบขึ้นต่อ test เพื่อคุมทั้งสองกรณี */
function withToken(token?: string): Env {
  return { ...(env as unknown as Env), VIEW_TOKEN: token };
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://example.com${path}`, { headers });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("หน้าอ่านอย่างเดียว", () => {
  it("เส้นทางอื่นไม่ใช่ของหน้านี้ ต้องคืน null ให้ OAuth ทำงานต่อ", async () => {
    expect(await handleView(get("/mcp"), withToken(TOKEN))).toBeNull();
    expect(await handleView(get("/authorize"), withToken(TOKEN))).toBeNull();
    // ชื่อที่ขึ้นต้นเหมือนกันแต่คนละเส้นทาง ต้องไม่ถูกดักไปด้วย
    expect(await handleView(get("/viewer"), withToken(TOKEN))).toBeNull();
  });

  /**
   * ไม่ตั้งรหัสแล้วเปิดโล่งคือกรณีที่แย่ที่สุด เพราะทั้งโต๊ะอ่านได้โดยไม่มีใครรู้ตัว
   * ค่าเริ่มต้นจึงต้องเป็นปิด ไม่ใช่เปิด
   */
  it("ยังไม่ตั้ง VIEW_TOKEN ต้องไม่แสดงข้อมูลใด", async () => {
    const res = await handleView(get("/view"), withToken(undefined));
    const html = await res!.text();

    expect(html).toContain("ยังไม่ได้เปิด");
    expect(html).not.toContain("งานจริงของทีม");
  });

  it("ไม่มีรหัสได้ 401", async () => {
    const res = await handleView(get("/view"), withToken(TOKEN));
    expect(res!.status).toBe(401);
  });

  it("รหัสผิดได้ 401 ไม่ใช่หน้าเนื้อหา", async () => {
    const res = await handleView(get("/view?key=ผิด"), withToken(TOKEN));
    expect(res!.status).toBe(401);
  });

  /**
   * ย้ายรหัสจาก URL ไปอยู่ใน cookie เพื่อให้ลิงก์ที่คนก็อปส่งต่อไม่พารหัสไปด้วย
   * โดยไม่ได้ตั้งใจ
   */
  it("รหัสถูกต้องผ่าน query ตั้ง cookie แล้วพากลับไป URL ที่ไม่มีรหัส", async () => {
    const res = await handleView(get("/view?key=" + TOKEN), withToken(TOKEN));

    expect(res!.status).toBe(302);
    expect(res!.headers.get("location")).toBe("/view");
    const cookie = res!.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("มี cookie ที่ถูกต้องแล้วอ่านรายการกระทู้ได้", async () => {
    await createDiscussion(env.DB, WS, "หัวข้อทดสอบ", chatgpt);

    const res = await handleView(
      get("/view", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const html = await res!.text();

    expect(res!.status).toBe(200);
    expect(html).toContain("หัวข้อทดสอบ");
    expect(html).toContain("decision รอเคาะ");
  });

  /**
   * เนื้อหาทุกบรรทัดมาจาก AI ภายนอกซึ่งเขียนอะไรก็ได้ ถ้าไม่หนีอักขระ ข้อความเดียว
   * ก็แทรกสคริปต์ลงหน้าที่คนอื่นเปิดได้
   */
  it("เนื้อหาที่มีแท็กถูกหนีอักขระ ไม่หลุดเป็น HTML", async () => {
    const dis = await createDiscussion(env.DB, WS, "<script>alert(1)</script>", chatgpt);
    await postMessage(env.DB, dis.id, "note", "<img src=x onerror=alert(2)>", chatgpt);

    const list = await handleView(
      get("/view", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const listHtml = await list!.text();
    expect(listHtml).not.toContain("<script>alert(1)</script>");
    expect(listHtml).toContain("&lt;script&gt;");

    const thread = await handleView(
      get(`/view/${dis.id}`, { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const threadHtml = await thread!.text();
    expect(threadHtml).not.toContain("<img src=x");
    expect(threadHtml).toContain("&lt;img src=x");
  });

  it("อ่านข้อความในกระทู้ได้ทั้งหมด เรียงตาม seq", async () => {
    const dis = await createDiscussion(env.DB, WS, "กระทู้", chatgpt);
    await postMessage(env.DB, dis.id, "proposal", "ข้อความแรก", chatgpt);
    await postMessage(env.DB, dis.id, "review", "ข้อความที่สอง", chatgpt);

    const res = await handleView(
      get(`/view/${dis.id}`, { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const html = await res!.text();

    expect(html.indexOf("ข้อความแรก")).toBeLessThan(html.indexOf("ข้อความที่สอง"));
    expect(html).toContain("proposal");
    expect(html).toContain("review");
  });

  it("กระทู้ที่ไม่มีอยู่ได้หน้าไม่พบ ไม่ใช่ระเบิด", async () => {
    const res = await handleView(
      get("/view/dis-ไม่มีจริง", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );

    expect(res!.status).toBe(200);
    expect(await res!.text()).toContain("ไม่พบ");
  });

  it("ไม่มี JavaScript ในหน้าเลย เพราะหน้านี้อ่านอย่างเดียว", async () => {
    await createDiscussion(env.DB, WS, "หัวข้อ", chatgpt);

    const res = await handleView(
      get("/view", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const html = await res!.text();

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<form");
  });
});
