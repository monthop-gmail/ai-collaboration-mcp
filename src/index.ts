import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler, type StatelessMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { registerTools } from "./tools";
import { oauthDefaultHandler, type OAuthEnv } from "./oauth";
import { json, secretsMatch } from "./http";
import { handleView } from "./view";
import { nameForToken, staticIdentityFor, type StaticIdentity } from "./identity";
import { withReadOnlyGuard } from "./readonly";
import type { Env } from "./env";

const MCP_ROUTE = "/mcp";

/**
 * เส้นทางอ่านอย่างเดียว แยก path และแยกรหัสจากเส้นปกติ
 *
 * แยกทั้งสองอย่างเพราะถ้าแยกแค่ path รหัสใบเดียวก็ยังเดินได้ทั้งสองทาง ขอบเขต
 * ความเชื่อถือจึงไม่มีอยู่จริง — การผูกนี้คือรหัส → เส้นทาง/ความสามารถ ไม่ใช่
 * รหัส → ตัวตนของคน ซึ่งเป็นคนละเรื่องกับที่ยังพักไว้
 */
const MCP_READONLY_ROUTE = "/mcp-readonly";

/**
 * factory ของ server ไม่ได้รับ env แต่ละ handler จึงปิดทับ env ที่สร้างมันมา
 * การใช้ตัว env เองเป็น key ทำให้ closure นั้นไม่โกหก — คำขอที่ถือ env คนละตัว
 * (runtime ไม่รับประกันว่าจะมีตัวเดียว และ OAuth provider ส่งสำเนาที่เติมของ
 * ตัวเองเข้าไป) จะสร้าง handler ของตัวเองแทนการใช้ตัวที่ผูกกับ binding ผิด
 *
 * ชั้นในเป็นชื่อที่มากับคำขอ ด้วยเหตุผลเดียวกัน — handler ปิดทับชื่อนั้นไว้ ถ้าใช้
 * handler ร่วมกันทุกชื่อ คำขอจาก Manus จะได้ชื่อของคนก่อนหน้า
 */
const handlers = new WeakMap<object, Map<string, StatelessMcpHandler>>();

/**
 * เพดานจำนวน handler ที่เก็บไว้ต่อ env
 *
 * ชื่อมาจาก header ที่ client ตั้งเองได้ ถ้าไม่จำกัด ผู้ที่ถือ token สามารถสร้าง
 * handler ใหม่ไม่รู้จบด้วยการเปลี่ยนชื่อทุกคำขอ เกินเพดานแล้วยังทำงานถูกต้อง
 * เพียงแต่สร้างใหม่ทุกครั้งแทนการใช้ของเดิม
 */
const MAX_CACHED_HANDLERS = 32;

function getHandler(env: Env, identity?: StaticIdentity, readOnly = false): StatelessMcpHandler {
  let byIdentity = handlers.get(env as object);
  if (!byIdentity) {
    byIdentity = new Map();
    handlers.set(env as object, byIdentity);
  }

  // เส้นทางเป็นส่วนหนึ่งของ key ไม่งั้น handler ที่ถูก cache ไว้จากเส้นหนึ่งจะถูก
  // หยิบไปใช้กับอีกเส้น แล้ว server ที่ปิด tool ไว้จะกลายเป็นเปิด
  const key = `${readOnly ? "ro" : "rw"}|${identity ? `${identity.source}:${identity.name}` : ""}`;
  const cached = byIdentity.get(key);
  if (cached) return cached;

  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: "ai-collaboration", version: "0.1.0" });
      registerTools(readOnly ? withReadOnlyGuard(server) : server, env, identity);
      return server;
    },
    { route: readOnly ? MCP_READONLY_ROUTE : MCP_ROUTE, ...originOptions(env) },
  );

  if (byIdentity.size < MAX_CACHED_HANDLERS) byIdentity.set(key, handler);
  return handler;
}

/**
 * ปฏิเสธ browser เป็นค่าตั้งต้น handler จะเชื่อแค่ localhost กับ hostname
 * `workers.dev` ของตัวเอง การไม่คืนอะไรเลยคือการคงค่าตั้งต้นนั้นไว้
 */
