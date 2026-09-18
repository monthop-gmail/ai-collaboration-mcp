import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker, { auditActor } from "../src/index";
import { applySchema } from "./apply-schema";
import gateway from "./fixtures/adapter-conformance/vectors.json";
import gatewayJwks from "./fixtures/adapter-conformance/jwks.json";
import gwTestJwks from "./fixtures/gateway-test-runtime/jwks.json";
import required_ from "./fixtures/adapter-conformance/attestations.json";
import { createAdapter, jwksSourceMismatch } from "../src/jwt";

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

/**
 * ของที่ชุดกลางทดสอบแทนไม่ได้ และต้องประกาศมาเอง
 *
 * ชุดกลางรับ config มาจากไฟล์ vector เอง จะสร้าง adapter ด้วยค่าที่ไม่ตรงกับไฟล์
 * ก็เป็นการทดสอบตัวเองมากกว่าทดสอบ adapter — แต่ปล่อยเงียบไม่ได้ เพราะ adapter ที่
 * แกะ connector จากท้าย audience จะผ่าน 24 ข้อ **เท่ากับ** adapter ที่ไม่ได้แกะ
 * ทั้งที่อ่อนกว่าจริง
 *
 * **ไม่ประกาศด้วยค่าที่พิมพ์ไว้** — ทุกข้อถูกรันพิสูจน์ในรอบเดียวกับที่ประกาศ
 * เพราะการประกาศที่ไม่มีอะไรรองรับ คือสิ่งเดียวกับที่ช่องนี้ถูกสร้างมาเพื่อกัน
 */
describe("attestation ที่ต้องประกาศให้ฝั่ง gateway", () => {
  const validRead = vector("valid_read");

  /** พิสูจน์ทีละข้อแล้วคืนผล — ค่าที่ประกาศจึงเป็นผลของการรัน ไม่ใช่ค่าที่ตั้งไว้ */
  async function prove(): Promise<Record<string, boolean>> {
    // 1 — connectorId มาจาก config ไม่ได้แกะจากท้าย audience
    const mislabelled = createAdapter({
      issuer: gateway.issuer,
      audience: gateway.audience,
      connectorId: "some-other-connector",
      getJwks: () => gatewayJwks,
    });
    const got = await mislabelled.verify(validRead, { operation: "read" });

    // 2 — ประกาศชนิดกุญแจผิด ต้องไม่ผ่าน ทั้งสามทิศ
    const sourceGuard =
      jwksSourceMismatch(gatewayJwks, "gateway") !== undefined &&
      jwksSourceMismatch(gwTestJwks, "gateway") !== undefined &&
      jwksSourceMismatch(gwTestJwks, "fixture") !== undefined;

    // 3 — ตั้งค่าไม่ครบต้องได้ 500 ที่บอกว่าขาดตัวไหน ไม่ใช่ 401 และไม่ใช่ทำงานปกติ
    const broken = await call("/mcp-readonly", RO, CONTEXT_CALL, {
      env: { ...GATEWAY_ENV, GATEWAY_CONNECTOR_ID: undefined } as unknown as typeof testEnv,
    });
    const body = (await broken.json()) as { error?: string; detail?: string };

    // 4 — ยิงจริงแล้วดูว่า content-type ที่ตอบกลับเป็นอะไร
    //
    // ข้อนี้มีเทสต์อยู่แล้วที่หัวข้อ "รูปของคำตอบที่เราส่งออกไป" ข้างล่าง แต่การชี้ไปที่
    // เทสต์อื่นไม่ใช่การพิสูจน์ — ถ้าไฟล์นั้นถูกลบหรือถูก skip คำประกาศจะยังเขียว
    // ซึ่งเป็นรูปเดียวกับที่ช่อง attestation ทั้งช่องถูกสร้างมาเพื่อกัน จึงยิงซ้ำตรงนี้
    //
    // ไม่ล็อกว่าต้องเป็นรูปไหน เพราะ MCP อนุญาตทั้ง SSE และ JSON ล้วน — ที่ล็อกคือ
    // **ต้องเป็นรูปที่เรารู้จักและมีคนวัด** ถ้าวันหนึ่งตอบเป็นรูปที่สาม ข้อนี้แดง
    const known = ["text/event-stream", "application/json"];
    const measured = async (token: string) => {
      const type = (await call("/mcp-readonly", token, CONTEXT_CALL)).headers.get("content-type");
      return type !== null && known.some((t) => type.includes(t));
    };

    return {
      connector_id_not_derived: got.ok === false && got.reason === "connector_mismatch",
      jwks_source_declared: sourceGuard,
      response_format_asserted: (await measured(RO)) && (await measured("not-a-real-token")),
      config_incomplete_fails_boot:
        broken.status === 500 &&
        body.error === "server_misconfigured" &&
        (body.detail ?? "").includes("GATEWAY_CONNECTOR_ID"),
    };
  }

  it("รายการที่ต้องประกาศ ตรงกับของต้นทางไม่ขาดไม่เกิน", async () => {
    const required = required_.attestations.map((a) => a.id).sort();
    expect(Object.keys(await prove()).sort()).toEqual(required);
  });

  it("ทุกข้อพิสูจน์ผ่าน จึงประกาศได้", async () => {
    const proved = await prove();
    const failed = Object.entries(proved)
      .filter(([, ok]) => !ok)
      .map(([id]) => id);

    expect(failed, `ประกาศไม่ได้: ${failed.join(", ")}`).toEqual([]);
  });
});

