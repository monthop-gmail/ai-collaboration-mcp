import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";
import { applySchema } from "./apply-schema";
import gateway from "./fixtures/adapter-conformance/vectors.json";
import gatewayJwks from "./fixtures/adapter-conformance/jwks.json";

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

async function call(
  path: string,
  token: string | undefined,
  body: unknown,
  extra: { env?: typeof testEnv; headers?: Record<string, string> } = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://example.test${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...extra.headers,
      },
      body: JSON.stringify(body),
    }),
    extra.env ?? testEnv,
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
    const body = (await response.json()) as { error?: string; reason?: string };
    expect(body.error).toBe("unauthorized");
    // รหัสจากชุดปิด ไม่ใช่ข้อความอิสระ เพราะฝั่ง gateway นับค่านี้ในตารางบันทึก
    expect(body.reason).toBe("unknown_token");
    // และต้องเป็นคำท้าของเส้นนี้ ไม่ใช่ของ OAuth provider ซึ่งจะพาไป flow ที่เขียนได้
    expect(response.headers.get("www-authenticate")).toContain("ai-collaboration read-only");
    expect(response.headers.get("www-authenticate")).not.toContain("resource_metadata");
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

/**
 * เส้น JWT ของ gateway บน route จริง ไม่ใช่เรียก adapter ตรง
 *
 * ชุด vector วัดตัว verifier ไปแล้วใน `jwt.test.ts` ส่วนที่นี่วัดว่า **route ใช้มันจริง**
 * และตัวตนที่ได้ไปถึงชั้นที่บันทึกผู้เขียน — verifier ที่ถูกแต่ไม่ได้ต่อ พิสูจน์อะไรไม่ได้
 */
const GATEWAY_ENV = {
  ...testEnv,
  GATEWAY_JWT_ISSUER: gateway.issuer,
  GATEWAY_JWT_AUDIENCE: gateway.audience,
  GATEWAY_CONNECTOR_ID: gateway.connector_id,
  GATEWAY_JWKS: JSON.stringify(gatewayJwks),
  // ประกาศตรง ๆ ว่ากุญแจชุดนี้เป็นของสาธารณะ ไม่ใช่ของ gateway จริง
  GATEWAY_JWKS_SOURCE: "fixture",
} as unknown as typeof testEnv;

const vector = (id: string) =>
  (gateway.vectors as Array<{ id: string; token: string }>).find((v) => v.id === id)!.token;

const CONTEXT_CALL = {
  jsonrpc: "2.0",
  id: 9,
  method: "tools/call",
  params: { name: "get_workspace_context", arguments: { limit: 1 } },
};

