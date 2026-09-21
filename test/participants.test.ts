/**
 * Phase 1 ข้อ P1.1 — `get_participants`
 *
 * ของที่ต้องพิสูจน์ไม่ใช่ว่า tool คืนค่าได้ แต่คือ **มันปิดช่องว่างที่ `participants`
 * เดิมมีอยู่จริง** — ทีมที่ทำงานแต่ไม่เคยโพสต์ จะไม่มีชื่อในรายการเดิมเลย
 *
 * ถ้าเทสต์ไม่ได้เทียบสองรายการนี้ในรอบเดียวกัน มันจะพิสูจน์ได้แค่ว่ามีของใหม่โผล่มา
 * ไม่ได้พิสูจน์ว่าของใหม่แก้ปัญหาที่มันถูกสร้างมาเพื่อแก้
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";
import {
  CLIENT_PREFIX,
  MECHANISMS,
  STATIC_BEARER_CLIENT,
  mechanismOfClient,
} from "../src/identity";

const TOKEN = "parts-token-aaaaaaaaaaaaaaaaaaaaaaaa";
/** โทเคนใบที่สองที่ผูกชื่อไว้ — ทำให้ชื่อเดียวมาจากสองกุญแจ เหมือนเคส ChatGPT ของจริง */
const BOUND = "parts-bound-bbbbbbbbbbbbbbbbbbbbbbbb";
/** กุญแจของเส้น `/mcp-readonly` ซึ่งเป็นคนละใบกับเส้นปกติโดยตั้งใจ */
const RO = "parts-ro-cccccccccccccccccccccccccc";
const TEAM_A = "owner/team-a";
const TEAM_B = "owner/team-b";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: TOKEN,
  MCP_AUTH_TOKENS: `${BOUND}=${TEAM_B}`,
  MCP_READONLY_TOKENS: `${RO}=owner/readonly`,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

let id = 0;

async function callTool(
  as: string | { token: string } | null,
  name: string,
  args: Record<string, unknown> = {},
  path = "/mcp",
): Promise<Record<string, unknown>> {
  const bound = as !== null && typeof as === "object";
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://example.test${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${bound ? as.token : TOKEN}`,
        ...(bound || as === null ? {} : { "x-client-name": as }),
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
  const payload = frame.result?.content?.[0]?.text;
  if (frame.result?.isError) throw new Error(payload ?? "tool error");
  return JSON.parse(payload ?? "{}") as Record<string, unknown>;
}

interface Observation {
  name: string;
  spellings: string[];
  clients: Array<{ client: string; mechanism: string; last_seen: string }>;
  spoke: { messages: number; last_seen: string } | null;
  acted: { events: number; last_seen: string; kinds: Record<string, number> } | null;
}

async function report(): Promise<{ participants: Observation[]; limitations: string[] }> {
  return (await callTool(TEAM_A, "get_participants")) as unknown as {
    participants: Observation[];
    limitations: string[];
  };
}

const find = (list: Observation[], name: string) => list.find((p) => p.name === name);

beforeEach(async () => {
  await resetDatabase();
});

/**
 * เคสที่เป็นเหตุผลทั้งหมดของ P1.1 — วัดจากทั้งสองรายการในรอบเดียวกัน
 */
describe("ช่องว่างที่ participants เดิมมี", () => {
  it("ทีมที่ทำงานแต่ไม่เคยโพสต์ หายไปจากรายการเดิม แต่อยู่ในรายการใหม่", async () => {
    const task = await callTool(TEAM_B, "create_task", { title: "งานที่ทำโดยไม่พูด" });
    await callTool(TEAM_B, "update_task", {
      task_id: task.task_id as string,
      status: "in_progress",
    });

    const context = await callTool(TEAM_A, "get_workspace_context", { limit: 1 });
    expect(context.participants).not.toContain(TEAM_B);

    const team = find((await report()).participants, TEAM_B);
    expect(team?.spoke).toBeNull();
    expect(team?.acted?.events).toBe(2);
    expect(team?.acted?.kinds).toMatchObject({ tasks_created: 1, tasks_updated: 1 });
  });

  it("แยกคนที่พูดอย่างเดียว ออกจากคนที่ลงมืออย่างเดียว", async () => {
    const discussion = await callTool(TEAM_A, "create_discussion", {
      title: "กระทู้",
      body: "เปิดกระทู้",
    });
    await callTool(TEAM_B, "post_message", {
      discussion_id: discussion.discussion_id as string,
      body: "มาทักทายครั้งเดียว",
    });

    const list = (await report()).participants;

    // team-b โพสต์อย่างเดียว ไม่เคยลงมืออะไร
    expect(find(list, TEAM_B)?.spoke?.messages).toBe(1);
    expect(find(list, TEAM_B)?.acted).toBeNull();
    // team-a เปิดกระทู้และโพสต์ข้อความเปิด จึงมีทั้งสองฝั่ง
    expect(find(list, TEAM_A)?.acted?.kinds).toMatchObject({ discussions_created: 1 });
    expect(find(list, TEAM_A)?.spoke?.messages).toBe(1);
  });
});

