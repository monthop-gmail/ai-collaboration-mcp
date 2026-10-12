/**
 * เลื่อนหน้าด้วย cursor — และ **หัวของผลลัพธ์ต้องมาก่อน array**
 *
 * ## แผลจริง
 *
 * 12 ต.ค. 2026 Grok รายงานว่าผลอ่านจากบอร์ดถูก gateway ของ connectors ตัดที่ ~20KB
 * และ `get_tasks` / `get_handoffs` / `get_decisions` ไม่มี cursor ผู้อ่านจึงเห็นแค่
 * แถวใหม่สุด **โดยไม่รู้ตัว** (`dis-fa078bf8` seq 90–91)
 *
 * วัดของจริงแล้วหนักกว่านั้น — `get_decisions` ของ `ws-001` คืน **222,806 ไบต์**
 * และ `has_more` อยู่ที่ไบต์ **154,135** จึง **ไม่เคยไปถึงผู้อ่านในกรณีเดียวที่
 * ผู้อ่านต้องการมัน** · ผู้อ่านได้ข้อมูล 9% แล้วเข้าใจว่าครบ
 *
 * **เราสร้าง `has_more` ไว้แล้ว แต่วางไว้ตรงที่มันถูกตัดทิ้งเสมอ**
 *
 * ## กรณีที่ตัดสินไฟล์นี้
 *
 * แถวที่ถูกสร้างในคำขอเดียวกันได้ `created_at` **เท่ากัน** เพราะเวลาใน Workers
 * ไม่ขยับระหว่างโค้ดที่รันติดกัน · cursor ที่เทียบแค่เวลาจะข้ามหรือซ้ำแถวที่เวลาเท่ากัน
 * โดยไม่มีอะไรฟ้อง · ไฟล์นี้จึงหยอดแถวที่เวลาเท่ากันลงฐานตรง ๆ แล้วเดินผ่าน
 * `worker.fetch` ทีละหนึ่งแถว
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";

const TOKEN = "page-token-aaaaaaaaaaaaaaaaaaaaaaa";
const TEAM = "owner/pager";
const WS = "ws-001";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: TOKEN,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

let id = 0;

/** คืนข้อความดิบด้วย เพราะ **ลำดับคีย์** คือสิ่งที่ไฟล์นี้ต้องวัด */
async function raw(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${TOKEN}`,
        "x-client-name": TEAM,
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

async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return JSON.parse(await raw(name, args));
}

/**
 * หยอดงานที่ `created_at` **เท่ากันทุกใบ** — จำลองแถวที่เกิดในคำขอเดียวกัน
 *
 * ต้องหยอดตรงเพราะเรียกผ่าน tool จะได้เวลาต่างกันทีละคำขอ แล้วเคสที่พังจะไม่ถูกทดสอบ
 */
async function seedSameInstant(n: number): Promise<string[]> {
  const at = "2026-10-12T00:00:00.000Z";
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const taskId = `task-same-${i}`;
    ids.push(taskId);
    await (env as unknown as { DB: D1Database }).DB.prepare(
      `INSERT INTO tasks (id, workspace_id, title, detail, status, created_by,
                          created_by_client, created_at)
       VALUES (?1, ?2, ?3, '', 'open', ?4, 'static-header:seed', ?5)`,
    )
      .bind(taskId, WS, `ใบที่ ${i}`, TEAM, at)
      .run();
  }
  return ids;
}

/** เดินทุกหน้าด้วย cursor แล้วคืนรหัสที่เห็นตามลำดับ */
async function walk(tool: string, key: string, limit: number): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await call(tool, { workspace: WS, limit, ...(cursor ? { cursor } : {}) });
    for (const row of page[key] as Array<{ id: string }>) seen.push(row.id);
    if (!page.has_more) return seen;
    expect(page.next_cursor).toBeTruthy();
    cursor = page.next_cursor as string;
  }
  throw new Error("เดินเกิน 50 หน้า — น่าจะวนอยู่กับที่");
}

beforeEach(async () => {
  await resetDatabase();
});

describe("หัวของผลลัพธ์ต้องมาก่อน array — ไม่งั้นมันถูกตัดทิ้งพร้อมกับของที่มันอธิบาย", () => {
  it.each(["get_tasks", "get_handoffs", "get_decisions", "get_plans"])(
    "%s วาง total / has_more / next_cursor ไว้ก่อนรายการ",
    async (tool) => {
      await seedSameInstant(3);
      const text = await raw(tool, { workspace: WS, limit: 2 });

      const arrayKey = text.indexOf(`"${tool.replace("get_", "")}"`);
      expect(arrayKey).toBeGreaterThan(0);
      for (const head of ['"total"', '"has_more"', '"next_cursor"']) {
        expect(text.indexOf(head)).toBeGreaterThan(-1);
        // **ข้อที่ตัดสิน** — ถ้าหัวอยู่หลัง array มันจะหายไปตอนถูกตัดที่ 20KB
        expect(text.indexOf(head)).toBeLessThan(arrayKey);
      }
    },
  );

  it("contract ติดมาด้วย เหมือน tool อื่น", async () => {
    const page = await call("get_decisions", { workspace: WS, limit: 1 });
    expect(page.contract).toBe(2);
  });
});

describe("cursor เดินผ่านทุกแถวพอดีครั้งเดียว", () => {
  /**
   * **กรณีที่ตัดสิน** — ห้าแถวที่ `created_at` เท่ากันทุกใบ
   *
   * cursor ที่เทียบแค่เวลาจะวนอยู่กับที่ หรือข้ามทั้งกลุ่มไปเลย
   */
  it("แถวที่เวลาเท่ากันทุกใบ ยังเดินได้ครบ ไม่ซ้ำ ไม่ขาด", async () => {
    const ids = await seedSameInstant(5);

    const seen = await walk("get_tasks", "tasks", 1);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen.slice().sort()).toEqual(ids.slice().sort());
  });

  it("limit ที่พอดีกับจำนวนแถว บอกว่าหมดแล้ว และ next_cursor เป็น null", async () => {
    await seedSameInstant(3);

    const page = await call("get_tasks", { workspace: WS, limit: 3 });

    expect(page.tasks).toHaveLength(3);
    expect(page.has_more).toBe(false);
    // คืนคีย์เสมอ — ผู้อ่านต้องแยก *หมดแล้ว* ออกจาก *ไม่รองรับการเลื่อนหน้า*
    expect(page.next_cursor).toBeNull();
  });

  it("total เป็นยอดทั้งหมดของตัวกรอง ไม่ใช่ยอดที่เหลือจาก cursor", async () => {
    await seedSameInstant(5);

    const first = await call("get_tasks", { workspace: WS, limit: 2 });
    const second = await call("get_tasks", {
      workspace: WS,
      limit: 2,
      cursor: first.next_cursor,
    });

    expect(first.total).toBe(5);
    // ถ้า total ถูกนับหลังหัก cursor ค่านี้จะกลายเป็น 3 แล้วความหมายของคีย์เดิมเปลี่ยน
    expect(second.total).toBe(5);
  });

  it("ตัวกรองยังถูกใช้ตอนเลื่อนหน้า ไม่ใช่หลุดกลับไปทั้ง workspace", async () => {
    await seedSameInstant(4);
    const all = await call("get_tasks", { workspace: WS, limit: 50 });
    const target = (all.tasks as Array<{ id: string }>)[0].id;
    await call("update_task", { task_id: target, status: "done", result_ref: "x#1" });

    const seen = await walk("get_tasks", "tasks", 1);
    const open = await call("get_tasks", { workspace: WS, status: "open", limit: 50 });

    expect(seen).toHaveLength(4);
    expect(open.total).toBe(3);
    expect(open.tasks.map((t: { id: string }) => t.id)).not.toContain(target);
  });

  it("cursor ของเครื่องมือหนึ่ง ใช้กับอีกเครื่องมือได้โดยไม่ระเบิด", async () => {
    await seedSameInstant(3);
    const tasks = await call("get_tasks", { workspace: WS, limit: 1 });

    const decisions = await call("get_decisions", {
      workspace: WS,
      limit: 1,
      cursor: tasks.next_cursor,
    });

    // ไม่มี decision ในโต๊ะเปล่า — ที่ต้องพิสูจน์คือมันไม่ throw และไม่โกหกว่ามีต่อ
    expect(decisions.has_more).toBe(false);
    expect(decisions.next_cursor).toBeNull();
  });
});

describe("cursor ที่พังต้องดัง ไม่ใช่เริ่มจากหน้าแรกเงียบ ๆ", () => {
  /**
   * ## รอบแรกไฟล์นี้ทดสอบรูปเดียว แล้วสรุปเป็นคุณสมบัติของทั้งคลาส
   *
   * 12 ต.ค. 2026 `it-operations-hub` โพสต์ว่าเขาทำผิดข้อเดียวกันในกระทู้เดียวกับที่
   * เขียนกฎนั้นเอง — **ทุกทางที่ `fail` ได้ ต้องมีกรณีพิสูจน์ว่ามันยิงจริง** ·
   * ชุดนี้จึงไล่ตาม *คลาสของ cursor ที่พัง* ไม่ใช่ตามตัวอย่างที่คิดออก
   *
   * รูป `เวลาถูกตัดกลาง` เป็นรูปที่ร้ายที่สุดและเป็นรูปที่หลุดด่านไปจริง — ดู
   * `CURSOR_VERSION` ใน `db-work.ts` · อาการคือ**ข้ามแถว** ไม่ใช่เริ่มหน้าแรกใหม่
   */
  it.each([
    ["ไม่มีตัวคั่น", "ไม่ใช่ cursor"],
    ["ว่างทั้งสองส่วน", "|"],
    ["ส่วนหน้าไม่ใช่เวลา", "zzz|1"],
    ["เวลาถูกตัดกลาง", "2026-10-10T14:5|83"],
    ["เวลาไม่มีมิลลิวินาที", "2026-10-10T14:55:26Z|83"],
    ["เวลาว่าง", "|5"],
    ["rowid ว่าง", "2026-10-12T00:00:00.000Z|"],
    ["rowid ไม่ใช่เลข", "2026-10-12T00:00:00.000Z|ไม่ใช่เลข"],
    ["rowid เป็นศูนย์", "2026-10-12T00:00:00.000Z|0"],
    ["rowid ติดลบ", "2026-10-12T00:00:00.000Z|-1"],
    ["rowid มีช่องว่างนำ", "2026-10-12T00:00:00.000Z| 5"],
    ["ค่าทึบที่ถูกตัดครึ่ง", "eyJ2IjoxLCJhdCI6IjIwMjYtMTAt"],
    ["ค่าทึบเวอร์ชันอื่น", "eyJ2Ijo5LCJhdCI6IjIwMjYtMTAtMTJUMDA6MDA6MDAuMDAwWiIsImlkIjoxfQ"],
  ])("cursor ที่ %s ได้ error", async (_label, bad) => {
    await seedSameInstant(2);
    await expect(call("get_tasks", { workspace: WS, limit: 1, cursor: bad })).rejects.toThrow(
      /cursor/,
    );
  });

  /**
   * **กรณีบวกของชุดนี้** — มิวแทนต์พิสูจน์ได้แค่ว่าตัวตรวจพูดว่า "ไม่ผ่าน" เป็น
   * ไม่ได้พิสูจน์ว่ามันพูดว่า "ผ่าน" เป็น · เคยเขียนตัวตรวจที่ผ่านมิวแทนต์ทุกตัว
   * ทั้งที่มันรายงานไม่ผ่านกับทุกอย่าง
   */
  it("cursor ที่เซิร์ฟเวอร์ออกให้ ยังใช้ได้", async () => {
    await seedSameInstant(3);
    const first = await call("get_tasks", { workspace: WS, limit: 1 });

    const second = await call("get_tasks", {
      workspace: WS,
      limit: 1,
      cursor: first.next_cursor,
    });

    expect(second.tasks).toHaveLength(1);
    expect(second.tasks[0].id).not.toBe(first.tasks[0].id);
  });

  /**
   * ของที่ออกจากเซิร์ฟเวอร์ต้องไม่มีเวลาอ่านออกด้วยตา — ไม่ใช่เรื่องความลับ
   * แต่เพราะรูปที่อ่านออกคือรูปที่มีคนประกอบเอง แล้วประกอบพลาดแบบที่ตรวจไม่ได้
   */
  it("next_cursor ทึบ — ไม่มี timestamp ให้คัดลอกบางส่วน", async () => {
    await seedSameInstant(3);

    const page = await call("get_tasks", { workspace: WS, limit: 1 });

    expect(page.next_cursor).not.toContain("|");
    expect(page.next_cursor).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(page.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  /**
   * ข้อที่ทำให้ของเดิมอันตราย — cursor ที่พังไม่ได้พาไปหน้าแรก มันข้ามแถว
   *
   * ล็อกไว้ว่าเมื่อส่ง cursor พังเข้ามา **ไม่มีทางที่ผู้เรียกจะได้รายการที่ขาดแถว
   * กลับไปโดยไม่รู้ตัว** เพราะไม่มีผลลัพธ์ให้เลย มีแต่ error
   */
  it("เวลาที่ถูกตัดกลางไม่ทำให้แถวในวินาทีนั้นหลุดหายไปเงียบ ๆ", async () => {
    await seedSameInstant(3);
    const all = await call("get_tasks", { workspace: WS, limit: 50 });
    const stamp = all.tasks[0].created_at as string;

    await expect(
      call("get_tasks", { workspace: WS, limit: 50, cursor: `${stamp.slice(0, 15)}|999999` }),
    ).rejects.toThrow(/cursor/);

    // และตัวเลขเดิมไม่ถูกแตะ — ด่านอยู่ก่อนการอ่าน ไม่ใช่หลังจากอ่านมาแล้วบางส่วน
    expect(all.total).toBe(3);
  });
});

describe("capability บน handoff — คำประกาศของผู้ส่ง ไม่ใช่ของที่ตรวจแล้ว", () => {
  async function handoffWith(capability?: string): Promise<any> {
    const task = (await call("create_task", { workspace: WS, title: "ใบ" })).task_id as string;
    return call("create_handoff", {
      task_id: task,
      to: "owner/taker",
      context: "ส่งต่อ",
      ...(capability === undefined ? {} : { capability }),
    });
  }

  it("เก็บและคืนค่าที่ผู้ส่งประกาศ", async () => {
    const r = await handoffWith("deploy,ssh");
    expect(r.capability).toBe("deploy,ssh");

    const list = await call("get_handoffs", { workspace: WS, limit: 10 });
    expect(list.handoffs[0].capability).toBe("deploy,ssh");
  });

  it("ไม่ประกาศ ได้ null และคีย์ยังอยู่ — ไม่ใช่คีย์หายไป", async () => {
    const r = await handoffWith();
    expect(r.capability).toBeNull();
    expect("capability" in r).toBe(true);

    const list = await call("get_handoffs", { workspace: WS, limit: 10 });
    expect(list.handoffs[0].capability).toBeNull();
    expect("capability" in list.handoffs[0]).toBe(true);
  });

  it("ช่องว่างล้วนถือว่าไม่ได้ประกาศ ไม่ใช่ค่าว่าง", async () => {
    const r = await handoffWith("   ");
    expect(r.capability).toBeNull();
  });

  it("ใบเก่าที่ไม่มีช่องนี้ตอนสร้าง อ่านได้เป็น null ไม่ใช่ error", async () => {
    const task = (await call("create_task", { workspace: WS, title: "ใบเก่า" })).task_id as string;
    await (env as unknown as { DB: D1Database }).DB.prepare(
      `INSERT INTO handoffs (id, task_id, to_whom, context, status, from_name,
                             from_client, created_at)
       VALUES ('ho-legacy', ?1, 'owner/taker', 'ก่อนไมเกรชัน', 'pending', ?2,
               'static-header:seed', '2026-09-01T00:00:00.000Z')`,
    )
      .bind(task, TEAM)
      .run();

    const list = await call("get_handoffs", { workspace: WS, limit: 10 });
    const legacy = (list.handoffs as Array<{ id: string; capability: string | null }>).find(
      (h) => h.id === "ho-legacy",
    )!;

    expect(legacy.capability).toBeNull();
  });
});
