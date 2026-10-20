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
import { CLIENT_POLICIES, allowedToolsFor, resolvePolicy } from "../src/client-policy";

const TOKEN = "client-policy-token-aaaaaaaaaaaaaaaaaa";

/** นโยบายที่ส่งขึ้นจริง — เทสต์ยิงกับของที่ deploy ไม่ใช่ของที่ฉีดเข้าไปเอง */
const ORCH = CLIENT_POLICIES.find((entry) => entry.client_name === "Orchestrator Bot")!;
const ALLOWED_THREAD = ORCH.post_message_discussions[0]!;

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
    testEnv(),
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

async function listToolNames(props?: Record<string, unknown>): Promise<string[]> {
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
    testEnv(),
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
  await (env as unknown as { DB: D1Database }).DB.prepare(
    `INSERT INTO discussions (id, workspace_id, title, created_by, created_at)
     VALUES (?1, 'ws-001', 'กระทู้ notify ของ shadow (fixture)', 'operator', ?2)`,
  )
    .bind(ALLOWED_THREAD, new Date().toISOString())
    .run();
}

beforeEach(async () => {
  await resetDatabase();
  await seedAllowedThread();
});

describe("หานโยบาย — สามค่า ไม่ใช่สอง", () => {
  const policies = [
    {
      client_id: "id-ok",
      client_name: "Bot ที่ถูกจำกัด",
      tools: ["get_tasks"],
      post_message_discussions: [],
    },
  ] as const;

  it("id ตรง = ใช้นโยบายนั้น", () => {
    const decision = resolvePolicy("id-ok", "Bot ที่ถูกจำกัด", policies);
    expect(decision.kind).toBe("restricted");
    expect(allowedToolsFor(decision)).toEqual(["get_tasks"]);
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
    expect(names).not.toContain("create_task");
    expect(names).not.toContain("resolve_decision");
  });

  it("เรียกตรงแล้วได้คำปฏิเสธจาก server ไม่ใช่ unknown tool", async () => {
    const frame = await callTool("create_task", { title: "ไม่ควรได้", detail: "" }, asOrchestrator);
    const text = refusal(frame);

    // ข้อความต้องสื่อว่า **ถูกปิด** ไม่ใช่ว่าไม่มี tool นี้อยู่จริง
    expect(text).toMatch(/disabled|ไม่อยู่ในนโยบาย/);
    expect(text).not.toMatch(/unknown tool/i);
  });
});

describe("ทางลบ — การเขียนที่ไม่เกี่ยวกับ post_message ถูกปฏิเสธทั้งหมด", () => {
  for (const tool of [
    "create_task",
    "update_task",
    "create_handoff",
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