/**
 * ข้อที่วัดมาแล้วจากโต๊ะจริง — ชื่อ `ChatGPT` ผูกกับรหัส client อย่างน้อยสี่ค่า
 * **แถวหนึ่งแถวจึงไม่ใช่หนึ่งตัวตน** และรายงานต้องบอกจำนวนกุญแจออกมา
 */
describe("ป้ายชื่อเดียวมาจากหลายกุญแจได้", () => {
  it("ชื่อเดียวที่เข้ามาสองทาง ขึ้นเป็นสองกุญแจ พร้อมกลไกที่ต่างกัน", async () => {
    const discussion = await callTool(TEAM_A, "create_discussion", { title: "กระทู้", body: "x" });
    await callTool(TEAM_B, "post_message", {
      discussion_id: discussion.discussion_id as string,
      body: "เข้ามาทาง header",
    });
    await callTool({ token: BOUND }, "post_message", {
      discussion_id: discussion.discussion_id as string,
      body: "เข้ามาทางโทเคนที่ผูกชื่อ",
    });

    const team = find((await report()).participants, TEAM_B);

    expect(team?.clients).toHaveLength(2);
    expect(team?.clients.map((c) => c.mechanism).sort()).toEqual([
      "static-header",
      "static-token",
    ]);
    expect(team?.spoke?.messages).toBe(2);
  });
});

describe("รายละเอียดที่ต้องถูก", () => {
  it("ชื่อที่สะกดต่างกันแค่ตัวพิมพ์ ถือเป็นแถวเดียว และรายงานทุกการสะกด", async () => {
    await callTool(TEAM_A, "create_task", { title: "ใบแรก" });
    await callTool("Owner/Team-A", "create_task", { title: "ใบที่สอง" });

    const list = (await report()).participants;
    const rows = list.filter((p) => p.spellings.some((s) => s.toLowerCase() === TEAM_A));

    expect(rows).toHaveLength(1);
    expect(rows[0].spellings.sort()).toEqual(["Owner/Team-A", TEAM_A]);
    expect(rows[0].acted?.kinds.tasks_created).toBe(2);
  });

  /**
   * ข้อจำกัดต้องอยู่ในผลลัพธ์ ไม่ใช่ในเอกสารข้างนอก — ผู้อ่านคือโมเดลที่อ่านผลของ tool
   * กฎที่อยู่คนละที่กับของที่มันอธิบาย คือกฎที่จะถูกอ่านข้าม
   */
  it("คืนข้อจำกัดมาด้วยเสมอ และบอกชัดว่าใช้สรุปความน่าเชื่อถือไม่ได้", async () => {
    const { limitations } = await report();

    expect(limitations.length).toBeGreaterThan(0);
    expect(limitations.join(" ")).toContain("เชื่อถือได้ ไม่ได้");
  });

  it("โต๊ะเปล่า คืนรายการว่าง ไม่ใช่ error", async () => {
    const { participants, limitations } = await report();

    expect(participants).toEqual([]);
    expect(limitations.length).toBeGreaterThan(0);
  });

  /**
   * `get_participants` ต้องอยู่ใน allowlist ของ `/mcp-readonly` ด้วย ไม่งั้นเส้นอ่าน
   * จะตอบว่า `disabled` — และคนที่เจอจะเป็นทีมที่ต่อผ่านเส้นอ่าน หลัง deploy ไปแล้ว
   *
   * ยิงเส้นอ่านจริงด้วยกุญแจของเส้นอ่านจริง เพราะสองเส้นนี้ไม่ได้ใช้กุญแจชุดเดียวกัน
   * เทสต์ที่ยิง `/mcp` แล้วตั้งชื่อว่าเส้นอ่าน จะเขียวโดยไม่เคยแตะ allowlist เลย
   */
  it("เรียกได้จากเส้นอ่านอย่างเดียวด้วย เพราะเป็น tool ที่ไม่เขียนอะไร", async () => {
    await callTool(TEAM_A, "create_task", { title: "ใบหนึ่ง" });

    const viaReadonly = (await callTool(
      { token: RO },
      "get_participants",
      {},
      "/mcp-readonly",
    )) as unknown as { participants: Observation[] };

    expect(find(viaReadonly.participants, TEAM_A)?.acted?.events).toBe(1);
  });
});