function originOptions(env: Env): { allowedOriginHostnames?: string[] | "*" } {
  const raw = env.ALLOWED_ORIGIN_HOSTNAMES?.trim();
  if (!raw) return {};
  if (raw === "*") return { allowedOriginHostnames: "*" };

  const hostnames = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  return hostnames.length > 0 ? { allowedOriginHostnames: hostnames } : {};
}

/** โทเค็นที่แนบมาในคำขอ ถ้ามี */
function bearerToken(request: Request): string | undefined {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

async function serveMcp(
  request: Request,
  env: OAuthEnv,
  ctx: ExecutionContext,
  readOnly: boolean,
): Promise<Response> {
    // คำนวณชื่อสำรองให้ทุกคำขอ ไม่ต้องแยกว่ามาทางไหน เพราะ `resolveAuthor` ให้
    // ตัวตนจาก OAuth ชนะเสมอเมื่อมี — ชื่อจาก header หรือจากโทเค็นจึงมีผลเฉพาะ
    // เส้น static bearer ส่วนคำขอที่มาทาง OAuth ถือโทเค็นคนละใบอยู่แล้วจึงไม่ตรง
    // กับรายการนี้และไม่ได้ชื่อจากตรงนี้
    const token = bearerToken(request);
    const tokenName = token ? await nameForToken(token, env.MCP_AUTH_TOKENS) : undefined;
    const identity = staticIdentityFor(request, env.STATIC_CLIENT_NAME, tokenName);

    // ชื่อผิดรูปแบบต้องรู้ทันทีตั้งแต่ต่อไม่ติด ดีกว่าโพสต์ไปเรื่อย ๆ ในชื่อที่
    // ไม่ตรงกับที่ผู้ส่งงานระบุไว้แล้วสงสัยทีหลังว่าทำไมไม่มีงานเข้า
    if (!identity.ok) {
      return json({ error: "invalid_client_name", detail: identity.reason }, 400);
    }

  return getHandler(env, identity.identity, readOnly)(request, env, ctx);
}

const mcpApiHandler = {
  fetch(request: Request, env: OAuthEnv, ctx: ExecutionContext): Promise<Response> {
    return serveMcp(request, env, ctx, false);
  },
};

/**
 * มีสองทางเข้าเพราะ client ส่งของได้ไม่เท่ากัน
 *
 * Claude Code, Codex และอะไรก็ตามที่ขับด้วย curl แนบ `Authorization` เองได้ จึงใช้
 * รหัสร่วมตรง ๆ ส่วน AI chat บนคลาวด์ทำไม่ได้ ต้องผ่าน OAuth ทั้งสองทางไปจบที่
 * handler เดียวกัน แต่ **ได้ตัวตนคนละแบบ** — ทางแรกไม่มี identity จาก DCR ให้อ่าน
 */
/**
 * บันทึกการใช้งานของเส้นอ่านอย่างเดียวเท่าที่ตอบคำถามว่า "หก tool พอไหม"
 *
 * เก็บ: ชื่อ tool ที่ถูกเรียก, ผลว่าผ่านหรือถูกปฏิเสธ, เวลาที่ใช้
 * ไม่เก็บ: argument, เนื้อหา, โทเค็น, ตัวตนของผู้ใช้ และไม่แตะคำขอของเส้นปกติ
 *
 * อ่านชื่อ tool จาก body ซึ่งเป็น JSON-RPC อยู่แล้ว โดย clone request ก่อนเสมอ
 * เพราะ body อ่านได้ครั้งเดียว ถ้าอ่านตรง ๆ handler จะได้ body เปล่า
 */
async function servePilotRoute(
  request: Request,
  env: OAuthEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  let method: string | undefined;
  let tool: string | undefined;
  try {
    const body = (await request.clone().json()) as {
      method?: unknown;
      params?: { name?: unknown };
    };
    method = typeof body.method === "string" ? body.method : undefined;
    tool = typeof body.params?.name === "string" ? body.params.name : undefined;
  } catch {
    // คำขอที่ไม่ใช่ JSON ไม่ต้องบันทึกอะไร ปล่อยให้ handler จัดการต่อ
  }

  const started = Date.now();
  const response = await serveMcp(request, env, ctx, true);

  if (method === "tools/call" || method === "tools/list") {
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "pilot_call",
        method,
        tool,
        status: response.status,
        ms: Date.now() - started,
      }),
    );
  }
  return response;
}

