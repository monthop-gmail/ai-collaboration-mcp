/**
 * ด่านจำกัดสิทธิ์ราย OAuth client — หกข้อตาม `dec-f213c339` ข้อ 6
 *
 * ใบอนุมัติ: `dec-f213c339` (approved + human · 20 ต.ค. 2026) · ออกแบบที่
 * `dis-683004a2` #20–#21 · แก้ข้อเท็จจริงเรื่องตัวกระตุ้น fail-closed ที่ #24 ·
 * รายชื่อ tool ของลูกค้ารายแรกมาจากที่ Codex ระบุเองที่ #23
 *
 * ## ยิงผ่าน `worker.fetch` จริง ไม่ใช่เรียกฟังก์ชันตรง
 *
 * ทำได้เพราะเทสต์เป็นคนสร้าง `ExecutionContext` เอง จึงใส่ `props` ที่ OAuth
 * provider จะใส่ให้ตอนของจริงได้ · ฟังก์ชันที่ถูกแล้วไม่ได้ต่อสายพิสูจน์อะไรไม่ได้
 *
 * ข้อที่ต่างจากของจริงและต้องรู้: คำขอในไฟล์นี้แนบ `Authorization` ของเส้น static
 * bearer เพื่อให้ผ่านด่าน auth แล้วใส่ `props` ทับ ซึ่งของจริงไม่เกิดพร้อมกัน —
 * แต่ชั้นนโยบายอ่าน **`props` เท่านั้น** จึงถูกยิงจริงทุกเส้นทางที่สำคัญ
 *
 * ## กรณีบวกสองข้อท้ายห้ามหายไป
 *
 * มิวแทนต์พิสูจน์ได้แค่ว่าตัวตรวจพูดว่า "ไม่ผ่าน" เป็น ไม่ได้พิสูจน์ว่ามันพูดว่า "ผ่าน" เป็น ·
 * และข้อ "client ที่ไม่อยู่ในนโยบายใช้งานได้ครบ" คือด่านที่กันการ deploy ที่ทำทั้งโต๊ะ
 * หยุดพร้อมกัน ซึ่งเป็นความเสียหายที่ใหญ่กว่าสิ่งที่ด่านนี้ป้องกัน
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";
import {
  CLIENT_POLICIES,
  OWNERSHIP_SQL,
  allowedToolsFor,
  argumentRefusal,
  effectiveAllowlist,
  resolvePolicy,
  type ClientPolicy,
} from "../src/client-policy";

const TOKEN = "client-policy-token-aaaaaaaaaaaaaaaaaa";

/** นโยบายที่ส่งขึ้นจริง — เทสต์ยิงกับของที่ deploy ไม่ใช่ของที่ฉีดเข้าไปเอง */
const ORCH = CLIENT_POLICIES.find((entry) => entry.client_name === "Orchestrator Bot")!;
const ALLOWED_THREAD = ORCH.discussions[0]!;
const WORKER = ORCH.workers[0]!;

let id = 0;

type Frame = {
  result?: { content?: Array<{ text?: string }>; isError?: boolean };
  error?: { message?: string };
};

function testEnv() {
  return {
    ...env,
    MCP_AUTH_TOKEN: TOKEN,
    ALLOWED_ORIGIN_HOSTNAMES: "*",
  } as unknown as Parameters<typeof worker.fetch>[1];
}