/**
 * กลไกที่รายงาน ต้องเป็นทางเข้าจริง ไม่ใช่ค่าที่เหลือจากการเดา
 *
 * รุ่นแรกของ tool นี้รู้จักแค่ `static-token:` กับ `static-header:` แล้ว fallback ที่เหลือ
 * เป็น `oauth` ทั้งหมด · พอรันกับโต๊ะจริงครั้งแรกก็เห็นทันทีว่า `Claude Code` ซึ่งเข้ามา
 * ทาง static bearer ถูกรายงานว่า `oauth` — **ผิดแบบที่ดูน่าเชื่อ** ซึ่งแย่กว่าไม่รู้
 *
 * และ `limitations` สี่ข้อของรุ่นแรกไม่มีข้อไหนครอบเรื่องนี้เลย
 */
describe("กลไกของทางเข้า", () => {
  it("โทเคนกลางที่ไม่ผูกชื่อ ขึ้นเป็น static-bearer ไม่ใช่ oauth", async () => {
    await callTool(null, "create_task", { title: "ใบจากโทเคนกลาง" });

    const row = (await report()).participants.find((p) => p.clients.length > 0);

    expect(row?.clients[0].client).toBe(STATIC_BEARER_CLIENT);
    expect(row?.clients[0].mechanism).toBe("static-bearer");
  });

  /**
   * ด่านกันตารางสองฝั่งเพี้ยนกัน — `identity.ts` สร้างรหัส client จาก `CLIENT_PREFIX`
   * และอ่านกลับด้วย `mechanismOfClient()` จากตารางเดียวกัน
   *
   * ถ้ามีคนเพิ่ม `source` ชนิดใหม่แล้วลืมใส่คำนำหน้า เทสต์นี้จะแดงทันที · ถ้าไม่มีด่านนี้
   * ชนิดใหม่จะเงียบ ๆ กลายเป็น `oauth` เหมือนที่ `jwt:` กับ `static-bearer` เคยเป็น
   */
  it("ทุก source ที่ identity รู้จัก อ่านกลับได้เป็นกลไกที่ไม่ใช่ค่าที่เหลือ", () => {
    const sources = Object.keys(CLIENT_PREFIX) as Array<keyof typeof CLIENT_PREFIX>;
    expect(sources.length).toBeGreaterThan(0);

    const seen = new Set<string>();

    for (const source of sources) {
      const prefix = CLIENT_PREFIX[source];

      // `config` เป็นข้อยกเว้นเดียวที่ตั้งใจให้ไม่มีคำนำหน้า เพราะโทเคนกลางที่ตั้งชื่อไว้
      // ไม่มีอะไรผูกกับรหัสให้แยกออกจากโทเคนกลางที่ไม่ตั้ง · ชนิดอื่นที่ปล่อยว่างจะถูก
      // **กลืนเป็น static-bearer เงียบ ๆ** ซึ่งเป็นช่องเดียวกับที่ `jwt:` เคยตก
      if (source !== "config") {
        expect(prefix, `${source} ไม่มีคำนำหน้า จะถูกกลืนเป็น static-bearer โดยไม่มีอะไรฟ้อง`)
          .toBeTruthy();
      }

      const client = prefix ? `${prefix}ทีมสมมติ` : STATIC_BEARER_CLIENT;
      const mechanism = mechanismOfClient(client);

      expect(MECHANISMS, `${source} ให้กลไกที่ไม่อยู่ในรายการ`).toContain(mechanism);
      expect(mechanism, `${source} ตกลงไปที่ค่าที่เหลือแทนที่จะถูกจดจำ`).not.toBe("oauth");

      expect(seen.has(mechanism), `${source} ใช้กลไกซ้ำกับชนิดอื่น แยกจากกันไม่ได้`).toBe(false);
      seen.add(mechanism);
    }
  });

  it("รหัสทึบที่ไม่มีคำนำหน้า ยังเป็น oauth ตามเดิม", () => {
    expect(mechanismOfClient("Hdg-mXzVScgTE0n9")).toBe("oauth");
  });
});
