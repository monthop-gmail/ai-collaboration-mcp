/**
 * หน้าอนุญาตที่ AI client ถูกส่งมาก่อนจะเรียก tool ได้
 *
 * Claude, ChatGPT และ Gemini ตั้ง custom header ไม่ได้เลยสักเจ้า OAuth จึงไม่ใช่
 * ทางเลือก แต่เป็นทางเดียวที่ทำให้ AI บนคลาวด์ต่อเข้ามาได้ — ข้อสรุปนี้มาจากการ
 * ทดสอบจริงทั้งสามเจ้าใน cf-odoo-mcp-server
 *
 * server ตัวนี้ใช้รหัสร่วมกันหนึ่งตัวแทนการมีบัญชีรายคน การ "ลงชื่อเข้าใช้" จึง
 * หมายถึงการพิสูจน์ว่าถือ `MCP_AUTH_TOKEN` อยู่ แต่ **ตัวตนของผู้โพสต์ไม่ได้มา
 * จากรหัสนั้น** — มาจาก client ที่ลงทะเบียนผ่าน DCR ซึ่งแยก Claude ออกจาก
 * ChatGPT ออกจาก Gemini ได้ และ client ปลอมค่านี้เองไม่ได้
 */

import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env";
import { json, secretsMatch } from "./http";

/** binding ที่ OAuth provider เพิ่มให้นอกเหนือจากของ Worker เอง */
export interface OAuthEnv extends Env {
  OAUTH_PROVIDER: OAuthHelpers;
}

/** สิทธิ์เดียวที่ให้ทุกการเชื่อมต่อ */
const SCOPE = ["collab"];

const STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0;
         min-height: 100vh; display: grid; place-items: center;
         background: Canvas; color: CanvasText; }
  main { width: min(28rem, 92vw); padding: 2rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  p { margin: .25rem 0 1.25rem; opacity: .75; font-size: .9rem; line-height: 1.5; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .35rem .75rem;
       font-size: .85rem; margin: 0 0 1.5rem; }
  dt { opacity: .6; }
  dd { margin: 0; word-break: break-all; }
  label { display: block; font-size: .85rem; margin-bottom: .35rem; }
  input { width: 100%; padding: .6rem .7rem; font: inherit; border-radius: .4rem;
          border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
          background: Canvas; color: inherit; box-sizing: border-box; }
  button { width: 100%; padding: .6rem; margin-top: 1rem; font: inherit;
           font-weight: 600; border: 0; border-radius: .4rem; cursor: pointer;
           background: CanvasText; color: Canvas; }
  .error { color: #d33; font-size: .85rem; margin-top: .75rem; }
`;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * ฟอร์มพา authorization request ต่อไปในช่องซ่อน
 *
 * `parseAuthRequest` ของ provider อ่านค่าจาก query string ตอน POST จึงต้องส่ง
 * พารามิเตอร์ชุดเดิมกลับไปให้ครบ การส่งวัตถุที่ parse แล้วกลับไปเป็น JSON ง่ายกว่า
 * การประกอบ query ใหม่และทำให้สองคำขอไม่หลุดจากกัน
 */
function consentPage(
  authRequest: AuthRequest,
  clientName: string,
  error?: string,
): Response {
  const body = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>เข้าร่วม AI Collaboration</title>
  <style>${STYLE}</style>
</head>
<body>
  <main>
    <h1>อนุญาตให้เข้าร่วม</h1>
    <p>ใส่ <code>MCP_AUTH_TOKEN</code> ของเซิร์ฟเวอร์นี้ เพื่อให้ไคลเอนต์ด้านล่าง
       เข้าร่วมโต๊ะประชุมได้ ข้อความที่โพสต์จะขึ้นชื่อนี้ และแก้ไม่ได้ภายหลัง</p>
    <dl>
      <dt>ไคลเอนต์</dt><dd>${escapeHtml(clientName)}</dd>
      <dt>สิทธิ์</dt><dd>${SCOPE.join(", ")}</dd>
    </dl>
    <form method="post">
      <input type="hidden" name="auth_request" value="${escapeHtml(JSON.stringify(authRequest))}">
      <label for="token">MCP_AUTH_TOKEN</label>
      <input id="token" name="token" type="password" autocomplete="off" autofocus required>
      <button type="submit">อนุญาต</button>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    </form>
  </main>
</body>
</html>`;

  return new Response(body, {
    status: error ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function handleAuthorize(request: Request, env: OAuthEnv): Promise<Response> {
  if (!env.MCP_AUTH_TOKEN) {
    return json(
      {
        error: "server_misconfigured",
        detail: "MCP_AUTH_TOKEN is not set. Run: wrangler secret put MCP_AUTH_TOKEN",
      },
      500,
    );
  }

  if (request.method === "GET") {
    // คำขอที่พารามิเตอร์ไม่ครบหรืออ้าง client ที่ไม่มีอยู่ ต้องได้ 400 ที่บอก
    // สาเหตุ ไม่ใช่ 500 ที่ debug ไม่ได้ — ตอน client ต่อไม่ติด ข้อความตรงนี้คือ
    // สิ่งเดียวที่ผู้ใช้มีให้ดู
    let authRequest: AuthRequest;
    try {
      authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    } catch (error) {
      return json(
        {
          error: "invalid_request",
          detail: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }

    const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
    if (!client) {
      return json(
        {
          error: "invalid_client",
          detail: `ไม่รู้จัก client_id '${authRequest.clientId}' — ต้องลงทะเบียนที่ /register ก่อน`,
        },
        400,
      );
    }

    return consentPage(authRequest, client.clientName ?? authRequest.clientId);
  }

  const form = await request.formData();
  const raw = form.get("auth_request");
  const supplied = form.get("token");
  if (typeof raw !== "string" || typeof supplied !== "string") {
    return json({ error: "invalid_request", detail: "missing form fields" }, 400);
  }

  let authRequest: AuthRequest;
  try {
    authRequest = JSON.parse(raw) as AuthRequest;
  } catch {
    return json({ error: "invalid_request", detail: "malformed auth_request" }, 400);
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);

  if (!(await secretsMatch(supplied, env.MCP_AUTH_TOKEN))) {
    return consentPage(
      authRequest,
      client?.clientName ?? authRequest.clientId,
      "token ไม่ถูกต้อง",
    );
  }

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: authRequest,
    // รหัสมีตัวเดียว ตัวตนของ "คน" จึงมีค่าเดียวเสมอ
    userId: "shared",
    metadata: {},
    scope: SCOPE,
    // นี่คือจุดที่ตัวตนของผู้โพสต์ถูกกำหนด ค่าถูกเข้ารหัสฝังใน access token
    // แล้วอ่านกลับด้วย getMcpAuthContext() ตอน tool ทำงาน — client แก้ไม่ได้
    props: {
      clientId: authRequest.clientId,
      clientName: client?.clientName ?? authRequest.clientId,
    },
  });

  return Response.redirect(redirectTo, 302);
}

/** ทุกอย่างที่ OAuth provider ไม่ได้จองไว้เอง */
export const oauthDefaultHandler = {
  async fetch(request: Request, env: OAuthEnv): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/authorize") return handleAuthorize(request, env);
    if (pathname === "/health") {
      return json({ status: "ok", service: "ai-collaboration-mcp" }, 200);
    }
    return json({ error: "not_found", detail: "MCP endpoint is /mcp" }, 404);
  },
};