/** ยิงคำขอ MCP หนึ่งครั้ง · `props` คือสิ่งที่ OAuth provider ใส่ให้ตอนของจริง */
async function rpc(
  body: Record<string, unknown>,
  props?: Record<string, unknown>,
  sharedEnv?: Parameters<typeof worker.fetch>[1],
): Promise<Frame> {
  const ctx = createExecutionContext();
  if (props) (ctx as ExecutionContext & { props?: unknown }).props = props;

  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${TOKEN}`,
        "x-client-name": "policy-test",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: (id += 1), ...body }),
    }),
    sharedEnv ?? testEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);

  const text = await response.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5) : text) as Frame;
}

/** ข้อความที่ผู้เรียกได้รับ ไม่ว่าจะมาทางผลลัพธ์ที่เป็น error หรือ error ของโปรโตคอล */
function refusal(frame: Frame): string {
  return frame.result?.content?.[0]?.text ?? frame.error?.message ?? "";
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  props?: Record<string, unknown>,
): Promise<Frame> {
  return rpc({ method: "tools/call", params: { name, arguments: args } }, props);
}

async function callToolOn(
  name: string,
  args: Record<string, unknown>,
  props: Record<string, unknown>,
  sharedEnv: Parameters<typeof worker.fetch>[1],
): Promise<Frame> {
  return rpc({ method: "tools/call", params: { name, arguments: args } }, props, sharedEnv);
}

async function listToolNames(
  props?: Record<string, unknown>,
  sharedEnv?: Parameters<typeof worker.fetch>[1],
): Promise<string[]> {
  const ctx = createExecutionContext();
  if (props) (ctx as ExecutionContext & { props?: unknown }).props = props;

  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: (id += 1), method: "tools/list" }),
    }),
    sharedEnv ?? testEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);

  const text = await response.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const frame = JSON.parse(line ? line.slice(5) : text) as {
    result?: { tools?: Array<{ name: string }> };
  };
  return (frame.result?.tools ?? []).map((tool) => tool.name).sort();
}

/** ผู้เรียกที่อยู่ในนโยบาย — id กับชื่อตรงกับของที่ส่งขึ้นจริง */
const asOrchestrator = { clientId: ORCH.client_id, clientName: ORCH.client_name };

/**
 * กระทู้ที่นโยบายปักไว้ถูกสร้างด้วย id ตรงตัว
 *
 * ปัก id ไว้ในนโยบาย ⇒ สร้างผ่าน `create_discussion` ไม่ได้เพราะฮับออก id เอง ·
 * ใส่เป็น fixture ตรง ๆ เพื่อให้กรณีบวกยิงกับ **id ที่ส่งขึ้นจริง** ไม่ใช่ id สมมุติ
 */
async function seedAllowedThread(): Promise<void> {
  for (const id of ORCH.discussions) {
    await DB.prepare(
      `INSERT INTO discussions (id, workspace_id, title, created_by, created_at)
       VALUES (?1, 'ws-001', 'กระทู้ใน allowlist (fixture)', 'operator', ?2)`,
    )
      .bind(id, new Date().toISOString())
      .run();
  }
}

const DB = (env as unknown as { DB: D1Database }).DB;

/** task ที่ใส่ตรง ๆ ลง D1 — ใช้สร้างกรณีที่ผ่าน tool ไม่ได้ เช่น กระทู้ที่ถูกถอดจาก allowlist */
async function seedTask(createdByClient: string, discussionId: string | null): Promise<string> {
  const id = `task-${crypto.randomUUID()}`;
  await DB.prepare(
    `INSERT INTO tasks (id, workspace_id, discussion_id, title, detail, status, created_by,
       created_by_client, created_at) VALUES (?1, 'ws-001', ?2, 'fixture', '', 'open', 'x', ?3, ?4)`,
  )
    .bind(id, discussionId, createdByClient, new Date().toISOString())
    .run();
  return id;
}

function payload<T>(frame: Frame): T {
  return JSON.parse(frame.result?.content?.[0]?.text ?? "{}") as T;
}

/** create_task ที่ถูกต้องทุกข้อของ Orchestrator — กรณีบวกที่ทุกกรณีลบเทียบกับมัน */
async function orchestratorTask(): Promise<string> {
  const frame = await callTool(
    "create_task",
    { title: "งานของ orchestrator", detail: "", discussion_id: ALLOWED_THREAD, assigned_to: WORKER },
    asOrchestrator,
  );
  expect(frame.result?.isError ?? false).toBe(false);
  return payload<{ task_id: string }>(frame).task_id;
}

beforeEach(async () => {
  await resetDatabase();
  await seedAllowedThread();
});

describe("หานโยบาย — สามค่า ไม่ใช่สอง", () => {
  const policies: readonly ClientPolicy[] = [
    {
      client_id: "id-ok",
      also_ids: ["id-ok-2"],
      client_name: "Bot ที่ถูกจำกัด",
      tools: ["get_tasks"],
      discussions: [],
      workers: [],
      workspace: "ws-001",
    },
  ];

  it("id ตรง = ใช้นโยบายนั้น", () => {
    const decision = resolvePolicy("id-ok", "Bot ที่ถูกจำกัด", policies);
    expect(decision.kind).toBe("restricted");
    expect(allowedToolsFor(decision)).toEqual(["get_tasks"]);
  });

  it("id ใน also_ids = นโยบายเดียวกัน", () => {
    expect(resolvePolicy("id-ok-2", "ชื่ออะไรก็ได้", policies).kind).toBe("restricted");
  });

  it("ไม่อยู่ในรายการเลย = unrestricted และ allowlist เป็น undefined ไม่ใช่ว่าง", () => {
    const decision = resolvePolicy("id-อื่น", "ชื่ออื่น", policies);
    expect(decision.kind).toBe("unrestricted");
    // undefined = ไม่กรอง · [] = ปิดทุกตัว · สองค่านี้ตรงข้ามกัน
    expect(allowedToolsFor(decision)).toBeUndefined();
  });

  it("ชื่อตรงคลาสที่ถูกจำกัดแต่ id ไม่ตรง = denied ไม่ใช่ unrestricted", () => {
    const decision = resolvePolicy("id-ใหม่จากการลงทะเบียนรอบใหม่", "Bot ที่ถูกจำกัด", policies);
    expect(decision.kind).toBe("denied");
    expect(allowedToolsFor(decision)).toEqual([]);
  });

  it("ไม่มี id เลย (ไม่ใช่ OAuth) ไม่เคยอยู่ในนโยบาย", () => {
    expect(resolvePolicy(undefined, undefined, policies).kind).toBe("unrestricted");
    // ชื่อตรงแต่มาจากเส้นที่ไม่มี client_id ผนึกมา — ยังเป็น denied เพราะทิศของ
    // การพลาดต้องเป็นปฏิเสธ ไม่ใช่ปล่อย
    expect(resolvePolicy(undefined, "Bot ที่ถูกจำกัด", policies).kind).toBe("denied");
  });
});

describe("ทางลบ — tool ที่ไม่อยู่ในนโยบาย", () => {
  it("ไม่โผล่ใน tools/list ของ client ที่ถูกจำกัด", async () => {
    const names = await listToolNames(asOrchestrator);
    expect(names).toEqual([...ORCH.tools].sort());
    expect(names).toContain("create_task");
    expect(names).not.toContain("accept_handoff");
    expect(names).not.toContain("resolve_decision");
  });

  it("เรียกตรงแล้วได้คำปฏิเสธจาก server ไม่ใช่ unknown tool", async () => {
    const frame = await callTool("resolve_decision", { decision_id: "x", status: "approved" }, asOrchestrator);
    const text = refusal(frame);

    // ข้อความต้องสื่อว่า **ถูกปิด** ไม่ใช่ว่าไม่มี tool นี้อยู่จริง
    expect(text).toMatch(/disabled|ไม่อยู่ในนโยบาย/);
    expect(text).not.toMatch(/unknown tool/i);
  });
});

describe("ทางลบ — การเขียนนอกสี่ตัวที่ dec-020d7bb3 เปิด ถูกปฏิเสธทั้งหมด", () => {
  for (const tool of [
    "accept_handoff",
    "record_decision",
    "resolve_decision",
    "set_decision_scope",
    "create_discussion",
  ]) {
    it(`${tool} ถูกปฏิเสธ`, async () => {
      const frame = await callTool(tool, {}, asOrchestrator);
      expect(refusal(frame)).not.toBe("");
      expect(refusal(frame)).toMatch(/disabled|ไม่อยู่ในนโยบาย/);
    });
  }
});

describe("ทางลบ — post_message ผิดกระทู้", () => {
  it("โพสต์ลงกระทู้อื่นถูกปฏิเสธ แม้ว่า tool จะเปิดอยู่", async () => {
    const other = (
      JSON.parse(
        (await callTool("create_discussion", { title: "กระทู้อื่น" })).result?.content?.[0]
          ?.text ?? "{}",
      ) as { discussion_id?: string }
    ).discussion_id!;

    const frame = await callTool(
      "post_message",
      { discussion_id: other, body: "ไม่ควรเข้า" },
      asOrchestrator,
    );
    expect(refusal(frame)).toMatch(/ถูกจำกัดไว้เฉพาะกระทู้/);
  });

  it("ไม่ส่ง discussion_id มาเลยก็ถูกปฏิเสธ ไม่ใช่ผ่านเพราะไม่มีค่าให้เทียบ", async () => {
    const frame = await callTool("post_message", { body: "ไม่มีปลายทาง" }, asOrchestrator);
    expect(refusal(frame)).not.toBe("");
  });
});

describe("ทางลบ — ชื่อตรงแต่ client_id ไม่ตรง (fail-closed)", () => {
  const reRegistered = { clientId: "id-ใหม่หลังลงทะเบียน-DCR-รอบใหม่", clientName: ORCH.client_name };

  it("tools/list ว่างเปล่า", async () => {
    expect(await listToolNames(reRegistered)).toEqual([]);
  });

  it("แม้ tool ที่นโยบายเดิมอนุญาตก็เรียกไม่ได้", async () => {
    const frame = await callTool("get_workspace_context", {}, reRegistered);
    expect(refusal(frame)).not.toBe("");
  });
});

describe("ทางบวก — ของที่ต้องยังทำได้", () => {
  it("client ที่ถูกจำกัด โพสต์เข้ากระทู้ที่นโยบายอนุญาตได้จริง", async () => {
    const frame = await callTool(
      "post_message",
      { discussion_id: ALLOWED_THREAD, body: "[orchestrator shadow] ทดสอบกรณีบวก" },
      asOrchestrator,
    );

    expect(frame.result?.isError ?? false).toBe(false);
    const payload = JSON.parse(frame.result?.content?.[0]?.text ?? "{}") as {
      seq?: number;
      author?: string;
    };
    expect(payload.seq).toBe(1);
    expect(payload.author).toBe(ORCH.client_name);
  });

  it("client ที่ถูกจำกัด อ่าน tool ที่นโยบายอนุญาตได้", async () => {
    const frame = await callTool("get_workspace_context", {}, asOrchestrator);
    expect(frame.result?.isError ?? false).toBe(false);
  });

  it("client ที่ไม่อยู่ในนโยบายใช้งานได้ครบเหมือนเดิม — ด่านกันโต๊ะหยุดทั้งโต๊ะ", async () => {
    const names = await listToolNames({ clientId: "client-ที่ไม่ถูกจำกัด", clientName: "ChatGPT" });

    // ต้องได้ tool มากกว่าของนโยบาย และต้องมีตัวเขียนครบ
    expect(names.length).toBeGreaterThan(ORCH.tools.length);
    for (const tool of ["create_task", "create_handoff", "resolve_decision", "create_discussion"]) {
      expect(names).toContain(tool);
    }

    const made = await callTool(
      "create_task",
      { title: "client ที่ไม่ถูกจำกัดยังสร้างงานได้", detail: "" },
      { clientId: "client-ที่ไม่ถูกจำกัด", clientName: "ChatGPT" },
    );
    expect(made.result?.isError ?? false).toBe(false);
  });

  it("เส้น static bearer ที่ไม่มี props เลย ไม่ถูกแตะ", async () => {
    const names = await listToolNames();
    expect(names).toContain("create_task");
    expect(names).toContain("post_message");
  });
});

/**
 * F1 ของ `dis-683004a2#49` — **ด่านที่ไม่ได้อยู่ตรงที่มันพัง**
 *
 * mentor ยิงมิวแทนต์ K1 คือถอด `|${policyKey(policy)}|` ออกจาก cache key แล้ว
 * **ชุดเทสต์ 535 ข้อผ่านหมด** · เหตุเพราะ `testEnv()` คืน `{...env}` ใบใหม่ทุกคำขอ
 * และ `handlers` เป็น `WeakMap` ที่คีย์ด้วย `env` ⇒ ทุกคำขอในเทสต์ได้ cache ว่าง
 * cache จึงไม่เคยข้ามคำขอ · แต่บน production `env` คงที่ต่อ isolate
 *
 * ความพังจริงที่มิวแทนต์นั้นเปิดไว้: Orchestrator เรียกก่อน → handler 6 tool ถูก
 * cache ไว้ใต้คีย์ `rw||` → **ทุก OAuth client ที่ไม่ถูกจำกัด (`* Bot` ห้าตัว ·
 * ChatGPT · Grok · Cursor) ได้ handler 6 tool ต่อ** คือโต๊ะเสีย tool ทั้งโต๊ะ
 * ซึ่งเป็นความเสียหายที่กรณีบวกข้อสุดท้ายมีไว้กันพอดี แต่กันไม่ได้เพราะทดสอบบน
 * cache ที่ว่างทุกครั้ง
 *
 * ไฟล์นี้จึงใช้ **env ใบเดียว** ข้ามคำขอ และยิงสลับลำดับทั้งสองทาง
 */
describe("F1 — นโยบายต้องไม่รั่วข้ามผู้เรียกที่ใช้ env เดียวกัน", () => {
  const unrestricted = { clientId: "client-ไม่ถูกจำกัด", clientName: "ChatGPT" };
  const deniedName = { clientId: "id-ใหม่หลังลงทะเบียนรอบใหม่", clientName: ORCH.client_name };
  const sorted = [...ORCH.tools].sort();

  /** env ใบเดียวกันทุกคำขอ — เลียนของจริงที่ `env` คงที่ต่อ isolate */
  function sharedEnv() {
    return {
      ...env,
      MCP_AUTH_TOKEN: TOKEN,
      ALLOWED_ORIGIN_HOSTNAMES: "*",
    } as unknown as Parameters<typeof worker.fetch>[1];
  }

  it("ผู้ถูกจำกัดเรียกก่อน แล้วผู้ไม่ถูกจำกัดต้องยังได้ tool ครบ", async () => {
    const one = sharedEnv();

    expect(await listToolNames(asOrchestrator, one)).toEqual(sorted);

    const full = await listToolNames(unrestricted, one);
    expect(full.length).toBeGreaterThan(ORCH.tools.length);
    expect(full).toContain("create_task");
    expect(full).toContain("resolve_decision");

    expect(await listToolNames(deniedName, one)).toEqual([]);

    // กลับมาถามคนแรกซ้ำ ต้องได้ของเดิม ไม่ใช่ของที่คนหลังทำให้เปลี่ยน
    expect(await listToolNames(asOrchestrator, one)).toEqual(sorted);
  });

  it("ลำดับกลับทาง — ผู้ไม่ถูกจำกัดเรียกก่อน ก็ต้องได้ผลเดิมทั้งสองฝ่าย", async () => {
    const one = sharedEnv();

    const full = await listToolNames(unrestricted, one);
    expect(full).toContain("create_task");

    expect(await listToolNames(asOrchestrator, one)).toEqual(sorted);
    expect(await listToolNames(deniedName, one)).toEqual([]);
    expect(await listToolNames(unrestricted, one)).toEqual(full);
  });

  it("เรียก tool จริงบน env เดียวกัน ก็ยังแยกสิทธิ์ถูก", async () => {
    const one = sharedEnv();

    // ผู้ถูกจำกัดโดนปฏิเสธ แล้วผู้ไม่ถูกจำกัดต้องยังสร้างงานได้
    expect(refusal(await callToolOn("resolve_decision", { decision_id: "x", status: "approved" }, asOrchestrator, one)))
      .toMatch(/disabled|ไม่อยู่ในนโยบาย/);

    const made = await callToolOn(
      "create_task",
      { title: "คนที่ไม่ถูกจำกัดยังสร้างได้", detail: "" },
      unrestricted,
      one,
    );
    expect(made.result?.isError ?? false).toBe(false);
  });
});

/** F2 ของ `#49` — ส่วนร่วมของ allowlist เมื่ออยู่บนเส้นที่มีรายการของตัวเอง */
describe("F2 — ส่วนร่วมของ allowlist", () => {
  const decision = resolvePolicy(ORCH.client_id, ORCH.client_name);

  it("ไม่ได้อยู่บนเส้นที่มีรายการ = ใช้ของนโยบายตรง ๆ", () => {
    expect(effectiveAllowlist(decision)).toEqual(ORCH.tools);
  });

  it("อยู่บนเส้นที่มีรายการ = ตัดเหลือเฉพาะที่อยู่ทั้งสองรายการ", () => {
    const readOnly = ["get_tasks", "get_discussion", "get_plans"];
    // `post_message` กับ tool อ่านที่ไม่อยู่ในรายการของเส้นนั้น ต้องหลุดออกทั้งคู่
    expect(effectiveAllowlist(decision, readOnly)).toEqual(["get_tasks", "get_discussion"]);
    expect(effectiveAllowlist(decision, readOnly)).not.toContain("post_message");
  });

  it("unrestricted ยังเป็น undefined แม้อยู่บนเส้นที่มีรายการ — ปล่อยให้เส้นนั้นกรองเอง", () => {
    expect(effectiveAllowlist({ kind: "unrestricted" }, ["get_tasks"])).toBeUndefined();
  });

  it("denied เป็นรายการว่างเสมอ ไม่ว่าเส้นไหน", () => {
    const denied = resolvePolicy("id-อื่น", ORCH.client_name);
    expect(effectiveAllowlist(denied)).toEqual([]);
    expect(effectiveAllowlist(denied, ["get_tasks"])).toEqual([]);
  });
});

/**
 * `dec-020d7bb3` — โหมด live: เขียนได้เฉพาะของตัวเอง ในกระทู้ที่อนุญาต ส่งให้ worker ที่ระบุ
 *
 * ทุกกฎมีทั้งกรณีบวกและกรณีลบ · กรณีบวก `orchestratorTask()` คือฐานที่กรณีลบทุกข้อ
 * เทียบกับ — ถ้าด่านปฏิเสธทุกอย่าง กรณีบวกจะล้มก่อน
 */
describe("live — create_task", () => {
  it("ครบทุกข้อ (กระทู้ใน allowlist · worker ในรายการ · ไม่ระบุ workspace) สร้างได้", async () => {
    const id = await orchestratorTask();
    const row = await DB.prepare("SELECT created_by_client, assigned_to FROM tasks WHERE id = ?1")
      .bind(id)
      .first<{ created_by_client: string; assigned_to: string }>();
    expect(row?.created_by_client).toBe(ORCH.client_id);
    expect(row?.assigned_to).toBe(WORKER);
  });

  it('ระบุ workspace "ws-001" ตรงตัวก็ได้', async () => {
    const frame = await callTool(
      "create_task",
      { title: "x", detail: "", discussion_id: ALLOWED_THREAD, assigned_to: WORKER, workspace: "ws-001" },
      asOrchestrator,
    );
    expect(frame.result?.isError ?? false).toBe(false);
  });

  it("ไม่ส่ง discussion_id → ปฏิเสธ", async () => {
    const frame = await callTool("create_task", { title: "x", detail: "", assigned_to: WORKER }, asOrchestrator);
    expect(refusal(frame)).toMatch(/ต้องส่ง discussion_id/);
  });

  it("กระทู้นอก allowlist → ปฏิเสธ", async () => {
    const other = payload<{ discussion_id: string }>(
      await callTool("create_discussion", { title: "กระทู้อื่น" }),
    ).discussion_id;
    const frame = await callTool(
      "create_task",
      { title: "x", detail: "", discussion_id: other, assigned_to: WORKER },
      asOrchestrator,
    );
    expect(refusal(frame)).toMatch(/ถูกจำกัดไว้เฉพาะกระทู้/);
  });

  it("ไม่ส่ง assigned_to หรือส่ง worker นอกรายการ → ปฏิเสธ", async () => {
    const missing = await callTool("create_task", { title: "x", detail: "", discussion_id: ALLOWED_THREAD }, asOrchestrator);
    expect(refusal(missing)).toMatch(/worker ในรายการ/);
    const stranger = await callTool(
      "create_task",
      { title: "x", detail: "", discussion_id: ALLOWED_THREAD, assigned_to: "ChatGPT" },
      asOrchestrator,
    );
    expect(refusal(stranger)).toMatch(/worker ในรายการ/);
  });

  for (const workspace of ["ws-002", null, ""]) {
    it(`workspace ${JSON.stringify(workspace)} → ปฏิเสธก่อนเขียน`, async () => {
      const before = (await DB.prepare("SELECT count(*) AS n FROM tasks").first<{ n: number }>())!.n;
      const frame = await callTool(
        "create_task",
        { title: "x", detail: "", discussion_id: ALLOWED_THREAD, assigned_to: WORKER, workspace },
        asOrchestrator,
      );
      expect(refusal(frame)).not.toBe("");
      const after = (await DB.prepare("SELECT count(*) AS n FROM tasks").first<{ n: number }>())!.n;
      expect(after).toBe(before);
    });
  }
});

describe("live — update_task", () => {
  it("ปิดงานของตัวเองเป็น done พร้อม result_ref ได้", async () => {
    const id = await orchestratorTask();
    const frame = await callTool(
      "update_task",
      { task_id: id, status: "done", result_ref: "dis-x#1", detail: "เสร็จ", acting_context: "ws-001" },
      asOrchestrator,
    );
    expect(frame.result?.isError ?? false).toBe(false);
    expect(payload<{ status: string }>(frame).status).toBe("done");
  });

  it("blocked ก็ได้ · open กับ in_progress ไม่ได้", async () => {
    const id = await orchestratorTask();
    expect((await callTool("update_task", { task_id: id, status: "blocked" }, asOrchestrator)).result?.isError ?? false).toBe(false);
    expect(refusal(await callTool("update_task", { task_id: id, status: "open" }, asOrchestrator))).toMatch(/status ได้เฉพาะ done, blocked/);
    expect(refusal(await callTool("update_task", { task_id: id, status: "in_progress" }, asOrchestrator))).toMatch(/status ได้เฉพาะ/);
  });

  it("assigned_to ห้ามทุกค่า รวม null", async () => {
    const id = await orchestratorTask();
    for (const assigned_to of ["Claude Code Bot", null]) {
      const frame = await callTool("update_task", { task_id: id, status: "done", assigned_to }, asOrchestrator);
      expect(refusal(frame)).toMatch(/assigned_to/);
    }
    const row = await DB.prepare("SELECT status FROM tasks WHERE id = ?1").bind(id).first<{ status: string }>();
    expect(row?.status).toBe("open");
  });

  it("task ของ client อื่น → ปฏิเสธ ด้วยข้อความเดียวกับ task ที่ไม่มีอยู่", async () => {
    const foreign = payload<{ task_id: string }>(
      await callTool(
        "create_task",
        { title: "ของ ChatGPT", detail: "", discussion_id: ALLOWED_THREAD },
        { clientId: "client-อื่น", clientName: "ChatGPT" },
      ),
    ).task_id;

    const onForeign = refusal(await callTool("update_task", { task_id: foreign, status: "done" }, asOrchestrator));
    const onMissing = refusal(await callTool("update_task", { task_id: "task-ไม่มีอยู่", status: "done" }, asOrchestrator));

    expect(onForeign).toMatch(/ไม่พบ หรือไม่ได้สร้างโดย client นี้/);
    expect(onForeign.replace(foreign, "<id>")).toBe(onMissing.replace("task-ไม่มีอยู่", "<id>"));

    const row = await DB.prepare("SELECT status FROM tasks WHERE id = ?1").bind(foreign).first<{ status: string }>();
    expect(row?.status).toBe("open");
  });

  it("task ของตัวเองแต่กระทู้ถูกถอดจาก allowlist แล้ว → ปฏิเสธ", async () => {
    const removed = payload<{ discussion_id: string }>(
      await callTool("create_discussion", { title: "กระทู้ที่เคยอยู่ใน allowlist" }),
    ).discussion_id;
    const id = await seedTask(ORCH.client_id, removed);
    expect(refusal(await callTool("update_task", { task_id: id, status: "done" }, asOrchestrator))).toMatch(
      /ไม่อยู่ใน allowlist ปัจจุบัน/,
    );
    // ไม่มีกระทู้เลยก็ไม่อยู่ใน allowlist
    const orphan = await seedTask(ORCH.client_id, null);
    expect(refusal(await callTool("update_task", { task_id: orphan, status: "done" }, asOrchestrator))).toMatch(
      /ไม่อยู่ใน allowlist ปัจจุบัน/,
    );
  });

  it("D1 ตอบผิดพลาดตอนอ่านเจ้าของ → ปฏิเสธ (fail-closed) ไม่ใช่ปล่อยหรือพังเฉย ๆ", async () => {
    const broken = {
      ...testEnv(),
      DB: {
        prepare() {
          throw new Error("D1_ERROR: simulated outage");
        },
      },
    } as unknown as Parameters<typeof worker.fetch>[1];
    const frame = await callToolOn("update_task", { task_id: "task-x", status: "done" }, asOrchestrator, broken);
    expect(refusal(frame)).toMatch(/fail-closed/);
  });
});

describe("live — create_handoff", () => {
  it("ส่งงานของตัวเองให้ worker ในรายการได้", async () => {
    const id = await orchestratorTask();
    const frame = await callTool("create_handoff", { task_id: id, to: WORKER, context: "ทำต่อ" }, asOrchestrator);
    expect(frame.result?.isError ?? false).toBe(false);
    expect(payload<{ to: string }>(frame).to).toBe(WORKER);
  });

  it("to นอกรายการ worker → ปฏิเสธ", async () => {
    const id = await orchestratorTask();
    expect(refusal(await callTool("create_handoff", { task_id: id, to: "Grok", context: "x" }, asOrchestrator))).toMatch(
      /worker ในรายการ/,
    );
  });

  it("task ของ client อื่น → ปฏิเสธ ข้อความเดียวกับ task ที่ไม่มี", async () => {
    const foreign = await seedTask("client-อื่น", ALLOWED_THREAD);
    const onForeign = refusal(await callTool("create_handoff", { task_id: foreign, to: WORKER, context: "x" }, asOrchestrator));
    const onMissing = refusal(await callTool("create_handoff", { task_id: "task-ไม่มี", to: WORKER, context: "x" }, asOrchestrator));
    expect(onForeign.replace(foreign, "<id>")).toBe(onMissing.replace("task-ไม่มี", "<id>"));
    expect((await DB.prepare("SELECT count(*) AS n FROM handoffs").first<{ n: number }>())!.n).toBe(0);
  });

  it("กระทู้ถูกถอดจาก allowlist → ปฏิเสธ", async () => {
    const id = await seedTask(ORCH.client_id, null);
    expect(refusal(await callTool("create_handoff", { task_id: id, to: WORKER, context: "x" }, asOrchestrator))).toMatch(
      /ไม่อยู่ใน allowlist ปัจจุบัน/,
    );
  });
});

/**
 * also_ids ของแถวจริงว่าง (ข้อ 1) จึงยิงผ่าน `worker.fetch` ด้วยนโยบายที่ deploy ไม่ได้ —
 * ทดสอบด่านตัวจริง (`argumentRefusal`) กับ D1 จริง ด้วยแถวที่มี also_ids แทน ·
 * `resolvePolicy` กับการตรวจเจ้าของใช้ `policyIds()` ตัวเดียวกัน จึงเป็นเซตเดียวกันโดยโครงสร้าง
 */
describe("live — also_ids", () => {
  const twoIds: ClientPolicy = { ...ORCH, also_ids: ["id-ใบใหม่"] };

  it("id ใน also_ids แก้ task ที่สร้างด้วย client_id ได้ และกลับกัน", async () => {
    const byPrimary = await seedTask(ORCH.client_id, ALLOWED_THREAD);
    const bySecondary = await seedTask("id-ใบใหม่", ALLOWED_THREAD);
    const decision = resolvePolicy("id-ใบใหม่", ORCH.client_name, [twoIds]);
    expect(decision.kind).toBe("restricted");
    expect(await argumentRefusal(decision, "update_task", { task_id: byPrimary, status: "done" }, DB)).toBeUndefined();
    expect(await argumentRefusal(decision, "update_task", { task_id: bySecondary, status: "done" }, DB)).toBeUndefined();
  });

  it("id นอกเซต ยังถูกปฏิเสธ", async () => {
    const byPrimary = await seedTask(ORCH.client_id, ALLOWED_THREAD);
    const stranger: ClientPolicy = { ...ORCH, client_id: "id-คนอื่น", also_ids: [] };
    const decision = resolvePolicy("id-คนอื่น", "x", [stranger]);
    expect(await argumentRefusal(decision, "update_task", { task_id: byPrimary, status: "done" }, DB)).toMatch(
      /ไม่พบ หรือไม่ได้สร้างโดย client นี้/,
    );
  });
});

describe("live — client ที่ไม่ถูกจำกัดไม่เสียอะไร", () => {
  /** env ที่จด SQL ทุกคำสั่งที่ถูก prepare — เพื่อยืนยันว่า D1 read ของด่านนี้ไม่เกิดกับคนที่ไม่เกี่ยว */
  function recordingEnv() {
    const seen: string[] = [];
    const base = testEnv() as unknown as { DB: D1Database };
    const spy = new Proxy(base.DB, {
      get(target, prop, receiver) {
        if (prop === "prepare") {
          return (sql: string) => {
            seen.push(sql);
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return { seen, env: { ...base, DB: spy } as unknown as Parameters<typeof worker.fetch>[1] };
  }

  it("update_task ของ ChatGPT ไม่ยิงคิวรีตรวจเจ้าของ — แต่ของ Orchestrator ยิง", async () => {
    const unrestricted = { clientId: "client-อื่น", clientName: "ChatGPT" };
    const one = recordingEnv();
    const made = payload<{ task_id: string }>(
      await callToolOn("create_task", { title: "x", detail: "" }, unrestricted, one.env),
    ).task_id;
    one.seen.length = 0;

    const frame = await callToolOn(
      "update_task",
      { task_id: made, status: "in_progress", assigned_to: "ใครก็ได้" },
      unrestricted,
      one.env,
    );
    expect(frame.result?.isError ?? false).toBe(false);
    expect(one.seen).not.toContain(OWNERSHIP_SQL);

    await callToolOn("update_task", { task_id: made, status: "done" }, asOrchestrator, one.env);
    expect(one.seen).toContain(OWNERSHIP_SQL);
  });

  it("ชื่อ Orchestrator Bot ทาง X-Client-Name โดยไม่มี props ไม่ถูกดึงเข้านโยบาย — ไม่มี fallback จาก header", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${TOKEN}`,
          "x-client-name": ORCH.client_name,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: (id += 1), method: "tools/list" }),
      }),
      testEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const text = await response.text();
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    const names = (JSON.parse(line ? line.slice(5) : text) as { result?: { tools?: Array<{ name: string }> } })
      .result?.tools?.map((t) => t.name) ?? [];
    expect(names).toContain("resolve_decision");
  });
});
