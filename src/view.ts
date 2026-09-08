/**
 * หน้าอ่านอย่างเดียวสำหรับคน
 *
 * มีเพราะทุกอย่างในระบบนี้ออกแบบให้ AI อ่านผ่าน tool ส่วนคนที่อยากดูว่าคุยอะไรกันไป
 * ต้องมี MCP client สักตัวก่อน ซึ่งเป็นด่านที่ไม่มีเหตุผลสำหรับการอ่านเฉย ๆ
 *
 * **อ่านอย่างเดียวโดยตั้งใจ** ไม่มีปุ่ม ไม่มีฟอร์ม ไม่มี JavaScript — การเขียนทุกชนิด
 * ยังต้องผ่าน tool เท่านั้น ด้วยเหตุผลเดิมที่บันทึกไว้ตอนตัดสินใจว่าจะไม่ทำหน้าเว็บ
 * สำหรับปิด decision คือผู้กระทำต้องมาจาก connection ที่พิสูจน์ได้ ไม่ใช่จากปุ่มบนหน้าเว็บ
 * ที่ใครกดก็ได้
 *
 * ไม่มี JavaScript เลยสักบรรทัด และไม่มี asset ภายนอก หน้าเว็บจึงเป็น HTML ที่ server
 * ประกอบเสร็จแล้วส่งไปก้อนเดียว
 */

import { readMessages, readWorkspaceContext, getDiscussion } from "./db";
import { readOpenItems } from "./db-work";
import { secretsMatch } from "./http";
import type { Env } from "./env";
import { DEFAULT_WORKSPACE } from "./env";

export const VIEW_ROUTE = "/view";

/** เพดานข้อความต่อหน้า สูงกว่าฝั่ง tool เพราะคนอ่านทีเดียวจบดีกว่าไล่กดหน้า */
const MESSAGE_LIMIT = 500;
const DISCUSSION_LIMIT = 100;

const COOKIE = "collab_view";

/**
 * หนีอักขระของ HTML ทุกจุดที่เอาข้อมูลจาก database มาแสดง
 *
 * เนื้อหาทั้งหมดในตารางมาจาก AI ภายนอกซึ่งเขียนอะไรก็ได้ และเคยมีข้อความที่มี markdown
 * กับ backtick ปนมาแล้ว ถ้าไม่หนี ข้อความเดียวก็แทรกสคริปต์ลงหน้าที่คนอื่นเปิดได้
 */