async function youAre(response: Response): Promise<string | undefined> {
  const body = await payload(response);
  const text = (body.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
  return text ? (JSON.parse(text) as { you_are?: string }).you_are : undefined;
}

describe("เส้น JWT ของ gateway ต่อกับ route จริง", () => {
  it("โทเคนที่ผ่านทุกด่าน เข้าได้ และตัวตนคือ sub ที่ตรวจลายเซ็นแล้ว", async () => {
    const response = await call("/mcp-readonly", vector("valid_read"), CONTEXT_CALL, {
      env: GATEWAY_ENV,
    });

    expect(response.status).toBe(200);
    expect(await youAre(response)).toBe("oidc:conformance-subject");
  });

  /**
   * เงื่อนไขของใบงาน — `X-Client-Name` ที่ปลอมมาต้องไม่มีผลต่อ actor
   *
   * ทำด้วยการไม่เคยอ่าน header บนเส้นนี้ ไม่ใช่การอ่านแล้วเทียบทิ้ง เพราะการอ่าน
   * แล้วเทียบทิ้งยังเปิดช่องให้ใครสลับลำดับทีหลังแล้วมันกลับมามีผล
   */
  it("X-Client-Name ปลอม ไม่มีผลต่อตัวตน", async () => {
    const response = await call("/mcp-readonly", vector("valid_read"), CONTEXT_CALL, {
      env: GATEWAY_ENV,
      headers: { "x-client-name": "monthop-gmail/agent-platform" },
    });

    expect(response.status).toBe(200);
    expect(await youAre(response)).toBe("oidc:conformance-subject");
  });

  it("aud รูป array ที่มีค่าที่ถูกอยู่ในรายการ ต้องถูกปฏิเสธที่ route ไม่ใช่แค่ใน adapter", async () => {
    const response = await call(
      "/mcp-readonly",
      vector("audience_array_contains_valid"),
      CONTEXT_CALL,
      { env: GATEWAY_ENV },
    );

    expect(response.status).toBe(401);
    expect(((await response.json()) as { reason?: string }).reason).toBe("audience_mismatch");
  });

  it("cid ไม่ตรง connector ถูกปฏิเสธด้วยรหัสของตัวเอง", async () => {
    const response = await call("/mcp-readonly", vector("cid_mismatch"), CONTEXT_CALL, {
      env: GATEWAY_ENV,
    });

    expect(((await response.json()) as { reason?: string }).reason).toBe("connector_mismatch");
  });

  /**
   * ไม่ตั้ง config ของ gateway = ปิดเส้น JWT ทั้งเส้น ไม่ใช่รับโทเคนแบบหลวม ๆ
   * adapter ที่ไม่รู้ audience ของตัวเอง จะกลายเป็น adapter ที่รับโทเคนใดก็ได้
   */
  it("ไม่มี config ของ gateway โทเคนรูป JWT ตกไปทาง static แล้วไม่ผ่าน", async () => {
    const response = await call("/mcp-readonly", vector("valid_read"), CONTEXT_CALL);

    expect(response.status).toBe(401);
    expect(((await response.json()) as { reason?: string }).reason).toBe("unknown_token");
  });

  it("รหัส static เดิมยังใช้ได้ควบคู่กัน เป็น compatibility path", async () => {
    const response = await call("/mcp-readonly", RO, CONTEXT_CALL, { env: GATEWAY_ENV });

    expect(response.status).toBe(200);
    expect(await youAre(response)).toBe("test-team-readonly");
  });
});

/**
 * ตั้งไม่ครบต้องดังกว่าตั้งไม่เลย
 *
 * ถ้าตั้งสามในห้าแล้วเส้น JWT ปิดเงียบ ๆ ทุกคำขอจะตกไปทาง static bearer แล้วดูเหมือน
 * ทำงานปกติ ทั้งที่ของที่ตั้งใจเปิดไว้ไม่ได้เปิด — เป็นความล้มเหลวที่ไม่มีใครเห็น
 */
describe("config ของ gateway ตั้งไม่ครบ ต้องล้มเหลวแบบมีเสียง", () => {
  const partial = (patch: Record<string, unknown>) =>
    ({ ...GATEWAY_ENV, ...patch }) as unknown as typeof testEnv;

  it("ขาดค่าใดค่าหนึ่ง ต้องได้ 500 พร้อมบอกว่าขาดตัวไหน ไม่ใช่ 401", async () => {
    const response = await call("/mcp-readonly", RO, CONTEXT_CALL, {
      env: partial({ GATEWAY_CONNECTOR_ID: undefined }),
    });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string; detail?: string };
    expect(body.error).toBe("server_misconfigured");
    expect(body.detail).toContain("GATEWAY_CONNECTOR_ID");
  });

  it("ไม่ประกาศว่ากุญแจมาจากไหน ต้องไม่ผ่าน", async () => {
    const response = await call("/mcp-readonly", RO, CONTEXT_CALL, {
      env: partial({ GATEWAY_JWKS_SOURCE: "maybe" }),
    });

    expect(response.status).toBe(500);
    expect(((await response.json()) as { detail?: string }).detail).toContain(
      "GATEWAY_JWKS_SOURCE",
    );
  });

  it("JWKS ที่ไม่ใช่ JSON ต้องไม่ผ่าน ไม่ใช่ปิดเส้นเงียบ ๆ", async () => {
    const response = await call("/mcp-readonly", RO, CONTEXT_CALL, {
      env: partial({ GATEWAY_JWKS: "ไม่ใช่ JSON" }),
    });

    expect(response.status).toBe(500);
    expect(((await response.json()) as { detail?: string }).detail).toContain("GATEWAY_JWKS");
  });

  it("ไม่ตั้งสักค่า คือปิดเส้น JWT โดยตั้งใจ static ยังใช้ได้ปกติ", async () => {
    const response = await call("/mcp-readonly", RO, CONTEXT_CALL);

    expect(response.status).toBe(200);
    expect(await youAre(response)).toBe("test-team-readonly");
  });
});