/**
 * รูปของบรรทัดบันทึกฝั่ง upstream
 *
 * `cid` กับ `ops` อยู่ในบันทึกเพราะเป็น**ฐานที่ใช้ตัดสิน** ไม่ใช่สิ่งที่ผู้เรียกส่งมา
 * ให้ประมวลผล — ถ้าไม่มีสองค่านี้ บันทึกบอกได้แค่ว่าใครเข้ามา บอกไม่ได้ว่าทำไมถึงให้เข้า
 *
 * ขอโดย ai-tools-mcp/ChatGPT ที่ dis-514ae7a7 seq 35 เพื่อปิด acceptance ข้อสุดท้าย
 */
describe("บรรทัดบันทึกของ upstream", () => {
  it("เส้น JWT ลง actor ที่ตรวจแล้ว พร้อม cid และ ops ที่ใช้ตัดสิน", () => {
    const line = auditActor({
      ok: true,
      identity: { name: "oidc:conformance-subject", source: "jwt" },
      principal: { sub: "oidc:conformance-subject", ops: ["read"], cid: "collab-readonly-test" },
    });

    expect(line.actor).toBe("jwt:oidc:conformance-subject");
    expect(line.actor_resolved).toBe(true);
    expect(line.authn_method).toBe("gateway_jwt_rs256");
    expect(line.cid).toBe("collab-readonly-test");
    expect(line.ops).toEqual(["read"]);
  });

  /**
   * `cor` ลงเฉพาะเมื่อโทเคนพามา — ไม่ลงค่าว่างเมื่อไม่มี เพราะช่องที่มีอยู่เสมอ
   * แต่ว่างบ่อย ทำให้คนอ่านแยกไม่ออกว่าไม่มีค่า หรือมีค่าแต่เป็นค่าว่าง
   */
  it("cor ลงเมื่อโทเคนพามา และไม่มีช่องนั้นเลยเมื่อไม่มี", () => {
    const withCor = auditActor({
      ok: true,
      identity: { name: "s", source: "jwt" },
      principal: { sub: "s", ops: ["read"], cid: "c", cor: "6c2b4ae4" },
    });
    const without = auditActor({
      ok: true,
      identity: { name: "s", source: "jwt" },
      principal: { sub: "s", ops: ["read"], cid: "c" },
    });

    expect(withCor.cor).toBe("6c2b4ae4");
    expect(without).not.toHaveProperty("cor");
  });

  /**
   * รหัสบอกได้ว่าใบไหนเข้ามา บอกไม่ได้ว่าใครถือ — โทเคนส่งต่อกันได้
   * และเส้นนี้ไม่มี principal จึงไม่มี cid/ops ให้ลง ไม่ใช่ลงค่าว่าง
   */
  it("เส้น static ลง actor เป็น null และไม่มี cid/ops", () => {
    const line = auditActor({
      ok: true,
      identity: { name: "test-team-readonly", source: "token" },
    });

    expect(line.actor).toBeNull();
    expect(line.actor_resolved).toBe(false);
    expect(line.authn_method).toBe("static_readonly_token");
    expect(line).not.toHaveProperty("cid");
    expect(line).not.toHaveProperty("ops");
  });

  /**
   * ห้ามมีเนื้อหา อาร์กิวเมนต์ โทเคน หรือ PII — ตรวจด้วยบัญชีขาวของชื่อช่อง
   * ไม่ใช่บัญชีดำ เพราะบัญชีดำกันได้แค่คำที่นึกออกตอนเขียน
   */
  it("ไม่มีช่องอื่นนอกจากที่ประกาศไว้", () => {
    const allowed = ["actor", "actor_resolved", "authn_method", "cid", "ops", "cor"];
    const line = auditActor({
      ok: true,
      identity: { name: "x", source: "jwt" },
      principal: { sub: "x", ops: ["read"], cid: "c", team: "t", roles: ["r"], cor: "abc" },
    });

    expect(Object.keys(line).filter((k) => !allowed.includes(k))).toEqual([]);
  });
});

