/**
 * `unresolved_attribution` — ผู้เรียกที่เข้ามาได้ แต่ไม่ได้ประกาศว่าตัวเองคือใคร
 *
 * อนุมัติที่ `dis-3b5cb137` seq 53 ข้อ 3–4 · สร้างจากข้อมูลที่มีอยู่แล้ว ไม่เพิ่มฟิลด์ใหม่
 * บนระเบียน และ **ห้ามเดาว่าแถวไหนคือใคร**
 *
 * ของจริงที่ทำให้ต้องมี — 10 ต.ค. 2026 Codex ย้ายมาใช้โทเคนร่วมที่ไม่ผูกชื่อแต่ไม่ส่ง
 * `X-Client-Name` · ชื่อบนโต๊ะจึงมาจากค่าสำรองของ server และขึ้นเป็นชื่อของทีมอื่น
 * โดยไม่มีอะไรฟ้อง (`dis-3b5cb137` seq 47)
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";

const TOKEN = "unres-token-aaaaaaaaaaaaaaaaaaaaaa";

let id = 0;

type Unresolved = {
  clients: Array<{
    client: string;
    recorded_as: string;
    messages: number;
    records: number;
    by_kind: Record<string, number>;
    first_seen: string;
    last_seen: string;
    discussion_hints: string[];
  }>;
  total: number;
  note: string;
  limitations: string[];
};

/**
 * `as === null` คือ **ไม่ส่ง `X-Client-Name`** ซึ่งเป็นกรณีที่ไฟล์นี้สนใจ
 *
 * `staticName` จำลองค่าสำรองฝั่ง server (`STATIC_CLIENT_NAME`)
 */
