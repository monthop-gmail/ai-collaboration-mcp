import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "./apply-schema";
import { createDiscussion, postMessage } from "../src/db";
import {
  acceptHandoff,
  createHandoff,
  createTask,
  recordDecision,
  resolveDecision,
  updateTask,
} from "../src/db-work";
import { handleView } from "../src/view";
import { CONTRACT_VERSION } from "../src/tool-kit";
import type { Env } from "../src/env";

const chatgpt = { client: "c-chatgpt", name: "ChatGPT" };
const claude = { client: "c-claude", name: "Claude" };
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

  /**
   * รหัสที่มี + / = จะถูก query string ตีความจนค่าเพี้ยนโดยไม่มีใครรู้ตัว เจอจริงตอน
   * เปิดหน้านี้ครั้งแรก ข้อความสองแบบจึงต้องแยกกัน ไม่งั้นคนที่เจอ 401 ไม่รู้ว่าต้อง
   * แก้ที่ลิงก์หรือแก้ที่รหัส
   */
  it("บอกต่างกันระหว่างไม่ได้ส่งรหัส กับส่งมาแล้วไม่ตรง", async () => {
    const missing = await handleView(get("/view"), withToken(TOKEN));
    expect(await missing!.text()).toContain("ยังไม่ได้ส่งรหัสมา");

    const wrong = await handleView(get("/view?key=ผิด"), withToken(TOKEN));
    expect(await wrong!.text()).toContain("รหัสไม่ตรง");
  });

  it("ส่งรหัสทาง Authorization ได้ เพราะ header ไม่ผ่านการตีความของ query string", async () => {
    await createDiscussion(env.DB, WS, "หัวข้อ", chatgpt);

    const ok = await handleView(
      get("/view", { authorization: `Bearer ${TOKEN}` }),
      withToken(TOKEN),
    );
    expect(ok!.status).toBe(200);
    expect(await ok!.text()).toContain("หัวข้อ");

    const bad = await handleView(
      get("/view", { authorization: "Bearer ผิด" }),
      withToken(TOKEN),
    );
    expect(bad!.status).toBe(401);
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

  /**
   * ตัวเลขในแถบสถานะเป็นของที่คนอยากกดดูต่อ ถ้ากดไม่ได้ก็ต้องไปเรียก tool เอง
   * ซึ่งเป็นด่านเดียวกับที่หน้านี้ตั้งใจเอาออก
   */
  it("ตัวเลขในแถบลิงก์ไปหน้าของที่ค้าง", async () => {
    const res = await handleView(
      get("/view", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const html = await res!.text();

    expect(html).toContain(`${"/view"}/items?ws=ws-001#decisions`);
    expect(html).toContain(`${"/view"}/items?ws=ws-001#handoffs`);
    expect(html).toContain(`${"/view"}/items?ws=ws-001#tasks`);
  });

  it("หน้าของที่ค้างแสดงครบทั้งสามชนิดพร้อม anchor", async () => {
    const dis = await createDiscussion(env.DB, WS, "กระทู้", chatgpt);
    await recordDecision(env.DB, WS, "ข้อสรุปทดสอบ", "เหตุผลของข้อสรุป", chatgpt, dis.id);
    const task = await createTask(env.DB, WS, "งานทดสอบ", "รายละเอียดงาน", chatgpt, dis.id);
    await createHandoff(env.DB, task.id, "Gemini", "บริบทที่ส่งมาด้วย", chatgpt);

    const res = await handleView(
      get("/view/items", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const html = await res!.text();

    expect(res!.status).toBe(200);
    expect(html).toContain('id="decisions"');
    expect(html).toContain('id="handoffs"');
    expect(html).toContain('id="tasks"');
    expect(html).toContain("ข้อสรุปทดสอบ");
    expect(html).toContain("งานทดสอบ");
    expect(html).toContain("ส่งถึง Gemini");
    // สถานะที่คำนวณสดต้องโผล่ให้คนอ่านเห็น ไม่ใช่แค่ pending/accepted ดิบ ๆ
    expect(html).toContain("waiting");
    expect(html).toContain("proposed");
  });

  /**
   * detail ของ decision บางใบยาวห้าพันตัวอักษร ถ้าไม่พับหน้าจะกวาดตาไม่ได้
   * ใช้ details ของ HTML ล้วนเพราะหน้านี้ห้ามมี JavaScript
   */
  it("เนื้อยาวถูกพับไว้ใน details ไม่ใช่แสดงเต็มทันที", async () => {
    const dis = await createDiscussion(env.DB, WS, "กระทู้", chatgpt);
    await recordDecision(env.DB, WS, "หัวข้อสั้น", "เนื้อที่ยาวมากของข้อสรุป", chatgpt, dis.id);

    const res = await handleView(
      get("/view/items", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const html = await res!.text();

    expect(html).toContain("<details>");
    expect(html).toContain("อ่านเนื้อเต็ม");
    // หัวข้ออยู่นอก details ส่วนเนื้ออยู่ใน — เนื้อต้องมาหลัง details ที่เปิด
    expect(html.indexOf("หัวข้อสั้น")).toBeLessThan(html.indexOf("<details>"));
    expect(html.indexOf("<details>")).toBeLessThan(html.indexOf("เนื้อที่ยาวมากของข้อสรุป"));
  });

  /**
   * ค่าเริ่มต้นแสดงเฉพาะของที่ค้าง เพราะของที่ปิดแล้วสะสมจนกลบของที่ต้องทำ แต่การกรอง
   * ที่ไม่บอกว่ากรองอะไรออกคือผลที่ถูกตัดโดยไม่มีสัญญาณ ซึ่งเป็นความล้มเหลวชนิดที่
   * repo นี้ตั้งขึ้นมาเพื่อกำจัด
   */
  it("ค่าเริ่มต้นซ่อนของที่ปิดแล้ว และบอกว่าซ่อนไปกี่รายการ", async () => {
    const dis = await createDiscussion(env.DB, WS, "กระทู้", chatgpt);
    await recordDecision(env.DB, WS, "ข้อสรุปที่ยังค้าง", "x", chatgpt, dis.id);
    const closed = await recordDecision(env.DB, WS, "ข้อสรุปที่ปิดแล้ว", "x", chatgpt, dis.id);
    await resolveDecision(env.DB, closed.id, "approved", "เอาอันนี้", claude);

    const open = await createTask(env.DB, WS, "งานที่ยังค้าง", "", chatgpt);
    const finished = await createTask(env.DB, WS, "งานที่ปิดแล้ว", "", chatgpt);
    await updateTask(env.DB, finished.id, chatgpt, { status: "done" });
    const { handoff } = await createHandoff(env.DB, open.id, "Gemini", "ช่วยต่อ", chatgpt);
    const takenTask = await createTask(env.DB, WS, "งานที่รับไปแล้ว", "", chatgpt);
    const taken = await createHandoff(env.DB, takenTask.id, "Claude", "ช่วยที", chatgpt);
    await acceptHandoff(env.DB, taken.handoff.id, claude);

    const res = await handleView(
      get("/view/items", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const html = await res!.text();

    expect(html).toContain("ข้อสรุปที่ยังค้าง");
    expect(html).not.toContain("ข้อสรุปที่ปิดแล้ว");
    expect(html).toContain("งานที่ยังค้าง");
    expect(html).not.toContain("งานที่ปิดแล้ว");
    expect(html).toContain(handoff.id);
    expect(html).not.toContain(taken.handoff.id);
    // ของที่ซ่อนต้องมีเสียง ไม่ใช่หายไปเฉย ๆ
    expect(html).toContain("ซ่อน 1 รายการที่ปิดแล้ว");
    expect(html).toContain("ดูทั้งหมด");
  });

  it("ใส่ all=1 แล้วเห็นครบ พร้อมทางกลับไปดูเฉพาะที่ค้าง", async () => {
    const dis = await createDiscussion(env.DB, WS, "กระทู้", chatgpt);
    const closed = await recordDecision(env.DB, WS, "ข้อสรุปที่ปิดแล้ว", "x", chatgpt, dis.id);
    await resolveDecision(env.DB, closed.id, "approved", "เอาอันนี้", claude);

    const res = await handleView(
      get("/view/items?all=1", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const html = await res!.text();

    expect(html).toContain("ข้อสรุปที่ปิดแล้ว");
    expect(html).toContain("แสดงเฉพาะที่ค้าง");
    expect(html).not.toContain("ซ่อน");
  });

  it("หน้าของที่ค้างก็หนีอักขระเหมือนกัน", async () => {
    await createTask(env.DB, WS, "<b>งาน</b>", "<script>alert(3)</script>", chatgpt);

    const res = await handleView(
      get("/view/items", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const html = await res!.text();

    expect(html).not.toContain("<b>งาน</b>");
    expect(html).not.toContain("<script>alert(3)</script>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("workspace ที่ไม่มีอยู่ในหน้าของที่ค้าง ได้หน้าไม่พบ", async () => {
    const res = await handleView(
      get("/view/items?ws=ws-ไม่มีจริง", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );

    expect(await res!.text()).toContain("ไม่พบ");
  });

  it("ไม่มี JavaScript ในหน้าเลย เพราะหน้านี้อ่านอย่างเดียว", async () => {
    await createDiscussion(env.DB, WS, "หัวข้อ", chatgpt);

    const list = await handleView(
      get("/view", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const items = await handleView(
      get("/view/items", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );

    for (const html of [await list!.text(), await items!.text()]) {
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<form");
      expect(html).not.toContain("onclick");
    }
  });
});

describe("เวลาบนหน้าอ่าน", () => {
  /**
   * เวลาที่ข้ามเที่ยงคืนคือจุดที่พลาดแล้วเห็นชัดที่สุด — 18:30 UTC ของวันที่ 2
   * คือ 01:30 ของวันที่ 3 ตามเวลาไทย ถ้าลืมบวก offset จะผิดทั้งวันและเวลา
   * ไม่ใช่ผิดแค่ชั่วโมงซึ่งกวาดตาผ่านได้
   */
  it("แสดงเวลาไทย ไม่ใช่ UTC และวันเลื่อนตามไปด้วย", async () => {
    const dis = await createDiscussion(env.DB, WS, "กระทู้", chatgpt);
    await postMessage(env.DB, dis.id, "note", "ข้อความ", chatgpt);
    await env.DB.prepare("UPDATE messages SET created_at = ?1 WHERE discussion_id = ?2")
      .bind("2026-01-02T18:30:00.000Z", dis.id)
      .run();

    const res = await handleView(
      get(`/view/${dis.id}`, { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const html = await res!.text();

    expect(html).toContain("03/01 01:30");
    expect(html).not.toContain("02/01 18:30");
  });

  it("เวลาที่ไม่ข้ามวันก็บวกเจ็ดชั่วโมงเหมือนกัน", async () => {
    const dis = await createDiscussion(env.DB, WS, "กระทู้", chatgpt);
    await postMessage(env.DB, dis.id, "note", "ข้อความ", chatgpt);
    await env.DB.prepare("UPDATE messages SET created_at = ?1 WHERE discussion_id = ?2")
      .bind("2026-06-15T02:05:00.000Z", dis.id)
      .run();

    const res = await handleView(
      get(`/view/${dis.id}`, { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );

    expect(await res!.text()).toContain("15/06 09:05");
  });

  /**
   * ตัวเลขเปล่า ๆ บอกเขตเวลาไม่ได้ ถ้าไม่ติดป้ายไว้ คนอ่านจะเดาเอง แล้วครึ่งหนึ่ง
   * จะเดาว่าเป็น UTC เพราะของเดิมเป็นแบบนั้น
   */
  it("ทุกหน้าที่มีเวลา ติดป้ายบอกเขตเวลาไว้", async () => {
    const dis = await createDiscussion(env.DB, WS, "กระทู้", chatgpt);

    const paths = ["/view", `/view/${dis.id}`, "/view/items"];
    for (const path of paths) {
      const res = await handleView(
        get(path, { cookie: `collab_view=${TOKEN}` }),
        withToken(TOKEN),
      );
      expect(await res!.text()).toContain("UTC+7");
    }
  });
});

describe("ป้าย contract บนหน้าอ่าน", () => {
  /**
   * เลขนี้เคยเขียนตายตัวเป็น 2 อยู่ในหน้าเว็บ ซึ่งเป็นสำเนาที่ขยับตามต้นทางไม่ได้
   * หน้าที่ทั้งหมดของเลขนี้คือจับความไม่ตรงกัน สำเนาที่ค้างจึงโกหกใส่คนที่เปิดหน้า
   * มาไล่หาว่าเลขไม่ตรงกันตรงไหนพอดี เทสต์นี้ผูกสองฝั่งไว้ด้วยกันเพื่อให้พังตอนเทสต์
   */
  it("แสดงเลขเดียวกับ CONTRACT_VERSION ไม่ใช่เลขตายตัว", async () => {
    await createDiscussion(env.DB, WS, "หัวข้อ", chatgpt);

    const res = await handleView(
      get("/view", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const html = await res!.text();

    expect(html).toContain(`contract ${CONTRACT_VERSION}`);
    expect(html).not.toContain(`contract ${CONTRACT_VERSION + 1}`);
    expect(html).not.toContain(`contract ${CONTRACT_VERSION - 1}`);
  });

  /**
   * ป้ายนี้กดไม่ได้และเป็นเลขลอย ๆ ที่บอกตัวเองไม่ได้ว่าคืออะไร มีคนถามมาแล้วจริง ๆ
   * คำอธิบายจึงต้องอยู่ติดกับตัวเลข ไม่ใช่อยู่ใน README ที่คนเปิดหน้าไม่ได้อ่าน
   */
  it("ป้าย contract มีคำอธิบายติดไว้ให้เอาเมาส์ชี้", async () => {
    await createDiscussion(env.DB, WS, "หัวข้อ", chatgpt);

    const res = await handleView(
      get("/view", { cookie: `collab_view=${TOKEN}` }),
      withToken(TOKEN),
    );
    const html = await res!.text();

    expect(html).toContain("<span title=");
    expect(html).toContain("client ถือ schema เก่าอยู่");
  });
});
