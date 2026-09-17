import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";
import { applySchema } from "./apply-schema";

/**
 * เส้นทางอ่านอย่างเดียวต้องกันสองอย่างที่พังเงียบได้
 *
 * หนึ่ง — cache ของ handler เดิม key ด้วยชื่อผู้เรียกอย่างเดียว ถ้าไม่รวมเส้นทาง
 * เข้าไปด้วย คำขอที่มาทีหลังบนอีกเส้นจะได้ server ตัวที่ประกอบไว้สำหรับเส้นแรก
 * แปลว่า tool ที่ปิดไว้จะกลายเป็นเปิด โดยไม่มีอะไรฟ้อง
 *
 * สอง — เส้น read-only ไม่ได้ผูกกับ OAuth provider ถ้าปล่อยให้คำขอที่รหัสไม่ผ่าน
 * ตกไปถึง provider มันจะพาผู้เรียกเข้า flow ของเส้นปกติ ซึ่งเป็นเส้นที่เขียนได้
 */

const RW = "rw-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const RO = "ro-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: RW,
  MCP_AUTH_TOKENS: `${RW}=test-team`,
  MCP_READONLY_TOKENS: `${RO}=test-team-readonly`,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

const WRITE_TOOLS = [
  "post_message",
  "create_task",
  "record_decision",
  "create_handoff",
  "create_discussion",
  "update_task",
  "accept_handoff",
  "record_plan",
  "resolve_decision",
];

async function call(path: string, token: string | undefined, body: unknown): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://example.test${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

/** คำตอบมาเป็น SSE frame — เอาบรรทัด data แรกพอ */
async function payload(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const line = text.split("\n").find((entry) => entry.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : text) as Record<string, unknown>;
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "readonly-test", version: "0.1.0" },
  },
};

beforeAll(async () => {
  await applySchema();
});

describe("รหัสผูกกับเส้นทาง", () => {
  it("รหัสของเส้นอ่านเข้าเส้นปกติไม่ได้", async () => {
    expect((await call("/mcp", RO, INIT)).status).toBe(401);
  });

  it("รหัสของเส้นปกติเข้าเส้นอ่านไม่ได้", async () => {
    expect((await call("/mcp-readonly", RW, INIT)).status).toBe(401);
  });

  it("ไม่มีรหัส เข้าเส้นอ่านไม่ได้", async () => {
    expect((await call("/mcp-readonly", undefined, INIT)).status).toBe(401);
  });

  it("รหัสถูกเส้นถูก ผ่าน", async () => {
    expect((await call("/mcp-readonly", RO, INIT)).status).toBe(200);
    expect((await call("/mcp", RW, INIT)).status).toBe(200);
  });
});

describe("เส้นอ่านไม่ตกไปที่ OAuth provider ของเส้นปกติ", () => {
  it("รหัสไม่ผ่าน ต้องได้ 401 ของเส้นนี้เอง ไม่ใช่ flow ของเส้นปกติ", async () => {
    const response = await call("/mcp-readonly", "not-a-real-token", INIT);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string; detail?: string };
    expect(body.error).toBe("unauthorized");
    expect(body.detail).toContain("MCP_READONLY_TOKENS");
  });
});

describe("tool ที่เขียนได้ถูกซ่อนและถูกปฏิเสธ", () => {
  it("tools/list บนเส้นอ่าน ไม่มี tool ที่เขียนได้", async () => {
    const body = await payload(
      await call("/mcp-readonly", RO, { jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const names = ((body.result as { tools: Array<{ name: string }> }).tools ?? []).map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    for (const tool of WRITE_TOOLS) expect(names).not.toContain(tool);
  });

  it.each(WRITE_TOOLS)("เรียก %s ตรง ๆ บนเส้นอ่าน ถูกปฏิเสธ", async (tool) => {
    const body = await payload(
      await call("/mcp-readonly", RO, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: tool, arguments: {} },
      }),
    );
    const text = JSON.stringify(body);
    // ปฏิเสธโดยระบุชื่อ tool ไม่ใช่ unknown tool และไม่ใช่การทำงานสำเร็จ
    expect(text).toContain(tool);
    expect(text).toContain("disabled");
  });
});

describe("cache ของ handler แยกตามเส้นทาง", () => {
  it("เรียกเส้นปกติก่อน แล้วเส้นอ่าน ต้องไม่ได้ tool ชุดของเส้นปกติมา", async () => {
    // ลำดับนี้สำคัญ: ถ้า key ของ cache ไม่รวมเส้นทาง คำขอที่สองจะได้ server ตัวแรก
    await call("/mcp", RW, INIT);
    const rw = await payload(await call("/mcp", RW, { jsonrpc: "2.0", id: 2, method: "tools/list" }));
    const ro = await payload(
      await call("/mcp-readonly", RO, { jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const rwNames = ((rw.result as { tools: Array<{ name: string }> }).tools ?? []).map((t) => t.name);
    const roNames = ((ro.result as { tools: Array<{ name: string }> }).tools ?? []).map((t) => t.name);
    expect(rwNames).toContain("post_message");
    expect(roNames).not.toContain("post_message");
    expect(roNames.length).toBeLessThan(rwNames.length);
  });
});