async function call(
  as: string | null,
  name: string,
  args: Record<string, unknown> = {},
  staticName?: string,
): Promise<Record<string, unknown>> {
  const ctx = createExecutionContext();
  const testEnv = {
    ...env,
    MCP_AUTH_TOKEN: TOKEN,
    ALLOWED_ORIGIN_HOSTNAMES: "*",
    ...(staticName === undefined ? {} : { STATIC_CLIENT_NAME: staticName }),
  } as unknown as Parameters<typeof worker.fetch>[1];

  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${TOKEN}`,
        ...(as === null ? {} : { "x-client-name": as }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (id += 1),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  const text = await response.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const frame = JSON.parse(line ? line.slice(5) : text) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  const payload = frame.result?.content?.[0]?.text ?? "{}";
  if (frame.result?.isError) throw new Error(payload);
  return JSON.parse(payload) as Record<string, unknown>;
}

async function unresolved(staticName?: string): Promise<Unresolved> {
  const r = await call("reader/team", "get_participants", {}, staticName);
  return r.unresolved_attribution as Unresolved;
}

beforeEach(async () => {
  await resetDatabase();
});

describe("โต๊ะที่ทุกคนประกาศชื่อตัวเอง — รายการต้องว่าง", () => {
  it("ผู้เรียกที่ส่ง X-Client-Name ไม่โผล่ในรายการ", async () => {
    const dis = (await call("owner/team-a", "create_discussion", { title: "คุยกัน" }))
      .discussion_id as string;
    await call("owner/team-a", "post_message", { discussion_id: dis, body: "สวัสดี" });
    await call("owner/team-b", "post_message", { discussion_id: dis, body: "ครับ" });

    const u = await unresolved();

    expect(u.clients).toEqual([]);
    expect(u.total).toBe(0);
    // `note` ติดมาเสมอแม้รายการว่าง — ผู้อ่านต้องรู้ว่าช่องนี้หมายถึงอะไรก่อนมันไม่ว่าง
    expect(u.note).toContain("ไม่ได้ประกาศว่าเป็นใคร");
  });
});

describe("ผู้เรียกที่ไม่ประกาศชื่อ — ต้องโผล่พร้อมหลักฐานที่ไล่ได้", () => {
  /**
   * **กรณีที่ตัดสินไฟล์นี้**
   *
   * สองผู้เรียกนี้เข้ามาด้วยโทเคนใบเดียวกัน · ตัวหนึ่งประกาศชื่อ ตัวหนึ่งไม่ประกาศ
   * ถ้ารายการจับจากชื่อแทนที่จะจับจากกลไก มันจะแยกสองตัวนี้ไม่ออก
   */
  it("แยกผู้เรียกที่ประกาศชื่อ ออกจากผู้เรียกที่ไม่ประกาศ บนโทเคนใบเดียวกัน", async () => {
    const dis = (await call("owner/team-a", "create_discussion", { title: "คุยกัน" }))
      .discussion_id as string;
    await call("owner/team-a", "post_message", { discussion_id: dis, body: "ประกาศชื่อ" });
    await call(null, "post_message", { discussion_id: dis, body: "ไม่ประกาศชื่อ" }, "ค่าสำรอง");

    const u = await unresolved("ค่าสำรอง");

    expect(u.clients).toHaveLength(1);
    expect(u.clients[0].client).toBe("static-bearer");
    expect(u.clients[0].messages).toBe(1);
    expect(u.total).toBe(1);
  });

  it("recorded_as คือค่าสำรองของ server ไม่ใช่ชื่อที่ผู้เรียกส่งมา", async () => {
    const dis = (await call("owner/team-a", "create_discussion", { title: "คุยกัน" }))
      .discussion_id as string;
    await call(null, "post_message", { discussion_id: dis, body: "x" }, "ชื่อสำรองของเซิร์ฟเวอร์");

    const u = await unresolved("ชื่อสำรองของเซิร์ฟเวอร์");

    expect(u.clients[0].recorded_as).toBe("ชื่อสำรองของเซิร์ฟเวอร์");
  });

  it("ไม่มีค่าสำรองเลย ก็ยังจับได้ — ชื่อกลายเป็นป้ายของกลไก", async () => {
    const dis = (await call("owner/team-a", "create_discussion", { title: "คุยกัน" }))
      .discussion_id as string;
    await call(null, "post_message", { discussion_id: dis, body: "x" });

    const u = await unresolved();

    expect(u.clients).toHaveLength(1);
    // ป้ายของกลไก ไม่ใช่ชื่อของทีมใด — เป็นเหตุผลที่ค่าสำรองไม่ควรเป็นชื่อคนจริง
    expect(u.clients[0].recorded_as).toBe("Static bearer");
  });

  it("บอกช่วงเวลาและกระทู้ที่ไปไล่ได้", async () => {
    const d1 = (await call("owner/team-a", "create_discussion", { title: "หนึ่ง" }))
      .discussion_id as string;
    const d2 = (await call("owner/team-a", "create_discussion", { title: "สอง" }))
      .discussion_id as string;
    await call(null, "post_message", { discussion_id: d1, body: "x" }, "ค่าสำรอง");
    await call(null, "post_message", { discussion_id: d2, body: "y" }, "ค่าสำรอง");

    const u = await unresolved("ค่าสำรอง");
    const row = u.clients[0];

    expect(row.messages).toBe(2);
    expect(row.first_seen).toBeTruthy();
    expect(row.last_seen).toBeTruthy();
    expect(row.discussion_hints.sort()).toEqual([d1, d2].sort());
  });
});

describe("ของที่จงใจไม่มี", () => {
  /**
   * `seq 53` ข้อ 4 ขอ `status: unresolved|mapped|fixed` · ไม่ทำ และเขียนเหตุไว้
   *
   * ทุกแถวในรายการนี้เป็น `unresolved` โดยนิยาม ฟิลด์จึงมีค่าเดียวทุกแถวและไม่บอกอะไร
   * ซึ่งเป็นเหตุผลเดียวกับที่ `context_source` ถูกตัดออกจาก `acting_context` ·
   * ส่วน `mapped` กับ `fixed` อนุมานไม่ได้ เพราะไม่มีที่ให้บันทึก และการเชื่อมกุญแจ
   * ที่ไม่ผูกชื่อกับชื่อที่โผล่ภายหลังคือการเดา ซึ่ง `seq 53` ห้ามไว้
   */
  it("ไม่มีฟิลด์ status เพราะมันจะมีค่าเดียวทุกแถว", async () => {
    const dis = (await call("owner/team-a", "create_discussion", { title: "คุยกัน" }))
      .discussion_id as string;
    await call(null, "post_message", { discussion_id: dis, body: "x" }, "ค่าสำรอง");

    const u = await unresolved("ค่าสำรอง");

    expect("status" in u.clients[0]).toBe(false);
    expect(Object.keys(u.clients[0]).sort()).toEqual([
      "by_kind",
      "client",
      "discussion_hints",
      "first_seen",
      "last_seen",
      "messages",
      "recorded_as",
      "records",
    ]);
  });
});

describe("clients ของแต่ละชื่อ บอกช่วงเวลาและจำนวนด้วย", () => {
  it("เพิ่ม first_seen และ messages โดยคีย์เดิมยังอยู่", async () => {
    const dis = (await call("owner/team-a", "create_discussion", { title: "คุยกัน" }))
      .discussion_id as string;
    await call("owner/team-a", "post_message", { discussion_id: dis, body: "หนึ่ง" });
    await call("owner/team-a", "post_message", { discussion_id: dis, body: "สอง" });

    const r = await call("reader/team", "get_participants", {});
    const rows = r.participants as Array<{
      name: string;
      clients: Array<Record<string, unknown>>;
    }>;
    const teamA = rows.find((p) => p.name === "owner/team-a")!;

    expect(Object.keys(teamA.clients[0]).sort()).toEqual([
      "client",
      "first_seen",
      "last_seen",
      "mechanism",
      "messages",
    ]);
    expect(teamA.clients[0].messages).toBe(2);
    expect(teamA.clients[0].first_seen as string).not.toBe("");
  });
});

/**
 * นับทุกร่องรอย ไม่ใช่แค่ข้อความ
 *
 * รุ่นแรกอ่านจากตาราง `messages` ตารางเดียว · ใน `ws-001` เส้นนี้แตะของไว้ 4 ชิ้น
 * แต่รายงานบอก 2 และ **ไม่ได้บอกว่ามันนับแค่ข้อความ** — `2` จึงอ่านได้ว่าเป็นยอดรวม
 * (`dis-3b5cb137` seq 59)
 */
describe("ร่องรอยที่ไม่ใช่ข้อความ", () => {
  /** **กรณีที่ตัดสิน** — ผู้เรียกที่ไม่ประกาศชื่อและ *ไม่เคยโพสต์อะไรเลย* */
  it("ผู้เรียกที่สร้างแต่ใบงาน ไม่เคยโพสต์ ต้องยังโผล่ในรายการ", async () => {
    await call(null, "create_task", { title: "ใบที่สร้างโดยคนไม่ประกาศชื่อ" }, "ค่าสำรอง");

    const u = await unresolved("ค่าสำรอง");

    expect(u.clients).toHaveLength(1);
    // รุ่นแรกได้รายการว่าง เพราะไม่มีข้อความให้นับ
    expect(u.clients[0].records).toBe(1);
    expect(u.clients[0].messages).toBe(0);
    expect(u.clients[0].by_kind).toEqual({ tasks_created: 1 });
  });

  it("แยกชนิดของร่องรอยให้ และ records เป็นยอดรวมของทุกชนิด", async () => {
    const dis = (await call("owner/team-a", "create_discussion", { title: "คุยกัน" }))
      .discussion_id as string;
    await call(null, "post_message", { discussion_id: dis, body: "x" }, "ค่าสำรอง");
    await call(null, "create_task", { title: "ใบหนึ่ง" }, "ค่าสำรอง");
    await call(null, "create_task", { title: "ใบสอง" }, "ค่าสำรอง");

    const row = (await unresolved("ค่าสำรอง")).clients[0];

    expect(row.by_kind).toEqual({ messages: 1, tasks_created: 2 });
    expect(row.records).toBe(3);
    expect(row.messages).toBe(1);
  });

  it("total เป็นยอดร่องรอย ไม่ใช่ยอดข้อความ", async () => {
    await call(null, "create_task", { title: "ใบเดียว" }, "ค่าสำรอง");

    const u = await unresolved("ค่าสำรอง");

    // รุ่นแรกจะได้ 0 เพราะบวกจาก messages
    expect(u.total).toBe(1);
  });

  it("ช่วงเวลาครอบร่องรอยที่ไม่ใช่ข้อความด้วย", async () => {
    const task = (await call(null, "create_task", { title: "ใบแรกสุด" }, "ค่าสำรอง"))
      .task_id as string;
    expect(task).toBeTruthy();

    const row = (await unresolved("ค่าสำรอง")).clients[0];

    // รุ่นแรกคืนค่าว่างเพราะไม่มีแถวข้อความ
    expect(row.first_seen).toBeTruthy();
    expect(row.last_seen).toBeTruthy();
  });
});

describe("ข้อจำกัดต้องอยู่ติดกับตัวเลขที่มันจำกัด", () => {
  /**
   * ข้อที่สำคัญที่สุด — 10 ต.ค. Codex ยิงเส้นที่ไม่ประกาศชื่อ 5 ครั้งแล้วเครื่องมือนี้
   * ไม่เห็นเลย เพราะทั้ง 5 ครั้งเป็นการอ่าน · ตอนนั้นข้อจำกัดนี้ไม่ได้อยู่ในผลลัพธ์
   */
  it("บอกว่าผู้เรียกที่แค่อ่านไม่เคยปรากฏ และรายการว่างไม่ได้แปลว่าไม่มีใคร", async () => {
    const u = await unresolved();

    expect(u.limitations.length).toBeGreaterThan(0);
    expect(u.limitations.join(" ")).toContain("แค่อ่าน");
    expect(u.limitations.join(" ")).toContain("ว่างเปล่า");
  });

  it("ข้อจำกัดติดมาแม้รายการไม่ว่าง ไม่ใช่โผล่เฉพาะตอนว่าง", async () => {
    await call(null, "create_task", { title: "ใบหนึ่ง" }, "ค่าสำรอง");

    const u = await unresolved("ค่าสำรอง");

    expect(u.clients).toHaveLength(1);
    expect(u.limitations.join(" ")).toContain("แค่อ่าน");
  });
});
