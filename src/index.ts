import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler, type StatelessMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { registerTools } from "./tools";
import { oauthDefaultHandler, type OAuthEnv } from "./oauth";
import { json, secretsMatch } from "./http";
import type { Env } from "./env";

const MCP_ROUTE = "/mcp";

/**
 * factory ของ server ไม่ได้รับ env แต่ละ handler จึงปิดทับ env ที่สร้างมันมา
 * การใช้ตัว env เองเป็น key ทำให้ closure นั้นไม่โกหก — คำขอที่ถือ env คนละตัว
 * (runtime ไม่รับประกันว่าจะมีตัวเดียว และ OAuth provider ส่งสำเนาที่เติมของ
 * ตัวเองเข้าไป) จะสร้าง handler ของตัวเองแทนการใช้ตัวที่ผูกกับ binding ผิด
 */
const handlers = new WeakMap<object, StatelessMcpHandler>();

function getHandler(env: Env): StatelessMcpHandler {
  let handler = handlers.get(env as object);
  if (!handler) {
    handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: "ai-collaboration", version: "0.1.0" });
        registerTools(server, env);
        return server;
      },
      { route: MCP_ROUTE, ...originOptions(env) },
    );
    handlers.set(env as object, handler);
  }
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

const mcpApiHandler = {
  fetch(request: Request, env: OAuthEnv, ctx: ExecutionContext): Promise<Response> {
    return getHandler(env)(request, env, ctx);
  },
};

/**
 * มีสองทางเข้าเพราะ client ส่งของได้ไม่เท่ากัน
 *
 * Claude Code, Codex และอะไรก็ตามที่ขับด้วย curl แนบ `Authorization` เองได้ จึงใช้
 * รหัสร่วมตรง ๆ ส่วน AI chat บนคลาวด์ทำไม่ได้ ต้องผ่าน OAuth ทั้งสองทางไปจบที่
 * handler เดียวกัน แต่ **ได้ตัวตนคนละแบบ** — ทางแรกไม่มี identity จาก DCR ให้อ่าน
 */
async function hasStaticBearer(request: Request, env: Env): Promise<boolean> {
  if (!env.MCP_AUTH_TOKEN) return false;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;
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

    if (pathname === MCP_ROUTE) {
      // ปฏิเสธการให้บริการดีกว่าเปิดโล่งเมื่อยังไม่ได้ตั้งรหัส ถ้าไม่มีค่านี้
      // OAuth ก็ออก grant ไม่ได้อยู่ดีเพราะหน้า consent ต้องใช้
      if (!env.MCP_AUTH_TOKEN) {
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

    // ที่เหลือเป็นของ provider — endpoint ของ OAuth, discovery metadata, หน้า
    // consent, /health และ /mcp ที่ไม่มี static bearer ซึ่งจะได้ 401 พร้อม
    // `WWW-Authenticate` ที่ client ใช้หา metadata ต่อ
    return getProvider().fetch(request, env, ctx);
  },
};
