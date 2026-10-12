/**
 * ผู้อ่านต้องรู้ได้ว่าอ่านครบหรือยัง **จากของที่ไปถึงเขาจริง**
 *
 * ## แผลจริง — รอบนี้คือรอบที่สอง
 *
 * 11 ต.ค. 2026 แก้ไปรอบหนึ่งแล้ว (`9652922`) ย้าย `total` · `has_more` ·
 * `next_cursor` ขึ้นหน้า array ให้ `get_decisions` · `get_plans` · `get_tasks` ·
 * `get_handoffs` พร้อมเทสต์ล็อกตำแหน่งไบต์
 *
 * 12 ต.ค. 2026 Grok เรียก **`get_workspace_context`** จริงได้ 26.8KB แล้วถูกตัดที่
 * 20KB กลาง array `discussions` → ไม่เห็นทั้ง `has_more` · `total_discussions` ·
 * `quiet_discussions.hidden` ทั้งที่ description ของ tool นี้เขียนไว้เองว่า
 * *always reports how many were hidden*
 *
 * **tool ที่ description บอกทุกคนว่า "call this first" เป็นตัวเดียวที่ไม่ได้แก้** —
 * ด่านมีแล้ว เทสต์มีแล้ว แต่ไม่ได้อยู่ตรงที่มันพัง ซึ่งเป็นธีมที่ผิดซ้ำมาทั้งสัปดาห์
 *
 * ## ของอื่นในไฟล์นี้
 *
 * `warning` ในหัวผล — ช่องเดียวที่ไปถึงผู้เรียกที่ connector cache schema ไว้ ·
 * `capability` filter — ตัวกรองที่ถูกทั้งสองทางด้วยการหุ้มตัวคั่น ·
 * `total_actionable` — เลขที่ชื่อชนกับ `handoffs_pending` ต่างกันได้หลายเท่า ·
 * โหมดย่อ — ตัดช่องข้อความยาวช่องเดียว และ **ประกาศว่าตัดอะไรไปเสมอ**
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";

const TOKEN = "complete-token-aaaaaaaaaaaaaaaaaaa";
const TEAM = "owner/reader";
const TAKER = "owner/taker";
const TAKER_TOKEN = "complete-taker-bbbbbbbbbbbbbbbbbb";
const WS = "ws-001";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: TOKEN,
  MCP_AUTH_TOKENS: `${TAKER_TOKEN}=${TAKER}`,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

let id = 0;

/** คืนข้อความดิบด้วย เพราะ **ลำดับคีย์** คือสิ่งที่ไฟล์นี้ต้องวัด */
async function raw(
  name: string,
  args: Record<string, unknown> = {},
  as: "me" | "taker" = "me",
): Promise<string> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${as === "taker" ? TAKER_TOKEN : TOKEN}`,
        ...(as === "taker" ? {} : { "x-client-name": TEAM }),
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
  return payload;
}

async function call(
  name: string,
  args: Record<string, unknown> = {},
  as: "me" | "taker" = "me",
): Promise<any> {
  return JSON.parse(await raw(name, args, as));
}

beforeEach(async () => {
  await resetDatabase();
});

describe("get_workspace_context — คีย์ที่บอกความครบต้องมาก่อนทุก array", () => {
  /**
   * **กรณีที่ตัดสินข้อนี้** — วัดตำแหน่งไบต์ ไม่ใช่วัดว่าคีย์มีอยู่
   *
   * คีย์ที่ "มีอยู่" แต่อยู่หลังจุดที่ถูกตัด เท่ากับไม่มี · เทสต์ที่ `JSON.parse`
   * ก่อนแล้วค่อยตรวจจะผ่านทั้งที่ผู้อ่านตัวจริงไม่เคยได้เห็น เพราะ `parse`
   * ไม่สนลำดับ และเพราะในเทสต์ก้อนเล็กพอที่จะไม่ถูกตัด
   */
  it("has_more · total_discussions · quiet_discussions อยู่หน้า discussions", async () => {
    await call("create_discussion", { workspace: WS, title: "กระทู้", body: "เนื้อ" });

    const text = await raw("get_workspace_context", { workspace: WS, limit: 5 });

    for (const head of ['"has_more"', '"total_discussions"', '"quiet_discussions"']) {
      expect(text.indexOf(head), `${head} ต้องอยู่ก่อน array`).toBeLessThan(
        text.indexOf('"discussions"'),
      );
    }
  });

  /**
   * `participants` กับ `open_items` ก็เป็นก้อนที่โตได้ไม่จำกัด — `open_items.health`
   * ของ ws-001 จริงยาวกว่า discussions ทั้ง array · คีย์บอกความครบต้องอยู่หน้า
   * **ทุกก้อนที่โตได้** ไม่ใช่หน้าก้อนที่เราเดาว่าโต
   */
  it("และอยู่หน้า participants กับ open_items ด้วย", async () => {
    await call("create_task", { workspace: WS, title: "ใบ" });

    const text = await raw("get_workspace_context", { workspace: WS, limit: 5 });
    const headEnd = text.indexOf('"quiet_discussions"');

    expect(headEnd).toBeLessThan(text.indexOf('"participants"'));
    expect(headEnd).toBeLessThan(text.indexOf('"open_items"'));
  });

  /**
   * 20KB แรกต้องอ่านเป็นข้อความได้ว่าครบหรือยัง **แม้ JSON จะ parse ไม่ผ่าน**
   */
  it("หัวก้อนอยู่ในสองร้อยไบต์แรก", async () => {
    await call("create_task", { workspace: WS, title: "ใบ" });

    const text = await raw("get_workspace_context", { workspace: WS, limit: 5 });

    expect(text.indexOf('"total_discussions"')).toBeLessThan(200);
  });

  it("บอกว่ายังมีต่อ พร้อมวิธีอ่านให้ครบ", async () => {
    for (let i = 0; i < 3; i += 1) {
      await call("create_discussion", { workspace: WS, title: `กระทู้ ${i}`, body: "เนื้อ" });
    }

    const page = await call("get_workspace_context", { workspace: WS, limit: 1 });

    expect(page.has_more).toBe(true);
    expect(page.total_discussions).toBe(3);
    expect(page.warning).toMatch(/limit/);
  });

  it("อ่านครบแล้วไม่มีคำเตือน — คำเตือนที่ขึ้นทุกครั้งคือคำเตือนที่ถูกมองข้าม", async () => {
    await call("create_discussion", { workspace: WS, title: "กระทู้", body: "เนื้อ" });

    const page = await call("get_workspace_context", { workspace: WS, limit: 50 });

    expect(page.has_more).toBe(false);
    expect(page).not.toHaveProperty("warning");
  });
});

describe("warning ในรายการ — ช่องเดียวที่ไปถึง schema ที่ค้างอยู่", () => {
  /**
   * 12 ต.ค. 2026 Grok รายงานว่า connector ของเขายังเห็น inputSchema ของ
   * `get_tasks` · `get_handoffs` · `get_decisions` **ไม่มี `cursor`** ทั้งที่เซิร์ฟเวอร์
   * รับอยู่แล้ว · `contract` ยังเป็น `2` ตาม ADR-0028 จึงไม่มีสัญญาณให้ reconnect
   *
   * AI ที่ทำตามกติกาว่า "ใช้เฉพาะ filter ที่มีใน schema" จะไม่ใช้ cursor ทั้งที่มีแล้ว
   */
  it.each([
    ["get_tasks", "tasks"],
    ["get_decisions", "decisions"],
  ])("%s บอกวิธีอ่านหน้าถัดไปในผลลัพธ์เอง", async (tool) => {
    for (let i = 0; i < 3; i += 1) {
      await call("create_task", { workspace: WS, title: `ใบ ${i}` });
      await call("record_decision", {
        workspace: WS,
        title: `ใบตัดสิน ${i}`,
        detail: "เหตุผล",
      });
    }

    const page = await call(tool, { workspace: WS, limit: 1 });

    expect(page.has_more).toBe(true);
    expect(page.warning).toMatch(/next_cursor/);
  });

  it("คำเตือนอยู่หน้า array ด้วย — ไม่ใช่ท้ายก้อนที่ถูกตัดทิ้ง", async () => {
    for (let i = 0; i < 3; i += 1) {
      await call("create_task", { workspace: WS, title: `ใบ ${i}` });
    }

    const text = await raw("get_tasks", { workspace: WS, limit: 1 });

    expect(text.indexOf('"warning"')).toBeLessThan(text.indexOf('"tasks"'));
  });

  it("หมดแล้วไม่เตือน", async () => {
    await call("create_task", { workspace: WS, title: "ใบเดียว" });

    const page = await call("get_tasks", { workspace: WS, limit: 50 });

    expect(page.has_more).toBe(false);
    expect(page).not.toHaveProperty("warning");
  });
});

describe("ตัวกรอง capability — ต้องถูกทั้งสองทาง", () => {
  async function handoffWith(capability?: string): Promise<string> {
    const task = (await call("create_task", { workspace: WS, title: "ใบ" })).task_id as string;
    const r = await call("create_handoff", {
      task_id: task,
      to: TAKER,
      context: "ส่งต่อ",
      ...(capability === undefined ? {} : { capability }),
    });
    return r.handoff_id as string;
  }

  async function idsWith(capability: string): Promise<string[]> {
    const page = await call("get_handoffs", { workspace: WS, capability, limit: 50 });
    return (page.handoffs as Array<{ id: string }>).map((h) => h.id);
  }

  /**
   * **สองข้อที่ไมเกรชัน 0007 ใช้เป็นเหตุผลว่าทำตัวกรองไม่ได้** — ต้องถูกทั้งคู่
   * ในเทสต์เดียว ถ้าแยกกัน การแก้ให้ข้อหนึ่งถูกโดยทำอีกข้อพังจะยังเขียว
   */
  it("ถาม b เจอใบที่ประกาศ a,b และไม่เจอใบที่ประกาศ bc", async () => {
    const list = await handoffWith("a,b");
    const prefix = await handoffWith("bc");

    const found = await idsWith("b");

    expect(found).toContain(list);
    expect(found).not.toContain(prefix);
  });

  it("ถามตัวที่อยู่หัวรายการ และตัวที่อยู่กลางรายการ ก็เจอ", async () => {
    const h = await handoffWith("deploy,ssh,db");

    expect(await idsWith("deploy")).toContain(h);
    expect(await idsWith("ssh")).toContain(h);
    expect(await idsWith("db")).toContain(h);
  });

  it("ช่องว่างรอบตัวคั่นถูกตัดตอนเขียน ไม่ใช่ตอนอ่าน", async () => {
    const r = await call("create_handoff", {
      task_id: (await call("create_task", { workspace: WS, title: "ใบ" })).task_id,
      to: TAKER,
      context: "ส่งต่อ",
      capability: " deploy ,  ssh ",
    });

    expect(r.capability).toBe("deploy,ssh");
    expect(await idsWith("ssh")).toContain(r.handoff_id);
  });

  /**
   * `NULL` แปลว่า **ไม่ได้ประกาศ** ไม่ใช่ว่าไม่ต้องใช้อะไร — ใบที่ไม่ได้ประกาศจึง
   * ไม่ตรงกับคำค้นใด ๆ เพราะเราไม่รู้ว่ามันต้องใช้อะไร การเหมาว่าตรงคือการเดาแทนผู้ส่ง
   */
  it("ใบที่ไม่ได้ประกาศ ไม่ติดตัวกรอง", async () => {
    const silent = await handoffWith();
    const declared = await handoffWith("deploy");

    const found = await idsWith("deploy");

    expect(found).toContain(declared);
    expect(found).not.toContain(silent);
  });

  /**
   * ไวลด์การ์ดคือรูปใหม่ของ "ตัวกรองที่ถูกครึ่งเดียว" — ผู้เรียกได้ทุกใบ
   * แล้วเชื่อว่ากรองแล้ว · ใช้ `instr` จึงไม่มีไวลด์การ์ดให้ตีความตั้งแต่ต้น
   */
  it.each(["%", "_", "%deploy%"])("คำค้น '%s' ไม่ถูกตีความเป็นไวลด์การ์ด", async (ask) => {
    await handoffWith("deploy");

    expect(await idsWith(ask)).toHaveLength(0);
  });

  it("ถามหลายอย่างในครั้งเดียวได้ error ไม่ใช่ผลที่แปลว่าอย่างอื่น", async () => {
    await handoffWith("deploy,ssh");

    await expect(
      call("get_handoffs", { workspace: WS, capability: "deploy,ssh", limit: 50 }),
    ).rejects.toThrow(/capability/);
  });

  it("total สะท้อนตัวกรอง ไม่ใช่ยอดทั้งโต๊ะ", async () => {
    await handoffWith("deploy");
    await handoffWith("ssh");
    await handoffWith();

    const page = await call("get_handoffs", { workspace: WS, capability: "deploy", limit: 50 });

    expect(page.total).toBe(1);
    expect(page.handoffs).toHaveLength(1);
  });
});

describe("total_actionable — เลขที่ชื่อชนกันต้องยืนข้างกัน", () => {
  /**
   * ## แผลจริง
   *
   * 12 ต.ค. 2026 `it-operations-hub` ชี้ว่าเลขสองตัวชื่อเหมือนกันแต่ต่างกันแปดเท่า
   *
   * ```
   * get_workspace_context  open_items.handoffs_pending     5
   * get_handoffs           status "pending" → total       42
   * ```
   *
   * ถูกทั้งคู่ตามนิยามของตัวเอง — ตัวหลังนับแถวที่คอลัมน์ `status` ยังเป็น `pending`
   * รวมใบที่ `obsolete` และ `superseded` ซึ่งไม่มีใครต้องรับ · **แต่ชื่อมันชนกัน**
   * และมีคนกำลังเขียน stale-work sweep ทับมันพอดี ซึ่งจะรายงานว่ามีงานค้าง 42 รายการ
   */
  it("ใบที่งานปิดไปแล้ว ยังนับใน total แต่ไม่นับใน total_actionable", async () => {
    const task = (await call("create_task", { workspace: WS, title: "ใบ" })).task_id as string;
    await call("create_handoff", { task_id: task, to: TAKER, context: "ส่งต่อ" });
    await call("update_task", { task_id: task, status: "done", result_ref: "dis-x#1" });

    const page = await call("get_handoffs", { workspace: WS, limit: 50 });

    expect(page.total).toBe(1);
    expect(page.total_actionable).toBe(0);
  });

  it("ใบที่ถูกแทนด้วยใบใหม่กว่า ก็ไม่นับว่าต้องมีคนรับ", async () => {
    const task = (await call("create_task", { workspace: WS, title: "ใบ" })).task_id as string;
    await call("create_handoff", { task_id: task, to: TAKER, context: "ใบแรก" });
    await call("create_handoff", { task_id: task, to: TAKER, context: "ใบที่สอง" });

    const page = await call("get_handoffs", { workspace: WS, limit: 50 });

    expect(page.total).toBe(2);
    expect(page.total_actionable).toBe(1);
  });

  /**
   * **กรณีบวก** — ถ้า `total_actionable` ต่ำกว่า `total` ทุกครั้ง มันก็ไม่ได้บอกอะไร
   */
  it("ใบที่ยังรออยู่จริง นับครบทั้งสองตัว", async () => {
    for (let i = 0; i < 2; i += 1) {
      const task = (await call("create_task", { workspace: WS, title: `ใบ ${i}` })).task_id;
      await call("create_handoff", { task_id: task, to: TAKER, context: "ส่งต่อ" });
    }

    const page = await call("get_handoffs", { workspace: WS, limit: 50 });

    expect(page.total).toBe(2);
    expect(page.total_actionable).toBe(2);
  });

  it("นับจากฐานด้วยตัวกรองชุดเดียวกัน ไม่ใช่นับจากแถวที่หน้านี้อ่านมาได้", async () => {
    for (let i = 0; i < 3; i += 1) {
      const task = (await call("create_task", { workspace: WS, title: `ใบ ${i}` })).task_id;
      await call("create_handoff", { task_id: task, to: TAKER, context: "ส่งต่อ" });
    }

    const page = await call("get_handoffs", { workspace: WS, limit: 1 });

    expect(page.handoffs).toHaveLength(1);
    expect(page.total_actionable).toBe(3);
  });

  it("อยู่หน้า array เหมือนคีย์อื่นในหัว", async () => {
    const task = (await call("create_task", { workspace: WS, title: "ใบ" })).task_id as string;
    await call("create_handoff", { task_id: task, to: TAKER, context: "ส่งต่อ" });

    const text = await raw("get_handoffs", { workspace: WS, limit: 50 });

    expect(text.indexOf('"total_actionable"')).toBeLessThan(text.indexOf('"handoffs"'));
  });
});

describe("โหมดย่อ — ตัดช่องที่ยาว และประกาศว่าตัดอะไรไป", () => {
  /**
   * ## ตัวเลขที่ทำให้โหมดนี้เกิด
   *
   * รอบก่อนเราปฏิเสธโหมดนี้โดยขอให้วัดมาก่อนว่าช้าตรงไหนด้วยตัวเลข ·
   * 12 ต.ค. 2026 Grok อ่าน ws-001 ครบด้วย cursor แล้วรายงาน **537 แถว =
   * 71 round-trip** โดย 11 ครั้งเสียไปกับการอ่านหน้าที่ถูกตัดซ้ำ เพราะแถวเต็มหนัก
   * 1–5KB ทำให้แต่ละหน้าได้แค่ 2–18 แถวแม้ตั้ง `limit` สูงกว่านั้น
   */
  const LONG = "ย".repeat(4000);

  it.each([
    ["get_tasks", "tasks", "detail"],
    ["get_decisions", "decisions", "detail"],
    ["get_handoffs", "handoffs", "context"],
    ["get_plans", "plans", "body"],
  ])("%s ตัด %s ออกช่องเดียว", async (tool, key, omitted) => {
    const task = (await call("create_task", { workspace: WS, title: "ใบ", detail: LONG }))
      .task_id as string;
    await call("create_handoff", { task_id: task, to: TAKER, context: LONG });
    await call("record_decision", { workspace: WS, title: "ใบตัดสิน", detail: LONG });
    await call("record_plan", { workspace: WS, title: "แผน", body: LONG });

    const page = await call(tool, { workspace: WS, limit: 50, summary: true });
    const row = (page[key] as Array<Record<string, unknown>>)[0];

    expect(page.row_fields).toBe("summary");
    expect(page.omitted_fields).toEqual([omitted]);
    expect(row).not.toHaveProperty(omitted);
  });

  /**
   * ของที่เหลือต้องอยู่ครบ — โหมดย่อนิยามว่า *ตัดช่องที่ยาว* ไม่ใช่
   * *เก็บชุดคอลัมน์ที่เลือกไว้* เพราะถ้าเป็นอย่างหลัง คอลัมน์ที่ไมเกรชันหน้าเพิ่ม
   * เข้ามาจะหายจากโหมดย่อเงียบ ๆ โดยไม่มีใครตัดสินใจให้หาย
   */
  it("ช่องอื่นอยู่ครบ รวมช่องที่เพิ่มมาทีหลัง", async () => {
    const task = (await call("create_task", { workspace: WS, title: "ใบ", detail: LONG }))
      .task_id as string;
    await call("create_handoff", {
      task_id: task,
      to: TAKER,
      context: LONG,
      capability: "deploy",
    });

    const page = await call("get_handoffs", { workspace: WS, limit: 50, summary: true });
    const row = page.handoffs[0] as Record<string, unknown>;

    // `capability` มาจากไมเกรชัน 0007 · `acting_context` มาจาก 0006
    for (const key of [
      "id",
      "task_id",
      "to_whom",
      "from_name",
      "status",
      "state",
      "created_at",
      "capability",
      "acting_context",
    ]) {
      expect(row, `โหมดย่อต้องเก็บ ${key}`).toHaveProperty(key);
    }
  });

  /**
   * **`absent` ไม่เท่ากับ `empty`** · ถ้าโหมดย่อตัดช่องไปเฉย ๆ ผู้อ่านจะแยก
   * *ใบนี้ไม่มีบริบท* ออกจาก *รอบนี้ไม่ได้ขอบริบทมา* ไม่ได้
   */
  it("โหมดเต็มก็บอกว่าตัวเองเต็ม — ไม่ใช่เงียบแล้วให้เดา", async () => {
    await call("create_task", { workspace: WS, title: "ใบ", detail: LONG });

    const page = await call("get_tasks", { workspace: WS, limit: 50 });

    expect(page.row_fields).toBe("full");
    expect(page.omitted_fields).toEqual([]);
    expect(page.tasks[0]).toHaveProperty("detail");
  });

  it("row_fields กับ omitted_fields อยู่หน้า array", async () => {
    await call("create_task", { workspace: WS, title: "ใบ", detail: LONG });

    const text = await raw("get_tasks", { workspace: WS, limit: 50, summary: true });

    for (const head of ['"row_fields"', '"omitted_fields"']) {
      expect(text.indexOf(head)).toBeLessThan(text.indexOf('"tasks"'));
    }
  });

  /**
   * ข้อที่เป็นเหตุผลทั้งหมดของโหมดนี้ — **ก้อนต้องเล็กลงจริง**
   *
   * ถ้าวัดแค่ว่าคีย์หายไป มิวแทนต์ที่ลบคีย์แล้วยังส่งเนื้อเดิมไปในที่อื่นจะยังเขียว
   */
  it("ก้อนที่ได้เล็กกว่าโหมดเต็มหลายเท่า", async () => {
    for (let i = 0; i < 5; i += 1) {
      await call("create_task", { workspace: WS, title: `ใบ ${i}`, detail: LONG });
    }

    const full = await raw("get_tasks", { workspace: WS, limit: 50 });
    const brief = await raw("get_tasks", { workspace: WS, limit: 50, summary: true });

    expect(brief.length * 5).toBeLessThan(full.length);
  });

  it("เลื่อนหน้าด้วย cursor ในโหมดย่อได้ และ total ไม่เปลี่ยนตามโหมด", async () => {
    for (let i = 0; i < 3; i += 1) {
      await call("create_task", { workspace: WS, title: `ใบ ${i}`, detail: LONG });
    }

    const first = await call("get_tasks", { workspace: WS, limit: 2, summary: true });
    const second = await call("get_tasks", {
      workspace: WS,
      limit: 2,
      summary: true,
      cursor: first.next_cursor,
    });

    expect(first.total).toBe(3);
    expect(second.total).toBe(3);
    expect(second.tasks).toHaveLength(1);
    expect(second.row_fields).toBe("summary");
  });
});
