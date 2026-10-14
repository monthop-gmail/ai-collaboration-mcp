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
import { EDGES, MISSING } from "./graph";
import {
  readDecisions,
  readGraphStats,
  readHandoffMap,
  readHandoffStateCounts,
  readItemTotals,
  readHandoffs,
  readOpenItems,
  readStandingRuleDetails,
  readTasks,
} from "./db-work";
import { secretsMatch } from "./http";
import { CONTRACT_VERSION } from "./tool-kit";
import type { Env } from "./env";
import { DEFAULT_WORKSPACE } from "./env";

export const VIEW_ROUTE = "/view";

/** เพดานข้อความต่อหน้า สูงกว่าฝั่ง tool เพราะคนอ่านทีเดียวจบดีกว่าไล่กดหน้า */
const MESSAGE_LIMIT = 500;
const DISCUSSION_LIMIT = 100;
const ITEM_LIMIT = 200;

/** เส้นทางของหน้ารวมของค้าง แยกจากหน้ากระทู้เพราะ id ของกระทู้ขึ้นต้นด้วย dis- */
const ITEMS_PATH = "items";

/**
 * หน้าเมืองสามมิติ — **เป็นเส้นทางย่อยของ `/view` โดยจำเป็น ไม่ใช่เพราะสวย**
 *
 * cookie ของหน้านี้ตั้งไว้ `Path=/view` · กติกา path-match ของ cookie คือ cookie-path
 * ต้องเป็น prefix ของเส้นทางที่ขอ **และ** ตัวอักษรถัดไปต้องเป็น `/` · เส้นทางชื่อ
 * `/view3D` จึง **ไม่ได้ cookie** เพราะตัวถัดจาก `/view` คือ `3`
 *
 * ผลถ้าตั้งชื่อแบบนั้น: คนเปิดจะถูกถามรหัสใหม่ทุกครั้งโดยไม่มีใครรู้ว่าทำไม หรือแย่กว่า
 * คือมีคนเขียนด่านใหม่ให้หน้านั้นเอง แล้วหน้าเล่น ๆ กลายเป็นด่านที่อ่อนกว่าหน้าหลัก ·
 * อยู่ใต้ `/view/` แล้วได้ `VIEW_TOKEN` กับ cookie มาทั้งชุดโดยไม่เขียน auth เพิ่มเลย
 */
const CITY_PATH = "3d";

/** กราฟความรู้ — เส้นทางย่อยของ `/view` ด้วยเหตุผลเดียวกับ `CITY_PATH` */
const GRAPH_PATH = "graph";

/** แผนที่การส่งงาน — เส้นทางย่อยเช่นเดียวกัน */
const MAP_PATH = "handoffs";

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

/** ระยะห่างจาก UTC ของเวลาไทย — ไทยไม่มี DST ค่านี้จึงคงที่ตลอดปีทุกปี */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** บอกท้ายหน้าว่าเวลาที่เห็นเป็นเขตไหน เพราะ `when()` ไม่ได้ติดป้ายไว้ในแต่ละจุด */
const TZ_NOTE = "เวลาทั้งหมดเป็นเวลาไทย (UTC+7)";

/**
 * คำอธิบายของป้าย contract สำหรับคนที่เอาเมาส์ชี้
 *
 * ป้ายนี้เป็นเลขลอย ๆ ที่บอกตัวเองไม่ได้ว่าคืออะไร มีคนถามมาแล้วว่ากดไม่ได้แล้วมันคืออะไร
 * ซึ่งเป็นคำถามที่ถูก — หน้านี้ไม่เคยอธิบายมันเลย ใช้ `title` เพราะเป็น HTML ล้วน
 * ไม่ต้องมี JavaScript และไม่ต้องมีหน้าใหม่ให้ดูแล
 */
const CONTRACT_TITLE =
  "เลขเวอร์ชันของรูปผลลัพธ์ที่ tool คืน — ถ้าเลขนี้ไม่ตรงกับที่ MCP client ของคุณเห็น " +
  "แปลว่า client ถือ schema เก่าอยู่ ต้องเชื่อมต่อใหม่";

/**
 * เวลาไทยแบบสั้น ให้คนกวาดตาได้ ไม่ใช่ ISO เต็มที่อ่านยาก
 *
 * บวก offset คงที่แล้วอ่านค่าด้วยเมธอด UTC ไม่ใช้เมธอดเวลาท้องถิ่นหรือ `Intl` เพราะ
 * เวลาท้องถิ่นของ Worker เป็น UTC เสมอไม่ว่าคนอ่านจะอยู่ที่ไหน ค่าที่ได้จึงต้องมาจาก
 * การคำนวณตรง ๆ ไม่ใช่จากเขตเวลาของเครื่องที่รัน
 *
 * ก่อนหน้านี้ฟังก์ชันนี้เขียนกำกับว่าเป็นเวลาไทยอยู่แล้ว แต่อ่านค่า UTC ออกมาตรง ๆ
 * คนอ่านหน้านี้จึงเห็นเวลาเร็วกว่าจริงเจ็ดชั่วโมงโดยไม่มีอะไรบอก
 */