/**
 * ยืนยันว่าเราตอบรูปไหน — ไม่ใช่เพื่อล็อกค่า แต่เพื่อให้การเปลี่ยนมองเห็นได้
 *
 * ภัยข้อ 21 ของฝั่ง gateway เกิดจากเขาประกาศ `Accept` รับสองรูปแต่อ่านได้รูปเดียว
 * ส่วนฝั่งเราเป็นอีกครึ่งของเรื่องเดียวกัน — เทสต์ทั้งหมดอ่านผลด้วยตัวช่วยที่แกะ
 * SSE frame มาตั้งแต่ไฟล์แรก จึงไม่เคยมีเทสต์ไหนยืนยันว่า content-type ที่เราตอบ
 * คืออะไร ถ้าวันหนึ่งเปลี่ยนไปตอบ JSON ล้วน เทสต์เดิมจะยังเขียวทั้งชุด
 *
 * ไม่ผูกว่าต้องเป็นรูปไหนในสัญญา เพราะ MCP อนุญาตทั้งสองและการบังคับจะแคบกว่าสเปก
 * สิ่งที่ผูกคือ **ต้องมีใครสักคนวัด** ซึ่งทำให้การเปลี่ยนเป็นการเปลี่ยนที่มีคนเห็น
 *
 * ตกลงกับ trueforge ที่ dis-514ae7a7 seq 38–39 · ประกาศเป็น `response_format_asserted`
 */
describe("รูปของคำตอบที่เราส่งออกไป", () => {
  it("เส้นอ่านตอบ text/event-stream และถ้าเปลี่ยนต้องมีคนเห็น", async () => {
    const response = await call("/mcp-readonly", RO, CONTEXT_CALL);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("เส้นปกติตอบรูปเดียวกัน ไม่ได้ต่างกันตามเส้นทาง", async () => {
    const response = await call("/mcp", RW, CONTEXT_CALL);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  /**
   * คำตอบที่ไม่ใช่ผลของ tool เป็น JSON ล้วน — คนละเรื่องกับ transport ของ MCP
   * แยกไว้ให้ชัดเพราะถ้าไม่แยก คนอ่านจะเข้าใจว่าทุกคำตอบเป็น SSE
   */
  it("คำปฏิเสธเป็น JSON ไม่ใช่ SSE", async () => {
    const response = await call("/mcp-readonly", "not-a-real-token", CONTEXT_CALL);

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

/**
 * ฟีเจอร์ของสองสายที่พัฒนาแยกกัน มาเจอกันครั้งแรกตรงนี้
 *
 * `health` กับ `quiet_for_days` ถูกเขียนบน branch ที่ไม่มีเส้น `/mcp-readonly` อยู่เลย
 * ส่วนเส้นนี้ถูกเขียนบน branch ที่ยังไม่มีสองอย่างนั้น · เทสต์ของทั้งสองฝั่งเขียวครบ
 * ตอนอยู่แยกกัน ซึ่งพิสูจน์ไม่ได้เลยว่ารวมกันแล้วเป็นอย่างไร
 *
 * `devfactory-core` เขียนไว้ที่ `dis-b492ed20` ว่าสามรอบล่าสุดของ ecosystem นี้ ของที่
 * เจอมาจากการที่อีกทีมเอาของจริงไปรันแล้วชน ไม่ได้มาจากการอ่านสัญญาละเอียดขึ้น และ
 * ตัวร่วมคือ **fixture ที่เล็กกว่าของจริง** — สองสายที่ไม่เคยถูกรันรวมกันเป็นรูปเดียวกัน
 */
describe("ภาพรวมบนเส้นอ่าน ได้ของชุดเดียวกับเส้นปกติ", () => {
  interface Overview {
    open_items: { health: Record<string, unknown> };
    quiet_discussions: { threshold_days: number | null; hidden: number };
  }

  async function context(args: Record<string, unknown>): Promise<Overview> {
    const body = await payload(
      await call("/mcp-readonly", RO, {
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: { name: "get_workspace_context", arguments: args },
      }),
    );
    const text = (body.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
    return JSON.parse(text ?? "{}") as Overview;
  }

  it("health มาถึงเส้นอ่านครบทุกช่อง ไม่ได้หายไปเพราะเส้นทาง", async () => {
    const result = await context({ limit: 1 });

    expect(Object.keys(result.open_items.health).sort()).toEqual([
      "delegated",
      "handoffs",
      "open_tasks",
      "unseen_targets",
    ]);
  });

  it("ตัวกรองกระทู้ทำงานบนเส้นอ่านด้วย และไม่กรองเมื่อไม่ได้ขอ", async () => {
    expect((await context({ limit: 1 })).quiet_discussions).toEqual({
      threshold_days: null,
      hidden: 0,
    });
    expect((await context({ limit: 1, quiet_for_days: 30 })).quiet_discussions.threshold_days).toBe(
      30,
    );
  });

  /**
   * ข้อนี้คือเหตุผลที่ต้องมีเทสต์ตรงนี้จริง ๆ — เส้นอ่านซ่อน tool ที่เขียนได้ และ
   * `health` เป็นของใหม่ที่เพิ่งโผล่ในผลลัพธ์ ถ้ามันพาชื่อ tool ที่ถูกซ่อนกลับเข้ามา
   * โดยอ้อม การซ่อนก็ไม่มีความหมาย · วันนี้ไม่พา และอยากให้ยังไม่พาต่อไป
   */
  it("ของใหม่ในผลลัพธ์ไม่ได้พา tool ที่ถูกซ่อนกลับเข้ามา", async () => {
    const result = await context({ limit: 1 });
    const text = JSON.stringify(result.open_items.health);

    for (const tool of WRITE_TOOLS) expect(text).not.toContain(tool);
  });
});