function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** เวลาไทยแบบสั้น ให้คนกวาดตาได้ ไม่ใช่ ISO เต็มที่อ่านยาก */
function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}`;
}

const STYLE = `
:root { color-scheme: light dark; --line: #d8d8d8; --muted: #6b6b6b; --bg: #fff; --fg: #1a1a1a; --card: #fafafa; }
@media (prefers-color-scheme: dark) {
  :root { --line: #333; --muted: #999; --bg: #131313; --fg: #e8e8e8; --card: #1c1c1c; }
}
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 24px 16px 64px; max-width: 820px; background: var(--bg); color: var(--fg);
  font: 15px/1.65 ui-sans-serif, -apple-system, "Segoe UI", "Noto Sans Thai", sans-serif; }
a { color: inherit; }
h1 { font-size: 19px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 0 0 6px; font-weight: 600; }
.muted { color: var(--muted); font-size: 13px; }
.bar { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 10px 14px; margin: 16px 0 24px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--card); font-size: 13px; }
.bar b { font-weight: 600; }
.row { display: block; padding: 14px 0; border-top: 1px solid var(--line); text-decoration: none; }
.row:hover h2 { text-decoration: underline; }
.msg { padding: 18px 0; border-top: 1px solid var(--line); }
.msg header { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; margin-bottom: 8px; font-size: 13px; }
.who { font-weight: 600; font-size: 14px; }
.kind { border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; font-size: 11px; color: var(--muted); }
.body { white-space: pre-wrap; overflow-wrap: anywhere; }
.top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.note { margin-top: 24px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--card); font-size: 13px; color: var(--muted); }
`;

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="th"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="robots" content="noindex,nofollow">` +
      `<title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

function renderList(
  context: Awaited<ReturnType<typeof readWorkspaceContext>>,
  open: Awaited<ReturnType<typeof readOpenItems>>,
  workspace: string,
): Response {
  const tasks = Object.entries(open.tasks)
    .map(([status, n]) => `${esc(status)} ${n}`)
    .join(" · ");

  const rows = context.discussions
    .map(
      (d) =>
        `<a class="row" href="${VIEW_ROUTE}/${esc(d.id)}?ws=${esc(workspace)}">` +
        `<h2>${esc(d.title)}</h2>` +
        `<div class="muted">${d.message_count} ข้อความ · เปิดโดย ${esc(d.created_by)} · ` +
        `ล่าสุด ${when(d.last_activity)}</div>` +
        `<div class="muted">${esc(d.participants.join(" · "))}</div></a>`,
    )
    .join("");

  const other = workspace === DEFAULT_WORKSPACE ? "ws-test" : DEFAULT_WORKSPACE;

  return page(
    `${context.workspace.name} — ai-collab`,
    `<div class="top"><h1>${esc(context.workspace.name)}</h1>` +
      `<a class="muted" href="${VIEW_ROUTE}?ws=${esc(other)}">ดู ${esc(other)} →</a></div>` +
      `<div class="muted">${esc(context.workspace.id)} · ${context.total_discussions} กระทู้ · ` +
      `${context.participants.length} ผู้ร่วม</div>` +
      `<div class="bar">` +
      `<span><b>${open.decisions_awaiting}</b> decision รอเคาะ</span>` +
      `<span><b>${open.handoffs_pending}</b> handoff รอคนรับ</span>` +
      `<span><b>${open.handoffs_inactive}</b> handoff ตกยุค</span>` +
      `<span>งานค้าง: ${tasks || "ไม่มี"}</span>` +
      `<span>contract 2</span>` +
      `</div>` +
      rows +
      (context.has_more
        ? `<div class="note">แสดง ${context.discussions.length} จาก ${context.total_discussions} กระทู้</div>`
        : "") +
      `<div class="note">หน้านี้อ่านอย่างเดียว การเขียนทุกชนิดยังต้องผ่าน MCP tool เท่านั้น</div>`,
  );
}

async function renderDiscussion(
  env: Env,
  id: string,
  workspace: string,
): Promise<Response> {
  const discussion = await getDiscussion(env.DB, id);
  const page_ = await readMessages(env.DB, id, 0, MESSAGE_LIMIT);

  const messages = page_.messages
    .map(
      (m) =>
        `<div class="msg"><header>` +
        `<span class="who">${esc(m.author_name)}</span>` +
        `<span class="kind">${esc(m.kind)}</span>` +
        `<span class="muted">#${m.seq}${
          m.in_reply_to ? ` ↩ #${m.in_reply_to}` : ""
        } · ${when(m.created_at)}</span>` +
        `</header><div class="body">${esc(m.body)}</div></div>`,
    )
    .join("");

  return page(
    `${discussion.title} — ai-collab`,
    `<div class="top"><h1>${esc(discussion.title)}</h1>` +
      `<a class="muted" href="${VIEW_ROUTE}?ws=${esc(workspace)}">← กลับ</a></div>` +
      `<div class="muted">เปิดโดย ${esc(discussion.created_by)} · ${when(discussion.created_at)} · ` +
      `${page_.total} ข้อความ</div>` +
      messages +
      (page_.has_more
        ? `<div class="note">แสดง ${page_.messages.length} จาก ${page_.total} ข้อความ</div>`
        : ""),
  );
}

/**
 * รหัสผ่านของหน้านี้แยกจาก `MCP_AUTH_TOKEN` โดยตั้งใจ
 *
 * รหัสของ MCP เขียนได้ ส่วนรหัสของหน้านี้อ่านได้อย่างเดียว ถ้าใช้ตัวเดียวกันแล้วลิงก์
 * หลุดไปอยู่ในแชตหรือประวัติเบราว์เซอร์ คนที่ได้ไปจะเขียนลงโต๊ะได้ด้วย
 *
 * ไม่ตั้งค่า = ไม่มีหน้านี้ ไม่ใช่เปิดโล่ง
 */
type AuthResult = "ok" | "no_key" | "wrong_key";

async function authorized(request: Request, env: Env): Promise<AuthResult> {
  if (!env.VIEW_TOKEN) return "no_key";

  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("key");
  if (fromQuery) {
    return (await secretsMatch(fromQuery, env.VIEW_TOKEN)) ? "ok" : "wrong_key";
  }

  // เผื่อทดสอบด้วย curl ซึ่งส่ง header ได้ตรง ๆ โดยไม่ผ่านการตีความของ query string
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    return (await secretsMatch(bearer, env.VIEW_TOKEN)) ? "ok" : "wrong_key";
  }

  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);

  if (!cookie) return "no_key";
  return (await secretsMatch(decodeURIComponent(cookie), env.VIEW_TOKEN))
    ? "ok"
    : "wrong_key";
}

/**
 * หน้าอ่านของคน — คืน null เมื่อเส้นทางไม่ใช่ของหน้านี้ เพื่อให้ Worker ส่งต่อไป OAuth
 */
export async function handleView(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== VIEW_ROUTE && !url.pathname.startsWith(`${VIEW_ROUTE}/`)) return null;

  if (!env.VIEW_TOKEN) {
    return page(
      "ปิดอยู่",
      `<h1>หน้านี้ยังไม่ได้เปิด</h1><div class="muted">ตั้ง VIEW_TOKEN ก่อนใช้งาน — ` +
        `<code>wrangler secret put VIEW_TOKEN</code></div>`,
    );
  }

  // แยกสองกรณีให้ชัด เพราะ "ไม่ได้ส่งรหัสมา" กับ "ส่งมาแล้วไม่ตรง" ต้องแก้คนละแบบ
  // และรหัสที่มี + / = ในลิงก์จะถูก query string ตีความจนไม่ตรงโดยไม่มีใครรู้ตัว —
  // อาการเดียวกับชื่อที่ถูกตัดเงียบซึ่ง repo นี้ไล่แก้มาตั้งแต่ต้น
  const auth = await authorized(request, env);
  if (auth !== "ok") {
    const detail =
      auth === "wrong_key"
        ? "รหัสไม่ตรง ถ้ารหัสมี + / = อยู่ ตัวอักษรเหล่านั้นถูกตีความในลิงก์จนค่าเพี้ยน " +
          "ให้ใช้รหัสที่เป็นตัวอักษรกับตัวเลขล้วน หรือส่งมาทาง Authorization: Bearer แทน"
        : "ยังไม่ได้ส่งรหัสมา เปิดด้วยลิงก์ที่มี ?key= ต่อท้าย";
    return new Response(
      `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>เข้าดูไม่ได้</title>` +
        `<style>${STYLE}</style></head><body><h1>เข้าดูไม่ได้</h1>` +
        `<div class="muted">${esc(detail)}</div></body></html>`,
      { status: 401, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  // รหัสมาทาง query แล้วถูกต้อง จำไว้ใน cookie แล้วส่งกลับไปที่ URL เดิมแบบไม่มีรหัส
  // ลิงก์ที่คนก็อปส่งต่อจึงไม่พารหัสไปด้วยโดยไม่ได้ตั้งใจ
  if (url.searchParams.get("key")) {
    const clean = new URL(url);
    clean.searchParams.delete("key");
    return new Response(null, {
      status: 302,
      headers: {
        location: clean.pathname + clean.search,
        "set-cookie":
          `${COOKIE}=${encodeURIComponent(env.VIEW_TOKEN)}; Path=${VIEW_ROUTE}; ` +
          "HttpOnly; Secure; SameSite=Strict; Max-Age=604800",
      },
    });
  }

  const workspace = url.searchParams.get("ws")?.trim() || DEFAULT_WORKSPACE;
  const id = url.pathname.slice(VIEW_ROUTE.length + 1);

  try {
    if (id) return await renderDiscussion(env, id, workspace);

    const [context, open] = await Promise.all([
      readWorkspaceContext(env.DB, workspace, DISCUSSION_LIMIT),
      // ชื่อว่างโดยตั้งใจ — หน้านี้ไม่มีตัวตนของผู้เรียก จึงไม่มี waiting_for_you
      // ให้แสดง ตัวเลขที่เหลือเป็นของทั้ง workspace ซึ่งเป็นสิ่งที่คนอ่านอยากรู้
      readOpenItems(env.DB, workspace, ""),
    ]);
    return renderList(context, open, workspace);
  } catch (error) {
    // ไม่พบ workspace หรือ discussion เป็นคำขอที่ผิด ไม่ใช่ระบบพัง
    return page(
      "ไม่พบ",
      `<h1>ไม่พบสิ่งที่ขอ</h1><div class="muted">${esc(
        error instanceof Error ? error.message : String(error),
      )}</div><p><a href="${VIEW_ROUTE}">← กลับหน้ารายการ</a></p>`,
    );
  }
}
