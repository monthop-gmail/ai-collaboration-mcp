import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "./apply-schema";
import {
  RequestError,
  createDiscussion,
  postMessage,
  readMessages,
  readWorkspaceContext,
} from "../src/db";

const claude = { client: "c-claude", name: "Claude" };
const chatgpt = { client: "c-chatgpt", name: "ChatGPT" };
const gemini = { client: "c-gemini", name: "Gemini" };

beforeEach(async () => {
  await resetDatabase();
});

async function newDiscussion(title = "หัวข้อทดสอบ") {
  return createDiscussion(env.DB, "ws-001", title, claude);
}

describe("การออกเลข seq", () => {
  it("เริ่มที่ 1 แล้วเดินทีละหนึ่ง", async () => {
    const d = await newDiscussion();
    const a = await postMessage(env.DB, d.id, "proposal", "ข้อเสนอ", claude);
    const b = await postMessage(env.DB, d.id, "review", "ความเห็น", chatgpt);

    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
  });

  it("แยกเลขตามกระทู้ ไม่ปนกัน", async () => {
    const d1 = await newDiscussion("กระทู้หนึ่ง");
    const d2 = await newDiscussion("กระทู้สอง");

    await postMessage(env.DB, d1.id, "note", "x", claude);
    const first = await postMessage(env.DB, d2.id, "note", "y", claude);

    expect(first.seq).toBe(1);
  });

  /**
   * นี่คือข้ออ้างหลักของทั้ง design — AI สามตัวโพสต์พร้อมกันแล้วต้องไม่ได้เลขชนกัน
   * ถ้าเปลี่ยนไปอ่าน MAX(seq) มาก่อนแล้วค่อย INSERT แยกคำสั่ง test นี้จะพัง
   */
  it("โพสต์พร้อมกันหลายตัว ได้เลขไม่ซ้ำและไม่ขาด", async () => {
    const d = await newDiscussion();
    const authors = [claude, chatgpt, gemini];

    const posted = await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        postMessage(env.DB, d.id, "note", `ข้อความ ${i}`, authors[i % 3]!),
      ),
    );

    const seqs = posted.map((m) => m.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(seqs).size).toBe(9);
  });
});

describe("ผู้เขียนมาจาก connection ไม่ใช่จากคำขอ", () => {
  it("เก็บทั้ง client id และชื่อที่แสดง", async () => {
    const d = await newDiscussion();
    await postMessage(env.DB, d.id, "note", "สวัสดี", gemini);

    const page = await readMessages(env.DB, d.id, 0, 10);
    expect(page.messages[0]!.author_client).toBe("c-gemini");
    expect(page.messages[0]!.author_name).toBe("Gemini");
  });
});

describe("การอ่านแบบแบ่งหน้า", () => {
  it("บอก has_more และ total เมื่อผลถูกตัด", async () => {
    const d = await newDiscussion();
    for (let i = 0; i < 12; i++) {
      await postMessage(env.DB, d.id, "note", `ข้อความ ${i}`, claude);
    }

    const page = await readMessages(env.DB, d.id, 0, 5);
    expect(page.messages).toHaveLength(5);
    expect(page.has_more).toBe(true);
    expect(page.total).toBe(12);
    expect(page.latest_seq).toBe(12);
  });

  it("ไม่บอก has_more เมื่อผลครบ", async () => {
    const d = await newDiscussion();
    await postMessage(env.DB, d.id, "note", "เดียว", claude);

    const page = await readMessages(env.DB, d.id, 0, 5);
    expect(page.has_more).toBe(false);
    expect(page.total).toBe(1);
  });

  it("after_seq คืนเฉพาะที่ยังไม่เห็น", async () => {
    const d = await newDiscussion();
    for (let i = 0; i < 5; i++) {
      await postMessage(env.DB, d.id, "note", `ข้อความ ${i}`, claude);
    }

    const page = await readMessages(env.DB, d.id, 3, 10);
    expect(page.messages.map((m) => m.seq)).toEqual([4, 5]);
    expect(page.total).toBe(5);
  });

  it("กระทู้ว่างคืน latest_seq เป็น 0 ไม่ใช่พัง", async () => {
    const d = await newDiscussion();
    const page = await readMessages(env.DB, d.id, 0, 10);

    expect(page.messages).toEqual([]);
    expect(page.latest_seq).toBe(0);
    expect(page.has_more).toBe(false);
  });
});

describe("การอ้างถึงข้อความอื่น", () => {
  it("ตอบ seq ที่มีอยู่ได้", async () => {
    const d = await newDiscussion();
    await postMessage(env.DB, d.id, "proposal", "ข้อเสนอ", chatgpt);
    const reply = await postMessage(env.DB, d.id, "review", "เห็นด้วย", claude, 1);

    expect(reply.in_reply_to).toBe(1);
  });

  it("ปฏิเสธ seq ที่ไม่มี แทนที่จะเก็บค่าที่ชี้ไปไหนไม่รู้", async () => {
    const d = await newDiscussion();
    await expect(
      postMessage(env.DB, d.id, "review", "ตอบผี", claude, 99),
    ).rejects.toThrow(RequestError);
  });
});

describe("id ที่ไม่มีอยู่", () => {
  it("โพสต์เข้ากระทู้ที่ไม่มี ได้ RequestError", async () => {
    await expect(
      postMessage(env.DB, "ไม่มีจริง", "note", "x", claude),
    ).rejects.toThrow(RequestError);
  });

  it("สร้างกระทู้ใน workspace ที่ไม่มี ได้ RequestError", async () => {
    await expect(
      createDiscussion(env.DB, "ws-ไม่มี", "หัวข้อ", claude),
    ).rejects.toThrow(RequestError);
  });
});

describe("ภาพรวม workspace", () => {
  it("รวมจำนวนข้อความและผู้เข้าร่วมของแต่ละกระทู้", async () => {
    const d = await newDiscussion("สถาปัตยกรรม");
    await postMessage(env.DB, d.id, "proposal", "เสนอ A", chatgpt);
    await postMessage(env.DB, d.id, "review", "ขอค้าน", claude);
    await postMessage(env.DB, d.id, "review", "เห็นด้วยกับ A", gemini);

    const ctx = await readWorkspaceContext(env.DB, "ws-001", 10);
    const row = ctx.discussions.find((x) => x.id === d.id)!;

    expect(row.message_count).toBe(3);
    expect(row.latest_seq).toBe(3);
    expect(row.participants.sort()).toEqual(["ChatGPT", "Claude", "Gemini"]);
    expect(ctx.participants.sort()).toEqual(["ChatGPT", "Claude", "Gemini"]);
  });

  it("กระทู้ที่ยังไม่มีข้อความก็ยังแสดง", async () => {
    const d = await newDiscussion("ยังไม่มีใครตอบ");
    const ctx = await readWorkspaceContext(env.DB, "ws-001", 10);
    const row = ctx.discussions.find((x) => x.id === d.id)!;

    expect(row.message_count).toBe(0);
    expect(row.participants).toEqual([]);
  });

  it("บอก has_more เมื่อกระทู้เยอะกว่าที่ขอ", async () => {
    for (let i = 0; i < 4; i++) await newDiscussion(`กระทู้ ${i}`);

    const ctx = await readWorkspaceContext(env.DB, "ws-001", 2);
    expect(ctx.discussions).toHaveLength(2);
    expect(ctx.has_more).toBe(true);
    expect(ctx.total_discussions).toBe(4);
  });
});