function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  const t = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)} ${pad(t.getUTCHours())}:${pad(
    t.getUTCMinutes(),
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
.bar a { text-decoration: none; border-bottom: 1px dotted var(--muted); }
.item { padding: 14px 0; border-top: 1px solid var(--line); }
.item h2 { margin-bottom: 4px; }
.tag { border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; font-size: 11px;
  color: var(--muted); margin-right: 6px; white-space: nowrap; }
details { margin-top: 8px; }
summary { cursor: pointer; font-size: 13px; color: var(--muted); }
details .body { margin-top: 8px; padding-left: 14px; border-left: 2px solid var(--line); }
h2.section { margin: 32px 0 0; font-size: 17px; scroll-margin-top: 12px; }
code { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 12px;
  overflow-wrap: anywhere; }
`;

function page(title: string, body: string, extraStyle = "", bodyClass = ""): Response {
  return new Response(
    `<!doctype html><html lang="th"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="robots" content="noindex,nofollow">` +
      `<title>${esc(title)}</title><style>${STYLE}${extraStyle}</style></head>` +
      `<body${bodyClass ? ` class="${bodyClass}"` : ""}>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

/**
 * กติกาของโต๊ะ — อยู่บนสุดก่อนรายการกระทู้ ด้วยเหตุผลเดียวกับที่ `standing_rules`
 * อยู่ก่อน `open_items` ในผลลัพธ์ของ MCP คือ **กติกาต้องอ่านก่อนตัดสินใจว่าจะทำงาน
 * อย่างไร ไม่ใช่เจอทีหลังตอนที่ทำผิดไปแล้ว**
 *
 * ต่างจากฝั่ง MCP ตรงที่เอาเนื้อมาด้วย เพราะคนที่เปิดหน้านี้มาอ่านกติกา ต้องการตัว
 * กติกา ไม่ใช่ตัวชี้ไปหามัน
 *
 * ไม่มีกติกาเลยก็ยังบอก ไม่ใช่เงียบ — หน้าที่ว่างเปล่ากับหน้าที่ไม่มีส่วนนี้อยู่
 * หน้าตาเหมือนกันจากสายตาคนอ่าน ซึ่งเป็นความล้มเหลวชนิดที่ repo นี้ไล่แก้มาตลอด
 */
function renderRules(
  rules: Awaited<ReturnType<typeof readStandingRuleDetails>>,
  workspace: string,
): string {
  const heading = `<h2 class="section" id="rules">กติกาของโต๊ะ</h2>`;

  if (rules.length === 0) {
    return (
      heading +
      `<div class="muted" style="margin-top:8px">ยังไม่มีใบไหนถูกปักเป็นกติกาของ workspace นี้ ` +
      `— ปักได้ด้วย <code>set_decision_scope</code> ซึ่งต้องใช้รหัสของเซิร์ฟเวอร์</div>`
    );
  }

  const rows = rules
    .map((r) => {
      // ใครปักกับใครปิดใบ คนละเหตุการณ์ คนละหลักฐาน จึงแยกบรรทัดกันชัด ๆ
      const pinned = r.scope_set_by
        ? `ปักโดย ${esc(r.scope_set_by)} · ${when(r.scope_set_at)}`
        : "ปักก่อนที่ระบบจะเริ่มบันทึกว่าใครปัก — ไม่มีบันทึก";
      const closed = r.decided_by
        ? `ปิดโดย ${esc(r.decided_by)} (${esc(r.decided_by_kind ?? "")}) · ${when(r.decided_at)}`
        : "ยังไม่มีใครเคาะ";

      return (
        `<div class="item"><h2>${tag("กติกา")}${esc(r.title)}</h2>` +
        `<div class="muted">${pinned}</div>` +
        `<div class="muted">${closed}</div>` +
        source(r.discussion_id, workspace) +
        fold("อ่านกติกาเต็ม", r.detail) +
        `</div>`
      );
    })
    .join("");

  return heading + rows;
}

/**
 * commit ที่ deployment นี้มาจาก — `ไม่ทราบ` เมื่อไม่ได้ deploy ผ่านสคริปต์
 *
 * เขียนว่าไม่ทราบดีกว่าซ่อนช่องนี้ไป เพราะหน้าที่ไม่มีช่องนี้ กับหน้าที่มีช่องแล้วว่าง
 * อ่านต่างกัน — อันแรกแปลว่าระบบไม่เก็บ อันหลังแปลว่าคนที่ deploy ข้ามสคริปต์
 */
function deployedFrom(sha: string | undefined): string {
  const value = sha?.trim();
  return value
    ? `<span title="commit ที่ deployment นี้ build มาจาก">มาจาก <code>${esc(value)}</code></span>`
    : `<span title="deploy โดยไม่ผ่าน scripts/deploy.sh จึงไม่มีการฝังเลข commit">มาจาก <code>ไม่ทราบ</code></span>`;
}

function renderList(
  context: Awaited<ReturnType<typeof readWorkspaceContext>>,
  open: Awaited<ReturnType<typeof readOpenItems>>,
  rules: Awaited<ReturnType<typeof readStandingRuleDetails>>,
  workspace: string,
  commitSha: string | undefined,
): Response {
  const tasks = Object.entries(open.tasks)
    .map(([status, n]) => `${esc(status)} ${n}`)
    .join(" · ");

  const rows = context.discussions
    .map(
      (d) =>
        `<a class="row" href="${VIEW_ROUTE}/${esc(d.id)}?ws=${esc(workspace)}">` +
        `<h2>${esc(d.title)}</h2>` +
        `<div class="muted"><code>${esc(shortId(d.id))}</code> · ` +
        `${d.message_count} ข้อความ · เปิดโดย ${esc(d.created_by)} · ` +
        // กระทู้ที่ยังไม่มีข้อความต้องพูดออกมา ไม่ใช่ปล่อยคำว่า "ล่าสุด" ห้อยไว้เฉย ๆ
        // แล้วให้คนเดาว่าข้อมูลหายหรือยังไม่มีใครตอบ
        (d.last_author
          ? `ล่าสุด ${when(d.last_activity)} โดย ${esc(d.last_author)}`
          : "ยังไม่มีข้อความ") +
        `</div>` +
        `<div class="muted">${esc(d.participants.join(" · "))}</div></a>`,
    )
    .join("");

  const other = workspace === DEFAULT_WORKSPACE ? "ws-test" : DEFAULT_WORKSPACE;
  const items = `${VIEW_ROUTE}/${ITEMS_PATH}?ws=${encodeURIComponent(workspace)}`;

  return page(
    `${context.workspace.name} — ai-collab`,
    `<div class="top"><h1>${esc(context.workspace.name)}</h1>` +
      `<a class="muted" href="${VIEW_ROUTE}?ws=${esc(other)}">ดู ${esc(other)} →</a></div>` +
      `<div class="muted">${esc(context.workspace.id)} · ${context.total_discussions} กระทู้ · ` +
      `${context.participants.length} ผู้ร่วม</div>` +
      `<div class="bar">` +
      `<span><a href="${items}#decisions"><b>${open.decisions_awaiting}</b> decision รอเคาะ</a></span>` +
      `<span><a href="${items}#handoffs"><b>${open.handoffs_pending}</b> handoff รอคนรับ</a></span>` +
      // ไม่แสดง `handoffs_inactive` บนแถบนี้ — ใบที่ไม่ต้องรับแล้วไม่ใช่ของที่ต้องทำ
      // และเลขสองหลักข้าง ๆ เลขที่ต้องทำจริงทำให้อ่านผิดว่ามีงานค้างมากกว่าที่เป็น
      //
      // **ไม่ได้ทำให้มันเงียบ** — ส่วน Handoff ยังบอกว่า "ซ่อน N รายการที่ไม่ต้องรับแล้ว"
      // พร้อมลิงก์ดูทั้งหมดเหมือนเดิม และ `get_workspace_context` ยังคืนค่านี้ตามสัญญา
      // ถ้าจะตัดทิ้งทั้งเส้น ต้องตัดที่นั่นด้วย ซึ่งทำไม่ได้เพราะ contract ห้ามลบคีย์
      `<span><a href="${items}#tasks">งานค้าง: ${tasks || "ไม่มี"}</a></span>` +
      `<span><a href="#rules"><b>${rules.length}</b> กติกาของโต๊ะ</a></span>` +
      `<span><a href="${VIEW_ROUTE}/${CITY_PATH}?ws=${encodeURIComponent(workspace)}">` +
      `เมืองสามมิติ →</a></span>` +
      `<span><a href="${VIEW_ROUTE}/${GRAPH_PATH}?ws=${encodeURIComponent(workspace)}">` +
      `กราฟความรู้ →</a></span>` +
      `<span><a href="${VIEW_ROUTE}/${MAP_PATH}?ws=${encodeURIComponent(workspace)}">` +
      `แผนที่การส่งงาน →</a></span>` +
      `<span title="${esc(CONTRACT_TITLE)}">contract ${CONTRACT_VERSION}</span>` +
      deployedFrom(commitSha) +
      `</div>` +
      renderRules(rules, workspace) +
      `<h2 class="section">กระทู้</h2>` +
      rows +
      (context.has_more
        ? `<div class="note">แสดง ${context.discussions.length} จาก ${context.total_discussions} กระทู้</div>`
        : "") +
      `<div class="note">${TZ_NOTE} · หน้านี้อ่านอย่างเดียว การเขียนทุกชนิดยังต้องผ่าน MCP tool เท่านั้น</div>`,
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
      // id เต็ม ไม่ใช่รูปย่อ — `get_discussion` เทียบ id แบบตรงตัว ส่งรูปย่อไปจะไม่พบ
      // คนที่มาถึงหน้านี้มักกำลังจะเอา id ไปให้ AI ต่อ จึงต้องได้ตัวที่ใช้ได้จริง
      `<div class="muted">id <code>${esc(discussion.id)}</code></div>` +
      messages +
      (page_.has_more
        ? `<div class="note">แสดง ${page_.messages.length} จาก ${page_.total} ข้อความ</div>`
        : "") +
      `<div class="note">${TZ_NOTE}</div>`,
  );
}

/**
 * เนื้อยาว ๆ พับไว้ให้กางเอง
 *
 * detail ของ decision บางใบยาวห้าพันตัวอักษร ถ้าแสดงเต็มทุกใบหน้าจะกลายเป็นกำแพง
 * ข้อความที่กวาดตาไม่ได้ ใช้ `<details>` ของ HTML ล้วนเพราะไม่ต้องมี JavaScript
 * และเปิดค้างได้เองเวลาสั่งพิมพ์หน้าหรือค้นด้วย Ctrl+F ในเบราว์เซอร์ที่รองรับ
 */
function fold(label: string, body: string): string {
  if (!body.trim()) return "";
  return `<details><summary>${esc(label)}</summary><div class="body">${esc(body)}</div></details>`;
}

/**
 * รูปย่อของ id ที่คนใช้เรียกกันจริง เช่น `dis-6c9dd6e3`
 *
 * ตัดที่แปดตัวตายตัว **เพื่อให้ตรงกับที่ AI อ้างถึงกันในกระทู้** ไม่ใช่เพื่อประหยัดที่ —
 * ทีมงานบอกว่าเห็น AI คุยกันแล้วอยากตามไปส่องกระทู้ถูกอัน ของที่ต้องตรงกันคือสิ่งที่
 * ตาคนกวาดหาบนหน้าจอ กับสิ่งที่พิมพ์อยู่ในข้อความ
 *
 * ไม่ได้คำนวณความยาวที่สั้นที่สุดที่ยังไม่ชนกัน เพราะความยาวที่เปลี่ยนไปมาจะทำให้
 * เทียบด้วยสายตายากขึ้น ซึ่งแพงกว่าความเสี่ยงที่ prefix แปดตัวจะชนกันมาก
 */
function shortId(id: string): string {
  return id.slice(0, 12);
}

function tag(text: string): string {
  return `<span class="tag">${esc(text)}</span>`;
}

/** ลิงก์กลับไปกระทู้ต้นทาง — ของที่ค้างเกือบทุกใบมีที่มาอยู่ในกระทู้ใดกระทู้หนึ่ง */
function source(discussionId: string | null, workspace: string): string {
  if (!discussionId) return "";
  return (
    `<div class="muted">↳ <a href="${VIEW_ROUTE}/${esc(discussionId)}` +
    `?ws=${encodeURIComponent(workspace)}">กระทู้ต้นทาง</a></div>`
  );
}

/**
 * บอกว่าซ่อนอะไรไปเท่าไร แทนที่จะซ่อนเงียบ
 *
 * ค่าเริ่มต้นของหน้านี้คือแสดงเฉพาะของที่ยังค้าง เพราะของที่ปิดแล้วสะสมไปเรื่อย ๆ จน
 * กลบของที่ต้องทำ แต่การกรองที่ไม่บอกว่ากรองอะไรออกไปคือ **ผลที่ถูกตัดโดยไม่มีสัญญาณ**
 * ซึ่งเป็นความล้มเหลวชนิดที่ repo นี้ตั้งขึ้นมาเพื่อกำจัด ทุกส่วนจึงบอกจำนวนที่ซ่อนพร้อม
 * ลิงก์ไปดูของครบเสมอ
 */
function hiddenNote(
  count: number,
  showAll: boolean,
  workspace: string,
  // เหตุที่ซ่อนต่างกันตามชนิด — decision/งานถูกปิดแล้ว ส่วน handoff ที่ซ่อนคือใบที่
  // **ไม่ต้องรับแล้ว** ซึ่งคนละเรื่องกับปิด · ใช้คำเดียวทุกส่วนคือการบอกเหตุผิดสองในสาม
  reason = "ที่ปิดแล้ว",
): string {
  if (showAll || count === 0) return "";
  const href = `${VIEW_ROUTE}/${ITEMS_PATH}?ws=${encodeURIComponent(workspace)}&all=1`;
  return `<div class="muted">ซ่อน ${count} รายการ${reason} · <a href="${href}">ดูทั้งหมด</a></div>`;
}

/**
 * บอกเมื่อชนเพดาน แทนที่จะตัดเงียบ
 *
 * ต่อให้กรองใน SQL แล้ว ของที่ค้างก็ยังมากเกิน `ITEM_LIMIT` ได้ในวันหนึ่ง · การตัดที่
 * ไม่มีสัญญาณอ่านได้ว่า "ครบแล้ว" ซึ่งเป็นความล้มเหลวรูปเดียวกับที่หน้านี้เพิ่งเจอมา
 */
function truncatedNote(page: { rows: unknown[]; total: number }, label: string): string {
  if (page.rows.length >= page.total) return "";
  return ` · <b>แสดง ${label} แค่ ${page.rows.length} จาก ${page.total}</b>`;
}

async function renderItems(
  env: Env,
  workspace: string,
  showAll: boolean,
): Promise<Response> {
  // **กรองใน SQL ไม่ใช่หลังอ่านมาแล้ว**
  //
  // เดิมอ่าน ITEM_LIMIT แถวล่าสุดของทุกชนิดมาก่อน แล้วค่อยกรองใน TS · พอของสะสมเกิน
  // ITEM_LIMIT ของที่ยังค้างซึ่ง **เก่ากว่า** หน้าต่างนั้นจะไม่ถูกอ่านเข้ามาเลย ขณะที่
  // ตัวนับบนหัวหน้าจอนับจาก SQL แบบไม่จำกัด — สองตัวจึงตอบคนละอย่าง
  //
  // 30 ก.ย. เจอของจริง: หัวหน้าจอบอก "2 handoff รอคนรับ" แต่รายการว่าง เพราะสองใบนั้น
  // อยู่อันดับ 244 และ 249 จาก 264 ใบ · และงานที่ยังไม่ปิดอีก 7 ใบจาก 27 ก็หายไปด้วย
  //
  // **มันกลับหัว** — ใบที่รอนานที่สุดคือใบที่รับประกันว่าจะมองไม่เห็น ซึ่งตรงข้ามกับ
  // เหตุผลที่หน้านี้มีอยู่
  const [totals, states, decisions, handoffs, tasks] = await Promise.all([
    readItemTotals(env.DB, workspace),
    readHandoffStateCounts(env.DB, workspace),
    readDecisions(env.DB, workspace, ITEM_LIMIT, showAll ? undefined : "proposed"),
    readHandoffs(env.DB, workspace, ITEM_LIMIT, showAll ? {} : { actionable: true }),
    readTasks(env.DB, workspace, ITEM_LIMIT, showAll ? {} : { exclude_done: true }),
  ]);

  // จำนวนที่ซ่อนคิดจาก **ยอดทั้งหมดในฐาน** ลบยอดที่ตรงตัวกรอง ไม่ใช่จากจำนวนแถวที่
  // อ่านมาได้ — ไม่งั้นพอชนเพดานแล้วตัวเลขนี้จะโกหกตามไปด้วย
  const hidden = {
    decisions: totals.decisions - decisions.total,
    handoffs: totals.handoffs - handoffs.total,
    tasks: totals.tasks - tasks.total,
  };

  const decisionRows = decisions.rows
    .map((d) => {
      const closed = d.decided_by
        ? `ปิดโดย ${esc(d.decided_by)} (${esc(d.decided_by_kind ?? "")}) · ${when(d.decided_at)}`
        : "ยังไม่มีใครเคาะ";
      const replaced = d.superseded_by
        ? `<div class="muted">ใช้ ${esc(d.superseded_by)} แทน</div>`
        : "";
      return (
        `<div class="item"><h2>${tag(d.status)}${esc(d.title)}</h2>` +
        `<div class="muted">เสนอโดย ${esc(d.proposed_by)} · ${when(d.created_at)}</div>` +
        `<div class="muted">${closed}</div>` +
        replaced +
        source(d.discussion_id, workspace) +
        fold("อ่านเนื้อเต็ม", d.detail) +
        (d.decided_reason ? fold("เหตุผลที่ปิด", d.decided_reason) : "") +
        `<div class="muted">${esc(d.id)}</div></div>`
      );
    })
    .join("");

  const handoffRows = handoffs.rows
    .map(
      (h) =>
        `<div class="item"><h2>${tag(h.state)}ส่งถึง ${esc(h.to_whom)}</h2>` +
        `<div class="muted">จาก ${esc(h.from_name)} · ${when(h.created_at)}` +
        (h.accepted_by ? ` · รับโดย ${esc(h.accepted_by)} ${when(h.accepted_at)}` : "") +
        `</div><div class="muted">งาน ${esc(h.task_id)}</div>` +
        fold("บริบทที่ส่งมาด้วย", h.context) +
        `<div class="muted">${esc(h.id)}</div></div>`,
    )
    .join("");

  const taskRows = tasks.rows
    .map(
      (t) =>
        `<div class="item"><h2>${tag(t.status)}${esc(t.title)}</h2>` +
        `<div class="muted">เจ้าของ ${esc(t.assigned_to ?? "ยังไม่มี")} · ` +
        `เปิดโดย ${esc(t.created_by)} ${when(t.created_at)}` +
        (t.updated_by ? ` · แก้ล่าสุดโดย ${esc(t.updated_by)} ${when(t.updated_at)}` : "") +
        `</div>` +
        `<div class="muted">handoff ที่รออยู่: ${t.handoff ? esc(t.handoff) : "ไม่มี"}</div>` +
        source(t.discussion_id, workspace) +
        fold("อ่านรายละเอียด", t.detail) +
        `<div class="muted">${esc(t.id)}</div></div>`,
    )
    .join("");

  const empty = `<div class="muted item">ไม่มี</div>`;
  const back = `${VIEW_ROUTE}?ws=${encodeURIComponent(workspace)}`;
  const onlyOpen = `${VIEW_ROUTE}/${ITEMS_PATH}?ws=${encodeURIComponent(workspace)}`;

  return page(
    `${showAll ? "ของทั้งหมด" : "ของที่ค้าง"} — ${workspace}`,
    `<div class="top"><h1>${showAll ? "ของทั้งหมด" : "ของที่ค้าง"}ใน ${esc(workspace)}</h1>` +
      `<a class="muted" href="${back}">← กลับ</a></div>` +
      `<div class="muted">ทั้ง workspace มี decision ${totals.decisions} · ` +
      `handoff ${totals.handoffs} (obsolete ${states.obsolete} · ` +
      `superseded ${states.superseded}) · งาน ${totals.tasks}` +
      truncatedNote(decisions, "decision") +
      truncatedNote(handoffs, "handoff") +
      truncatedNote(tasks, "งาน") +
      (showAll ? ` · <a href="${onlyOpen}">แสดงเฉพาะที่ค้าง</a>` : "") +
      `</div>` +
      `<h2 class="section" id="decisions">Decision</h2>` +
      hiddenNote(hidden.decisions, showAll, workspace) +
      (decisionRows || empty) +
      `<h2 class="section" id="handoffs">Handoff</h2>` +
      hiddenNote(hidden.handoffs, showAll, workspace, "ที่ไม่ต้องรับแล้ว") +
      (handoffRows || empty) +
      `<h2 class="section" id="tasks">งาน</h2>` +
      hiddenNote(hidden.tasks, showAll, workspace) +
      (taskRows || empty) +
      `<div class="note">${TZ_NOTE} · หน้านี้อ่านอย่างเดียว สถานะของ handoff คำนวณสดจากงานที่มันชี้ไป — ` +
      `waiting ยังรอคนรับ · stale รอเกินเจ็ดวัน · superseded ถูกแทนด้วยใบใหม่กว่า · ` +
      `obsolete งานปลายทางปิดแล้ว</div>`,
  );
}

/* ── เมืองสามมิติ ───────────────────────────────────────────────────────────
 *
 * **ไม่มี JavaScript และไม่มี asset ภายนอก เหมือนทุกหน้าในไฟล์นี้**
 *
 * สามมิติทั้งหมดเป็น CSS transform · การเคลื่อนไหวทั้งหมดเป็น `@keyframes` ·
 * ตัวละครที่เดินไปเดินมาใช้ `animation-direction: alternate` และเด้งด้วย element
 * ซ้อนอีกชั้น เพราะ element เดียวมี `transform` ได้ชุดเดียว จะเดินและเด้งพร้อมกันไม่ได้
 *
 * **เหตุที่ไม่ใช้ Three.js ไม่ใช่เพราะไลบรารีไม่ดี** — เจ้าของงานเสนอมาเองและมันเหมาะ
 * กับงานที่ต้องมีกล้อง เงา หรือการคลิกเลือกวัตถุ · ที่ไม่เอารอบนี้เพราะราคาของมันตกที่
 * worker ตัวเดียวกับที่ทุกทีมใช้ประสานงาน
 *
 *   ดึงจาก CDN         หน้าที่มีเนื้อกระทู้จริงจะบอกบุคคลที่สามว่าใครเปิดดูเมื่อไร
 *                      และเปิดทาง supply chain เข้ามาตอน runtime
 *   ฝังลง bundle       bundle วันนี้วัดได้ 274 KB gzip · ของแบบนั้นจะโตขึ้นหลายเท่า
 *                      เพื่อหน้าเล่น ๆ หน้าเดียว
 *   static assets      ต้องแก้ routing ของ worker ที่ `/mcp` อยู่ด้วย — ความเสี่ยงที่
 *                      จ่ายเพื่อของเล่นแล้วกระทบทุกทีมถ้าตั้งผิด
 *
 * CSS ทำ "ดุ๊กดิ๊ก เดินไปเดินมา" ได้ครบโดยไม่เพิ่มพื้นผิวอะไรเลย · ถ้าวันหนึ่งอยากได้
 * กล้องหมุนตามเมาส์หรือคลิกตึกแล้วเด้งไปกระทู้ ตอนนั้นค่อยคุยเรื่อง Three.js จริงจัง
 * เพราะเป็นงานที่ CSS ทำไม่ได้แล้ว
 */

/** เพดานของหน้านี้สูงกว่าหน้ารายการ เพราะเมืองที่ขาดตึกไปครึ่งอ่านผิดทั้งเมือง */
const CITY_LIMIT = 400;

/** ระยะห่างของตึกต่อหนึ่งวันบนแกนเวลา */
const DAY_PITCH = 22;
/** ระยะห่างของตึกที่เปิดวันเดียวกัน — กองลึกเข้าไปในฉาก */
const STACK_PITCH = 24;
const FOOTPRINT = 16;

/** จำนวนตัวละครที่ปล่อยเดิน — มากกว่านี้เมืองรกและแยกใครเป็นใครไม่ออก */
const WALKERS = 10;

const CITY_STYLE = `
body.city { max-width: 1180px; }
.stagewrap { overflow-x: auto; overflow-y: hidden; margin: 14px 0 6px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
.stage { perspective: 1500px; perspective-origin: 50% 38%; height: 560px; }
.town { position: relative; width: var(--town-w); height: var(--town-d); margin: 96px auto 0;
  transform-style: preserve-3d; transform: rotateX(60deg) rotateZ(-8deg);
  animation: rock 30s ease-in-out infinite alternate; }
@keyframes rock {
  from { transform: rotateX(60deg) rotateZ(-15deg); }
  to   { transform: rotateX(60deg) rotateZ(15deg); }
}
.town:hover { animation-play-state: paused; }
#iso:target   ~ .stagewrap .town { animation: none; transform: rotateX(60deg) rotateZ(-8deg); }
#front:target ~ .stagewrap .town { animation: none; transform: rotateX(84deg) rotateZ(0deg); }
#top:target   ~ .stagewrap .town { animation: none; transform: rotateX(6deg)  rotateZ(0deg); }
.ground { position: absolute; inset: 0; border: 1px solid var(--line);
  background-image: linear-gradient(var(--line) 1px, transparent 1px),
    linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size: ${DAY_PITCH}px ${STACK_PITCH}px; opacity: .35; }

/* กล่องสามมิติหนึ่งใบ — ฐานจัตุรัส var(--w) สูง var(--h) ยืนบนระนาบพื้น (z = 0) */
.bx { position: absolute; width: var(--w); height: var(--w); transform-style: preserve-3d; }
.bx > i { position: absolute; display: block; background: var(--c); }
.bx > .r  { left: 0; top: 0; width: var(--w); height: var(--w);
  transform: translateZ(var(--h)); filter: brightness(1.32); }
.bx > .n  { left: 0; top: 0; width: var(--w); height: var(--h);
  transform-origin: 50% 0; transform: rotateX(90deg); filter: brightness(.8); }
.bx > .s  { left: 0; top: var(--w); width: var(--w); height: var(--h);
  transform-origin: 50% 0; transform: rotateX(90deg); filter: brightness(1.04); }
.bx > .wl { left: 0; top: 0; width: var(--h); height: var(--w);
  transform-origin: 0 0; transform: rotateY(-90deg); filter: brightness(.64); }
.bx > .el { left: var(--w); top: 0; width: var(--h); height: var(--w);
  transform-origin: 0 0; transform: rotateY(-90deg); filter: brightness(.92); }
.bld:hover > i { filter: brightness(1.6); }

/* ตัวละคร — เลนหนึ่งเลนต่อหนึ่งทีม เดินกลับไปกลับมาตามแกนเวลา */
.lane { position: absolute; left: 0; top: var(--ly); width: 100%; height: 0;
  transform-style: preserve-3d; }
.wk { position: absolute; transform-style: preserve-3d;
  animation: walk var(--dur) ease-in-out infinite alternate var(--dl); }
@keyframes walk { from { transform: translateX(var(--x0)); } to { transform: translateX(var(--x1)); } }
.bb { position: absolute; transform-style: preserve-3d;
  animation: bob .55s ease-in-out infinite alternate var(--dl); }
@keyframes bob { from { transform: translateZ(0); } to { transform: translateZ(4px); } }

.cam { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; margin: 0 0 2px; }
.cam a { text-decoration: none; border-bottom: 1px dotted var(--muted); }
.key { display: flex; gap: 6px 18px; flex-wrap: wrap; align-items: center;
  font-size: 12px; color: var(--muted); margin: 8px 0 0; }
.sw { display: inline-block; width: 11px; height: 11px; border-radius: 2px;
  vertical-align: -1px; margin-right: 5px; }

@media (prefers-reduced-motion: reduce) {
  .town, .wk, .bb { animation: none; }
}
`;

/** อายุของความเคลื่อนไหวล่าสุด เป็นวัน — ใช้ทั้งกำหนดสีและเรียงความสนใจ */
function ageInDays(iso: string | null, now: number): number {
  if (!iso) return 999;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 999 : Math.max(0, (now - t) / 86_400_000);
}

/**
 * สีของตึกจากอายุ — สว่างอมเขียวคือขยับวันนี้ ทึบอมน้ำเงินคือเงียบไปแล้ว
 *
 * ไล่ต่อเนื่องไม่ใช่แบ่งขั้น เพราะเส้นแบ่งที่ไม่มีใครตกลงจะถูกอ่านเป็นความหมาย
 */
function ageColor(days: number): string {
  const d = Math.min(days, 40);
  return `hsl(${Math.round(166 + d * 1.5)} 44% ${Math.round(58 - d * 0.75)}%)`;
}

/** กล่องหนึ่งใบ — ห้าหน้าเสมอ ไม่ลดหน้าตามมุมกล้อง เพราะฉากหมุนได้ */
function box(cls: string, style: string, titleAttr: string): string {
  return (
    `<div class="bx ${cls}" style="${style}"${titleAttr}>` +
    `<i class="n"></i><i class="s"></i><i class="wl"></i><i class="el"></i><i class="r"></i></div>`
  );
}

async function renderCity(env: Env, workspace: string): Promise<Response> {
  const context = await readWorkspaceContext(env.DB, workspace, CITY_LIMIT);
  const rows = context.discussions;
  const now = Date.now();

  if (rows.length === 0) {
    return page(
      "เมืองว่าง",
      `<h1>ยังไม่มีกระทู้ให้สร้างเมือง</h1>` +
        `<p class="muted"><a href="${VIEW_ROUTE}">← กลับหน้ารายการ</a></p>`,
    );
  }

  // แกนเวลาเริ่มจากกระทู้ที่เปิดก่อนสุด เพื่อให้ช่วงที่โต๊ะคึกอ่านออกเป็นกลุ่มตึก
  const dayOf = (iso: string) => Math.floor(new Date(iso).getTime() / 86_400_000);
  const day0 = Math.min(...rows.map((r) => dayOf(r.created_at)));
  const maxMsg = Math.max(...rows.map((r) => r.message_count), 1);
  const lastDay = Math.max(...rows.map((r) => dayOf(r.created_at)));

  const stack = new Map<number, number>();
  const buildings: string[] = [];
  for (const r of rows) {
    const d = dayOf(r.created_at) - day0;
    const n = stack.get(d) ?? 0;
    stack.set(d, n + 1);
    // รากที่สองไม่ใช่เส้นตรง — กระทู้ 110 ข้อความไม่ควรกดกระทู้ที่มี 3 ข้อความให้หายไป
    const h = Math.round(10 + 78 * Math.sqrt(r.message_count / maxMsg));
    const age = ageInDays(r.last_activity ?? r.created_at, now);
    const style =
      `left:${24 + d * DAY_PITCH}px;top:${20 + n * STACK_PITCH}px;` +
      `--w:${FOOTPRINT}px;--h:${h}px;--c:${ageColor(age)}`;
    const label =
      `${r.title} · ${r.message_count} ข้อความ · ` +
      `ขยับล่าสุด ${when(r.last_activity ?? r.created_at)}` +
      (r.last_author ? ` โดย ${r.last_author}` : "");
    buildings.push(box("bld", style, ` title="${esc(label)}"`));
  }

  // ตัวละคร = ทีมที่ "โพสต์จริง" ไม่ใช่ทีมที่ถูกเอ่ยถึง — นับจาก participants ของกระทู้
  const seen = new Map<string, { n: number; fresh: number }>();
  for (const r of rows) {
    const age = ageInDays(r.last_activity ?? r.created_at, now);
    for (const p of r.participants) {
      const cur = seen.get(p) ?? { n: 0, fresh: 999 };
      seen.set(p, { n: cur.n + 1, fresh: Math.min(cur.fresh, age) });
    }
  }
  const cast = [...seen.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, WALKERS);

  const townW = 48 + (lastDay - day0) * DAY_PITCH + FOOTPRINT;
  const townD = 40 + Math.max(...stack.values()) * STACK_PITCH;

  const walkers = cast.map(([name, info], i) => {
    const hue = (i * 47 + 12) % 360;
    const style =
      `--w:11px;--h:13px;--c:hsl(${hue} 52% 54%)` as string;
    const head = `--w:8px;--h:8px;--c:hsl(${hue} 52% 68%)`;
    const label = `${name} · โพสต์ใน ${info.n} กระทู้ · ขยับล่าสุด ${
      info.fresh > 40 ? "เกินเดือน" : `${Math.round(info.fresh)} วันก่อน`
    }`;
    // เดินตามแกนเวลา เริ่มเหลื่อมกันทั้งตำแหน่งและจังหวะ ไม่ให้เดินพร้อมกันเป็นแถว
    //
    // คุมปลายทางให้อยู่ในเมืองเสมอ — โต๊ะที่มีกระทู้น้อยทำให้เมืองแคบกว่าระยะเดินที่
    // คำนวณจากดัชนี แล้วตัวละครจะเดินถอยหลังออกนอกฉากโดยไม่มีอะไรฟ้อง
    const x0 = Math.min(20 + i * 23, Math.max(8, townW - 56));
    const x1 = Math.max(x0 + 18, townW - 44 - i * 13);
    return (
      `<div class="lane" style="--ly:${18 + i * 11}px">` +
      `<div class="wk" style="--x0:${x0}px;--x1:${x1}px;` +
      `--dur:${16 + i * 2.5}s;--dl:-${i * 1.7}s">` +
      `<div class="bb" style="--dl:-${(i % 5) * 0.11}s">` +
      box("fig", style, ` title="${esc(label)}"`) +
      `<div class="bx" style="${head};top:1px;left:1px;transform:translateZ(13px)" aria-hidden="true">` +
      `<i class="n"></i><i class="s"></i><i class="wl"></i><i class="el"></i><i class="r"></i></div>` +
      `</div></div></div>`
    );
  });

  const busiest = [...rows]
    .sort((a, b) => b.message_count - a.message_count)
    .slice(0, 5)
    .map(
      (r) =>
        `<div class="item"><h2><a href="${VIEW_ROUTE}/${esc(r.id)}">${esc(r.title)}</a></h2>` +
        `<div class="muted">${r.message_count} ข้อความ · ขยับล่าสุด ${when(
          r.last_activity ?? r.created_at,
        )}${r.last_author ? ` โดย ${esc(r.last_author)}` : ""}</div></div>`,
    )
    .join("");

  const quiet = rows.filter((r) => ageInDays(r.last_activity ?? r.created_at, now) > 7).length;

  const body =
    `<div class="top"><h1>เมืองของโต๊ะ ${esc(workspace)}</h1>` +
    `<span class="muted">contract <b title="${esc(CONTRACT_TITLE)}">${CONTRACT_VERSION}</b></span></div>` +
    `<div class="muted">ตึกหนึ่งใบคือหนึ่งกระทู้ · สูงตามจำนวนข้อความ · ` +
    `สีตามอายุของความเคลื่อนไหวล่าสุด · แกนนอนคือวันที่เปิดกระทู้ · ` +
    `ตัวที่เดินคือทีมที่โพสต์จริง เอาเมาส์ชี้เพื่อดูว่าใคร</div>` +
    `<div class="bar"><span>กระทู้ <b>${rows.length}</b></span>` +
    `<span>เงียบเกินเจ็ดวัน <b>${quiet}</b></span>` +
    `<span>ทีมที่โพสต์จริง <b>${seen.size}</b></span>` +
    `<span>ตัวที่ปล่อยเดิน <b>${cast.length}</b></span>` +
    `<span><a href="${VIEW_ROUTE}">← หน้ารายการ</a></span></div>` +
    `<div class="cam"><a href="#">หมุนเอง</a> <a href="#iso">มุมเฉียง</a> ` +
    `<a href="#front">มุมระดับตา</a> <a href="#top">มุมบน</a>` +
    `<span class="muted">· เอาเมาส์วางบนเมืองเพื่อหยุดภาพ</span></div>` +
    `<i id="iso"></i><i id="front"></i><i id="top"></i>` +
    `<div class="stagewrap"><div class="stage">` +
    `<div class="town" style="--town-w:${townW}px;--town-d:${townD}px">` +
    `<div class="ground"></div>${buildings.join("")}${walkers.join("")}` +
    `</div></div></div>` +
    `<div class="key"><span><span class="sw" style="background:${ageColor(0)}"></span>ขยับวันนี้</span>` +
    `<span><span class="sw" style="background:${ageColor(7)}"></span>เจ็ดวัน</span>` +
    `<span><span class="sw" style="background:${ageColor(20)}"></span>ยี่สิบวัน</span>` +
    `<span><span class="sw" style="background:${ageColor(40)}"></span>เงียบเกินเดือน</span></div>` +
    `<h2 class="section">ตึกที่สูงที่สุดห้าใบ</h2>${busiest}` +
    `<div class="note">${TZ_NOTE} · หน้านี้อ่านอย่างเดียวและ**ไม่มี JavaScript** — ` +
    `สามมิติทั้งหมดเป็น CSS transform ไม่มี asset จากที่อื่นเลยสักไบต์ · ` +
    `ตัวเลขทั้งหมดมาจากกระทู้ที่หน้ารายการแสดงอยู่แล้ว ไม่มีเนื้อข้อความอยู่ในหน้านี้</div>`;

  // คลาสบน body ให้หน้านี้กว้างกว่าหน้าอื่นได้ โดยไม่แก้ STYLE ที่ทุกหน้าใช้ร่วมกัน
  return page(`เมืองของโต๊ะ ${workspace}`, body, CITY_STYLE, "city");
}

/* ── แผนที่การส่งงาน ────────────────────────────────────────────────────────
 *
 * ตอบคำถามที่ไม่มีที่ไหนในระบบตอบได้ — **ใครส่งงานให้ใคร และใครรับไปจริง**
 *
 * `health.delegated` รายงานเป็นยอดว่ามีกี่ใบที่ผู้กดรับไม่ใช่ชื่อที่จ่าหน้าถึง แต่ยอดเดียว
 * ไม่บอกว่าเป็นคู่ไหน · แผนที่วาดเส้นพวกนั้นแยกออกมาเป็นชั้นของตัวเอง
 *
 * **ไม่ใช่การจับผิดใคร** — `health` เขียนกำกับไว้เองว่าเป็นข้อสังเกตไม่ใช่คำตัดสิน
 * และการที่คนอื่นหยิบงานไปทำแทนเป็นเรื่องปกติของโต๊ะนี้ · ที่วาดคือข้อเท็จจริงว่า
 * ระเบียนระบุชื่อหนึ่งแต่มืออีกชื่อหนึ่งลงมือ ซึ่งคนอ่านย้อนหลังต้องแยกออก
 *
 * ไม่มี JavaScript · SVG คำนวณพิกัดที่ server เหมือนหน้าอื่นในไฟล์นี้
 */

const MAP_R = 268;
const MAP_PAD = 196;
const MAP_SIZE = (MAP_R + MAP_PAD) * 2;
const MAP_C = MAP_SIZE / 2;

const MAP_STYLE = `
body.map { max-width: 1060px; }
.msvg { display: block; margin: 0 auto; }
.msvg text { font: 11px ui-sans-serif, "Noto Sans Thai", sans-serif; fill: var(--fg); }
.msvg .lk { fill: none; stroke: var(--fg); stroke-linecap: round; opacity: .42; }
.msvg .lk.fk { stroke: var(--muted); stroke-dasharray: 5 4; opacity: .95; }
.msvg .nd { fill: var(--fg); }
.msvg .nd.sink { fill: var(--bg); stroke: var(--fg); stroke-width: 1.3; }
.msvg .nl { font-size: 10.5px; }
.msvg .nl.q { fill: var(--muted); }
.mrow { display: grid; grid-template-columns: 1fr auto auto; gap: 2px 12px;
  font-size: 13px; align-items: baseline; }
.mrow .num { font-variant-numeric: tabular-nums; color: var(--muted); }
.mrow .hd { font-weight: 600; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
`;

/** ชื่อยาวทุกชื่อขึ้นต้นด้วยเจ้าของบัญชีเดียวกัน — ตัดออกเพื่อให้ป้ายอ่านได้ */
function shortName(name: string): string {
  return name.replace(/^monthop-gmail\//, "").replace(/^willpower-institute\//, "wi/");
}

function mapPoint(deg: number, r: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: MAP_C + r * Math.cos(rad), y: MAP_C + r * Math.sin(rad) };
}

async function renderHandoffMap(env: Env, workspace: string): Promise<Response> {
  const map = await readHandoffMap(env.DB, workspace);

  // โหนดเรียงตามจำนวนใบที่เกี่ยวข้อง ให้ชื่อที่ยุ่งที่สุดอยู่ติดกันและเส้นสั้น
  const deg = new Map<string, { out: number; in: number; name: string }>();
  const touch = (name: string, dir: "out" | "in", n: number) => {
    const key = name.toLowerCase();
    const cur = deg.get(key) ?? { out: 0, in: 0, name };
    cur[dir] += n;
    deg.set(key, cur);
  };
  for (const e of map.edges) {
    touch(e.from, "out", e.n);
    touch(e.to, "in", e.n);
  }
  for (const f of map.forks) touch(f.actual, "in", 0);

  const order = [...deg.entries()].sort(
    (a, b) => b[1].out + b[1].in - (a[1].out + a[1].in) || a[0].localeCompare(b[0]),
  );
  const angleOf = new Map<string, number>();
  order.forEach(([key], i) => angleOf.set(key, -90 + (360 * i) / Math.max(order.length, 1)));

  const at = (name: string) => angleOf.get(name.toLowerCase());

  const maxN = Math.max(...map.edges.map((e) => e.n), 1);

  /** เส้นโค้งเข้าหากลางวง — เส้นตรงทั้งหมดจะทับกันเป็นพงรกตรงกลาง */
  const chord = (a: number, b: number, width: number, cls: string, label: string) => {
    const p = mapPoint(a, MAP_R);
    const q = mapPoint(b, MAP_R);
    // ยิ่งสองชื่ออยู่ไกลกันบนวง ยิ่งดึงเส้นเข้าหากลางมาก
    const spread = Math.abs(((a - b + 540) % 360) - 180) / 180;
    const pull = 0.12 + 0.62 * (1 - spread);
    const cx = MAP_C + (((p.x + q.x) / 2 - MAP_C) * pull);
    const cy = MAP_C + (((p.y + q.y) / 2 - MAP_C) * pull);
    return (
      `<path class="lk ${cls}" d="M${p.x.toFixed(1)} ${p.y.toFixed(1)} ` +
      `Q${cx.toFixed(1)} ${cy.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}" ` +
      `stroke-width="${width.toFixed(2)}"><title>${esc(label)}</title></path>`
    );
  };

  const links = map.edges
    .map((e) => {
      const a = at(e.from);
      const b = at(e.to);
      if (a === undefined || b === undefined) return "";
      const w = 0.9 + 4.6 * Math.sqrt(e.n / maxN);
      const label =
        `${e.from} → ${e.to} · ${e.n} ใบ` +
        (e.pending ? ` · ยังไม่มีใครรับ ${e.pending}` : "") +
        (e.forked ? ` · ผู้รับไม่ตรงชื่อ ${e.forked}` : "");
      return chord(a, b, w, "", label);
    })
    .join("");

  // ชั้นของเส้นที่ผู้กดรับไม่ใช่ชื่อที่จ่าหน้าถึง — จากชื่อบนใบ ไปยังมือที่ลงจริง
  const forkLinks = map.forks
    .map((f) => {
      const a = at(f.named);
      const b = at(f.actual);
      if (a === undefined || b === undefined || a === b) return "";
      return chord(
        a,
        b,
        1.1 + 2.2 * Math.sqrt(f.n / maxN),
        "fk",
        `ใบจ่าหน้าถึง ${f.named} แต่ ${f.actual} กดรับ · ${f.n} ใบ`,
      );
    })
    .join("");

  const nodes = order
    .map(([key, info]) => {
      const a = angleOf.get(key)!;
      const p = mapPoint(a, MAP_R);
      const t = mapPoint(a, MAP_R + 12);
      const flip = a > 90 || a < -90;
      const anchor = flip ? "end" : "start";
      const rot = flip ? a + 180 : a;
      // ชื่อที่รับงานแต่ไม่เคยส่งงานให้ใคร วาดเป็นวงกลวง — ปลายทางของสายงาน
      const sink = info.out === 0 ? " sink" : "";
      const q = info.in === 0 && info.out === 0 ? " q" : "";
      return (
        `<g><circle class="nd${sink}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" ` +
        `r="${(2.6 + Math.min(4.4, Math.sqrt(info.out + info.in) / 2.4)).toFixed(2)}">` +
        `<title>${esc(info.name)} · ส่งออก ${info.out} · รับเข้า ${info.in}</title></circle>` +
        `<text class="nl${q}" x="${t.x.toFixed(1)}" y="${t.y.toFixed(1)}" ` +
        `text-anchor="${anchor}" dominant-baseline="middle" ` +
        `transform="rotate(${rot.toFixed(2)} ${t.x.toFixed(1)} ${t.y.toFixed(1)})">` +
        `${esc(shortName(info.name))}</text></g>`
      );
    })
    .join("");

  const svg =
    `<svg class="msvg" width="${MAP_SIZE}" height="${MAP_SIZE}" ` +
    `viewBox="0 0 ${MAP_SIZE} ${MAP_SIZE}" role="img" ` +
    `aria-label="แผนที่การส่งงานระหว่างทีม"><g>${links}${forkLinks}${nodes}</g></svg>`;

  const sinks = order.filter(([, i]) => i.out === 0).length;
  const forkTotal = map.forks.reduce((n, f) => n + f.n, 0);
  const pendingTotal = map.edges.reduce((n, e) => n + e.pending, 0);

  const top = map.edges
    .slice(0, 12)
    .map(
      (e) =>
        `<span>${esc(shortName(e.from))} → ${esc(shortName(e.to))}</span>` +
        `<span class="num">${e.n} ใบ</span>` +
        `<span class="num">${e.pending ? `รอรับ ${e.pending}` : ""}</span>`,
    )
    .join("");

  const forkRows = map.forks
    .map(
      (f) =>
        `<span>ใบจ่าหน้าถึง <b>${esc(shortName(f.named))}</b> · ` +
        `${esc(shortName(f.actual))} กดรับ</span>` +
        `<span class="num">${f.n} ใบ</span><span></span>`,
    )
    .join("");

  const body =
    `<div class="top"><h1>แผนที่การส่งงาน ${esc(workspace)}</h1>` +
    `<span class="muted">contract <b title="${esc(CONTRACT_TITLE)}">${CONTRACT_VERSION}</b></span></div>` +
    `<div class="muted">จุดหนึ่งจุดคือหนึ่งชื่อ · เส้นหนาตามจำนวนใบที่ส่งกัน · ` +
    `<b>เส้นประคือใบที่ผู้กดรับไม่ใช่ชื่อที่จ่าหน้าถึง</b> · วงกลวงคือชื่อที่รับงาน` +
    `แต่ไม่เคยส่งงานให้ใคร · เอาเมาส์ชี้จุดหรือเส้นเพื่อดูตัวเลขและชื่อเต็ม</div>` +
    `<div class="bar"><span>ใบฝากงาน <b>${map.total}</b></span>` +
    `<span>ชื่อในแผนที่ <b>${order.length}</b></span>` +
    `<span>คู่ที่ส่งกัน <b>${map.edges.length}</b></span>` +
    `<span>ผู้รับไม่ตรงชื่อ <b>${forkTotal}</b></span>` +
    `<span>ยังไม่มีใครรับ <b>${pendingTotal}</b></span>` +
    `<span>ปลายทางของสายงาน <b>${sinks}</b></span>` +
    `<span><a href="${VIEW_ROUTE}">← หน้ารายการ</a></span></div>` +
    `<div class="gwrap">${svg}</div>` +
    `<h2 class="section">คู่ที่ส่งงานกันบ่อยที่สุด</h2>` +
    `<div class="mrow"><span class="hd">คู่</span><span class="hd num">ใบ</span>` +
    `<span class="hd num">รอรับ</span>${top}</div>` +
    (forkRows
      ? `<h2 class="section">ใบที่ผู้กดรับไม่ใช่ชื่อที่จ่าหน้าถึง</h2>` +
        `<div class="muted">เป็นข้อสังเกต ไม่ใช่คำตัดสิน — การที่คนอื่นหยิบงานไปทำแทน` +
        `เป็นเรื่องปกติของโต๊ะนี้ · ที่บันทึกคือข้อเท็จจริงว่าระเบียนระบุชื่อหนึ่ง` +
        `แต่มืออีกชื่อหนึ่งลงมือ ซึ่งคนอ่านย้อนหลังต้องแยกออก</div>` +
        `<div class="mrow">${forkRows}</div>`
      : "") +
    `<div class="note">${TZ_NOTE} · หน้านี้อ่านอย่างเดียวและไม่มี JavaScript · ` +
    `ยอดทั้งหมดรวมใน SQL จึงนับครบทุกใบ ไม่ใช่เฉพาะหน้าแรกของ <code>get_handoffs</code> ` +
    `ที่มีเพดาน 200 แถว · จับคู่ชื่อไม่สนตัวพิมพ์ ตาม <code>dec-bcb9854f</code> · ` +
    `ชื่อที่ขึ้นต้นด้วยเจ้าของบัญชีถูกตัดคำนำหน้าให้ป้ายอ่านได้ ชื่อเต็มอยู่ในคำแนะนำเมื่อชี้</div>`;

  return page(`แผนที่การส่งงาน ${workspace}`, body, GRAPH_STYLE + MAP_STYLE, "graph map");
}

/* ── กราฟความรู้ของโต๊ะ ─────────────────────────────────────────────────────
 *
 * **ไม่ใช่กราฟของระเบียนทุกใบ เป็นกราฟของชนิดข้อมูล** และนั่นเป็นการตัดสินใจ
 *
 * ของจริงมีกระทู้ 106 งาน 500 กว่า ใบฝาก 460 กว่า · วาดทุกโหนดได้ภาพที่สวยและ
 * อ่านไม่ออก แล้วไม่มีใครตอบคำถามอะไรได้จากมัน · กราฟระดับชนิดมีห้าโหนดและตอบ
 * คำถามที่ตอบไม่ได้จากที่อื่นเลย — **เส้นไหนเดินได้ เส้นไหนมีแต่ในคำพูด**
 *
 * เส้นทึบมาจาก `EDGES` ใน `src/graph.ts` · เส้นประมาจาก `MISSING` ซึ่งเป็น
 * ความสัมพันธ์ที่ทีมพูดถึงกันแต่ไม่มีฟิลด์รองรับ · **วาดของที่ไม่มีให้เห็นด้วย**
 * เพราะกราฟที่วาดแต่เส้นที่มีจะอ่านเหมือนว่าความสัมพันธ์ครบแล้ว ซึ่งไม่จริง
 *
 * ไม่มี JavaScript · เป็น SVG ที่ server คำนวณพิกัดเสร็จแล้วส่งไปก้อนเดียว
 * เรขาคณิตอยู่ใน TypeScript จึงเทสต์ได้ ไม่ใช่ของที่ต้องเปิดดูจึงรู้ว่าถูก
 */

/** ชนิดข้อมูลที่ `EDGES` พูดถึง — ห้าชนิด ไม่รวม message กับ participant ที่ไม่มีเส้นในตารางนั้น */
const GRAPH_NODES = ["discussion", "task", "handoff", "plan", "decision"] as const;
type GraphNode = (typeof GRAPH_NODES)[number];

/** มุมของแต่ละโหนดบนวงกลม เลือกให้เส้นที่ใช้บ่อยเป็นเส้นสั้นระหว่างโหนดข้างกัน */
const NODE_ANGLE: Record<GraphNode, number> = {
  discussion: -90,
  task: -18,
  handoff: 54,
  plan: 126,
  decision: 198,
};

const LABEL_TH: Record<string, string> = {
  discussion: "กระทู้",
  task: "ใบงาน",
  handoff: "ใบฝากงาน",
  plan: "แผน",
  decision: "ใบตัดสิน",
};

const SVG_W = 920;
const SVG_H = 560;
const CX = SVG_W / 2;
const CY = 268;
const RADIUS = 186;
const BOX_W = 148;
const BOX_H = 50;
/** ระยะที่หดปลายเส้นเข้ามา เพื่อให้หัวลูกศรไม่ไปจมอยู่ใต้กล่อง */
const TRIM = 40;

const GRAPH_STYLE = `
body.graph { max-width: 1000px; }
.gwrap { overflow-x: auto; margin: 14px 0 6px; border: 1px solid var(--line);
  border-radius: 10px; background: var(--card); }
.gsvg { display: block; margin: 0 auto; }
.gsvg text { font: 12px ui-sans-serif, "Noto Sans Thai", sans-serif; fill: var(--fg); }
.gsvg .nb { fill: var(--bg); stroke: var(--fg); stroke-width: 1.4; }
.gsvg .nt { font-weight: 600; font-size: 13px; }
.gsvg .nc { fill: var(--muted); font-size: 11px; }
.gsvg .ed { stroke: var(--fg); stroke-width: 1.6; fill: none; }
.gsvg .tx { stroke: var(--fg); stroke-width: 1.6; fill: none; stroke-dasharray: 2 3; }
.gsvg .ms { stroke: var(--muted); stroke-width: 1.3; fill: none; stroke-dasharray: 7 6; opacity: .75; }
.gsvg .el { font-size: 11px; paint-order: stroke; stroke: var(--bg); stroke-width: 3.5;
  stroke-linejoin: round; text-anchor: middle; }
.gsvg .ml { font-size: 11px; fill: var(--muted); paint-order: stroke; stroke: var(--bg);
  stroke-width: 3.5; stroke-linejoin: round; text-anchor: middle; }
.gkey { display: grid; gap: 4px 18px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  font-size: 12px; color: var(--muted); margin: 10px 0 0; }
.gkey b { color: var(--fg); font-weight: 600; }
`;

function polar(deg: number, r = RADIUS): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

/** หดปลายเส้นทั้งสองข้างเท่า ๆ กัน — เส้นที่สั้นกว่าสองเท่าของระยะหดจะไม่ถูกหด */
function trim(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = len > TRIM * 2.2 ? TRIM / len : 0;
  return {
    x1: a.x + dx * t,
    y1: a.y + dy * t,
    x2: b.x - dx * t,
    y2: b.y - dy * t,
  };
}

function edgeLine(from: GraphNode, to: GraphNode, cls: string, label: string, marker: string) {
  const { x1, y1, x2, y2 } = trim(polar(NODE_ANGLE[from]), polar(NODE_ANGLE[to]));
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // เลื่อนป้ายออกตั้งฉากกับเส้น ไม่ให้ทับตัวเส้นเอง
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * 11;
  const oy = (dx / len) * 11;
  const lcls = cls === "ms" ? "ml" : "el";
  return (
    `<line class="${cls}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" ` +
    `x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" marker-end="url(#${marker})"/>` +
    `<text class="${lcls}" x="${(mx + ox).toFixed(1)}" y="${(my + oy).toFixed(1)}">${esc(label)}</text>`
  );
}

/** เส้นที่ชี้กลับมาที่ชนิดเดิม — วาดเป็นวงเล็กข้างโหนด ไม่ใช่เส้นตรงที่มองไม่เห็น */
function selfLoop(node: GraphNode, cls: string, label: string, marker: string) {
  const p = polar(NODE_ANGLE[node]);
  const out = polar(NODE_ANGLE[node], RADIUS + 86);
  const r = 26;
  const cx = (p.x + out.x) / 2 + (out.x - p.x) * 0.1;
  const cy = (p.y + out.y) / 2 + (out.y - p.y) * 0.1;
  const lcls = cls === "ms" ? "ml" : "el";
  return (
    `<circle class="${cls}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" ` +
    `marker-end="url(#${marker})"/>` +
    `<text class="${lcls}" x="${cx.toFixed(1)}" y="${(cy - r - 7).toFixed(1)}">${esc(label)}</text>`
  );
}

async function renderGraph(env: Env, workspace: string): Promise<Response> {
  const [stats, decisions] = await Promise.all([
    readGraphStats(env.DB, workspace),
    readDecisions(env.DB, workspace, 200, undefined, undefined, true),
  ]);

  const used = (field: string) => stats.edges[field] ?? { used: 0, rows: 0 };
  const ratio = (field: string) => {
    const e = used(field);
    return `${e.used}/${e.rows}`;
  };

  const markers =
    `<defs>` +
    `<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" ` +
    `orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>` +
    `<marker id="am" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" ` +
    `orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor" opacity=".7"/></marker>` +
    `</defs>`;

  // เส้นทึบ = เดินได้ · มาจาก EDGES ทั้งหมด ไม่ได้เขียนรายการใหม่ที่นี่
  const solid = EDGES.filter((e) => e.to !== "*")
    .map((e) => {
      const from = e.from as GraphNode;
      const to = e.to as GraphNode;
      const label = `${e.field} · ${ratio(`${e.from}.${e.field}`)}`;
      if (from === to) return selfLoop(from, "ed", label, "ah");
      return edgeLine(from, to, "ed", label, "ah");
    })
    .join("");

  // `result_ref` ชี้ไปที่ "อะไรก็ได้" เพราะเป็นข้อความอิสระ — ปลายทางจึงไม่ใช่โหนด
  const textEdge = EDGES.filter((e) => e.to === "*")
    .map((e) => {
      const p = polar(NODE_ANGLE[e.from as GraphNode]);
      const q = polar(NODE_ANGLE[e.from as GraphNode], RADIUS + 104);
      const t = trim(p, q);
      return (
        `<line class="tx" x1="${t.x1.toFixed(1)}" y1="${t.y1.toFixed(1)}" ` +
        `x2="${t.x2.toFixed(1)}" y2="${t.y2.toFixed(1)}" marker-end="url(#am)"/>` +
        `<text class="ml" x="${q.x.toFixed(1)}" y="${(q.y + 16).toFixed(1)}">` +
        `${esc(e.field)} · ${esc(ratio(`${e.from}.${e.field}`))} · ข้อความอิสระ</text>`
      );
    })
    .join("");

  // เส้นประจาง = ไม่มีฟิลด์รองรับ · ข้อที่ปลายทางไม่ใช่โหนด (evidence) อยู่ในคำอธิบายล่าง
  const missingPairs = MISSING.map(([rel]) => rel)
    .map((rel) => rel.split(" → "))
    .filter(
      (parts): parts is [GraphNode, GraphNode] =>
        parts.length === 2 &&
        (GRAPH_NODES as readonly string[]).includes(parts[0]!) &&
        (GRAPH_NODES as readonly string[]).includes(parts[1]!),
    );
  const dashed = missingPairs
    .map(([a, b]) =>
      a === b ? selfLoop(a, "ms", "ไม่มีฟิลด์", "am") : edgeLine(a, b, "ms", "ไม่มีฟิลด์", "am"),
    )
    .join("");

  const boxes = GRAPH_NODES.map((n) => {
    const p = polar(NODE_ANGLE[n]);
    const x = p.x - BOX_W / 2;
    const y = p.y - BOX_H / 2;
    return (
      `<g><rect class="nb" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${BOX_W}" ` +
      `height="${BOX_H}" rx="9"/>` +
      `<text class="nt" x="${p.x.toFixed(1)}" y="${(p.y - 3).toFixed(1)}" text-anchor="middle">` +
      `${esc(LABEL_TH[n] ?? n)}</text>` +
      `<text class="nc" x="${p.x.toFixed(1)}" y="${(p.y + 15).toFixed(1)}" text-anchor="middle">` +
      `${esc(n)} · ${stats.nodes[n] ?? 0}</text></g>`
    );
  }).join("");

  const svg =
    `<svg class="gsvg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" ` +
    `role="img" aria-label="กราฟความสัมพันธ์ของชนิดข้อมูลในโต๊ะ">` +
    `${markers}${dashed}${solid}${textEdge}${boxes}</svg>`;

  // โซ่ของใบที่ถูกแทน — เส้น decision → decision ที่มีของจริงให้ชี้
  const chain = decisions.rows
    .filter((d) => d.superseded_by)
    .slice(0, 6)
    .map(
      (d) =>
        `<div class="item"><div class="muted"><code>${esc(d.id.slice(0, 14))}</code> ` +
        `(${esc(d.status)}) → <code>${esc((d.superseded_by ?? "").slice(0, 14))}</code></div>` +
        `<div>${esc(d.title)}</div></div>`,
    )
    .join("");

  const body =
    `<div class="top"><h1>กราฟความรู้ของโต๊ะ ${esc(workspace)}</h1>` +
    `<span class="muted">contract <b title="${esc(CONTRACT_TITLE)}">${CONTRACT_VERSION}</b></span></div>` +
    `<div class="muted">โหนดคือ<b>ชนิด</b>ของข้อมูล ไม่ใช่ระเบียนรายใบ · ` +
    `เส้นทึบคือความสัมพันธ์ที่มีฟิลด์รองรับและเดินได้ · ` +
    `<b>เส้นประจางคือความสัมพันธ์ที่ทีมพูดถึงกันแต่ไม่มีฟิลด์รองรับ</b> · ` +
    `ตัวเลขบนเส้นคือจำนวนแถวที่ฟิลด์นั้นมีค่า เทียบกับแถวทั้งหมดของชนิดนั้น</div>` +
    `<div class="bar"><span>ข้อความ <b>${stats.nodes.message ?? 0}</b></span>` +
    `<span>ชื่อที่โพสต์จริง <b>${stats.nodes.participant ?? 0}</b></span>` +
    `<span>เส้นที่เดินได้ <b>${EDGES.filter((e) => e.kind === "field").length}</b></span>` +
    `<span>เส้นที่ยังไม่มี <b>${MISSING.length}</b></span>` +
    `<span><a href="${VIEW_ROUTE}">← หน้ารายการ</a></span>` +
    `<span><a href="${VIEW_ROUTE}/${CITY_PATH}?ws=${encodeURIComponent(workspace)}">เมืองสามมิติ →</a></span>` +
    `</div>` +
    `<div class="gwrap">${svg}</div>` +
    `<div class="gkey">` +
    EDGES.map(
      (e) =>
        `<span><b>${esc(e.from)}.${esc(e.field)} → ${esc(e.to)}</b> · ` +
        `${esc(ratio(`${e.from}.${e.field}`))} · ${esc(e.tool)}` +
        `${e.kind === "text" ? " · ข้อความอิสระ พิสูจน์ไม่ได้ว่าถูก" : ""}</span>`,
    ).join("") +
    `</div>` +
    `<h2 class="section">เส้นที่ยังไม่มี</h2>` +
    `<div class="gkey">` +
    MISSING.map(([rel, why]) => `<span><b>${esc(rel)}</b> · ${esc(why)}</span>`).join("") +
    `</div>` +
    (chain
      ? `<h2 class="section">ใบตัดสินที่ถูกแทน — ของจริงบนเส้น decision → decision</h2>${chain}`
      : "") +
    `<div class="note">${TZ_NOTE} · หน้านี้อ่านอย่างเดียวและไม่มี JavaScript — ` +
    `SVG คำนวณพิกัดที่ server · รายการเส้นมาจาก <code>src/graph.ts</code> ซึ่งเป็นนิยามเดียว ` +
    `ที่ <code>scripts/context-graph.mjs</code> ใช้ร่วมกัน และมีเทสต์เทียบไว้ว่าไม่เพี้ยนจากกัน</div>`;

  return page(`กราฟความรู้ของโต๊ะ ${workspace}`, body, GRAPH_STYLE, "graph");
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
          "HttpOnly; Secure; SameSite=Lax; Max-Age=604800",
      },
    });
  }

  const workspace = url.searchParams.get("ws")?.trim() || DEFAULT_WORKSPACE;
  const id = url.pathname.slice(VIEW_ROUTE.length + 1);

  try {
    if (id === ITEMS_PATH) {
      return await renderItems(env, workspace, url.searchParams.get("all") === "1");
    }
    if (id === CITY_PATH) return await renderCity(env, workspace);
    if (id === GRAPH_PATH) return await renderGraph(env, workspace);
    if (id === MAP_PATH) return await renderHandoffMap(env, workspace);
    if (id) return await renderDiscussion(env, id, workspace);

    const [context, open, rules] = await Promise.all([
      readWorkspaceContext(env.DB, workspace, DISCUSSION_LIMIT),
      // ชื่อว่างโดยตั้งใจ — หน้านี้ไม่มีตัวตนของผู้เรียก จึงไม่มี waiting_for_you
      // ให้แสดง ตัวเลขที่เหลือเป็นของทั้ง workspace ซึ่งเป็นสิ่งที่คนอ่านอยากรู้
      readOpenItems(env.DB, workspace, ""),
      readStandingRuleDetails(env.DB, workspace),
    ]);
    return renderList(context, open, rules, workspace, env.COMMIT_SHA);
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