/**
 * รหัสของเส้นอ่านอย่างเดียว อยู่คนละรายการกับรหัสปกติโดยตั้งใจ ใบที่อยู่ในรายการนี้
 * เข้าเส้นปกติไม่ได้ และใบของเส้นปกติก็เข้าเส้นนี้ไม่ได้
 */
async function hasReadOnlyBearer(request: Request, env: Env): Promise<boolean> {
  const token = bearerToken(request);
  if (!token) return false;
  return Boolean(await nameForToken(token, env.MCP_READONLY_TOKENS));
}

async function hasStaticBearer(request: Request, env: Env): Promise<boolean> {
  const token = bearerToken(request);
  if (!token) return false;

  // โทเค็นเฉพาะใบใน `MCP_AUTH_TOKENS` ใช้เข้าได้เท่ากับโทเค็นหลัก ต่างกันแค่ชื่อที่
  // บันทึกให้ ไม่ใช่สิทธิ์ที่ได้ — ระบบนี้ยังไม่มีสิทธิ์แยกตามผู้เรียก
  if (await nameForToken(token, env.MCP_AUTH_TOKENS)) return true;

  if (!env.MCP_AUTH_TOKEN) return false;
  return secretsMatch(token, env.MCP_AUTH_TOKEN);
}

let provider: OAuthProvider<OAuthEnv> | undefined;

function getProvider(): OAuthProvider<OAuthEnv> {
  return (provider ??= new OAuthProvider<OAuthEnv>({
    apiRoute: MCP_ROUTE,
    apiHandler: mcpApiHandler,
    defaultHandler: oauthDefaultHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    // client ลงทะเบียนตัวเองตอนต่อครั้งแรก (RFC 7591) — Claude, ChatGPT และ
    // Gemini ทำแบบนี้ทั้งหมด และเป็นที่มาของชื่อผู้โพสต์
    clientRegistrationEndpoint: "/register",
  }));
}

export default {
  async fetch(request: Request, env: OAuthEnv, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    // หน้าอ่านของคน อยู่นอกเส้นทางของ OAuth ทั้งหมดเพราะมันไม่ใช่ MCP client และ
    // ไม่มีอะไรให้เขียน คืน null เมื่อไม่ใช่เส้นทางของมัน
    const view = await handleView(request, env);
    if (view) return view;

    if (pathname === MCP_ROUTE) {
      // ปฏิเสธการให้บริการดีกว่าเปิดโล่งเมื่อยังไม่ได้ตั้งรหัส ถ้าไม่มีค่านี้
      // OAuth ก็ออก grant ไม่ได้อยู่ดีเพราะหน้า consent ต้องใช้
      if (!env.MCP_AUTH_TOKEN && !env.MCP_AUTH_TOKENS) {
        return json(
          {
            error: "server_misconfigured",
            detail: "MCP_AUTH_TOKEN is not set. Run: wrangler secret put MCP_AUTH_TOKEN",
          },
          500,
        );
      }
      if (await hasStaticBearer(request, env)) {
        return mcpApiHandler.fetch(request, env, ctx);
      }
    }

    if (pathname === MCP_READONLY_ROUTE) {
      // เส้นนี้ไม่ผูกกับ OAuth provider จึงต้องตอบ 401 เองเมื่อรหัสไม่ผ่าน แทนที่จะ
      // ตกไปให้ provider ซึ่งจะพาไปหา flow ของเส้นปกติ
      if (await hasReadOnlyBearer(request, env)) {
        return servePilotRoute(request, env, ctx);
      }
      return json(
        { error: "unauthorized", detail: "read-only route requires a token from MCP_READONLY_TOKENS" },
        401,
        { "WWW-Authenticate": 'Bearer realm="ai-collaboration read-only"' },
      );
    }

    // ที่เหลือเป็นของ provider — endpoint ของ OAuth, discovery metadata, หน้า
    // consent, /health และ /mcp ที่ไม่มี static bearer ซึ่งจะได้ 401 พร้อม
    // `WWW-Authenticate` ที่ client ใช้หา metadata ต่อ
    return getProvider().fetch(request, env, ctx);
  },
};
