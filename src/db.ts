/**
 * SQL ของฝั่งบทสนทนา — workspace, discussion, message
 *
 * ส่วนของ decision, task และ handoff อยู่ใน `db-work.ts` เพราะเปลี่ยนคนละจังหวะกัน
 * ไม่มี SQL อยู่นอกสองไฟล์นี้
 *
 * ใช้ prepared statement ทุกจุด ไม่มีการต่อ SQL ด้วย string — body ของข้อความ
 * มาจาก AI ภายนอกซึ่งถือเป็น untrusted input เสมอ
 */

export interface Author {
  client: string;
  name: string;
}

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
}

export interface Discussion {
  id: string;
  workspace_id: string;
  title: string;
  created_by: string;
  created_at: string;
}

export interface Message {
  id: string;
  seq: number;
  kind: string;
  body: string;
  author_client: string;
  author_name: string;
  in_reply_to: number | null;
  created_at: string;
}

/** ชนิดของข้อความ — จำกัดไว้เพื่อให้ query และ reason ต่อได้ */
export const MESSAGE_KINDS = ["proposal", "review", "question", "note"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** ข้อผิดพลาดที่เกิดจากคำขอ ไม่ใช่จากระบบ — แยกไว้เพื่อรายงานให้ agent แก้เองได้ */
export class RequestError extends Error {}

function now(): string {
  return new Date().toISOString();
}

export async function getWorkspace(db: D1Database, id: string): Promise<Workspace> {
  const row = await db
    .prepare("SELECT id, name, created_at FROM workspaces WHERE id = ?1")
    .bind(id)
    .first<Workspace>();
  if (!row) throw new RequestError(`ไม่พบ workspace '${id}'`);
  return row;
}

export async function getDiscussion(db: D1Database, id: string): Promise<Discussion> {
  const row = await db
    .prepare(
      "SELECT id, workspace_id, title, created_by, created_at FROM discussions WHERE id = ?1",
    )
    .bind(id)
    .first<Discussion>();
  if (!row) throw new RequestError(`ไม่พบ discussion '${id}'`);
  return row;
}

export async function createDiscussion(
  db: D1Database,
  workspaceId: string,
  title: string,
  author: Author,
): Promise<Discussion> {
  await getWorkspace(db, workspaceId);

  const discussion: Discussion = {
    id: `dis-${crypto.randomUUID()}`,
    workspace_id: workspaceId,
    title,
    created_by: author.name,
    created_at: now(),
  };

  await db
    .prepare(
      `INSERT INTO discussions (id, workspace_id, title, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(
      discussion.id,
      discussion.workspace_id,
      discussion.title,
      discussion.created_by,
      discussion.created_at,
    )
    .run();

  return discussion;
}

/**
 * เพิ่มข้อความและออกเลข `seq` ในคำสั่งเดียว
 *
 * การอ่าน MAX(seq) มาก่อนแล้วค่อย INSERT แยกคำสั่ง จะแข่งกันเองเมื่อ AI สองตัว
 * โพสต์พร้อมกัน — ทั้งคู่จะอ่านได้เลขเดิมแล้วเขียนทับกัน คำสั่งนี้คำนวณ seq
 * ภายในการ INSERT เดียวจึงเป็น atomic และยังมี UNIQUE(discussion_id, seq)
 * ใน schema กันไว้อีกชั้นหนึ่ง
 */
export async function postMessage(
  db: D1Database,
  discussionId: string,
  kind: MessageKind,
  body: string,
  author: Author,
  inReplyTo?: number,
): Promise<Message> {
  await getDiscussion(db, discussionId);

  if (inReplyTo !== undefined) {
    const target = await db
      .prepare("SELECT seq FROM messages WHERE discussion_id = ?1 AND seq = ?2")
      .bind(discussionId, inReplyTo)
      .first<{ seq: number }>();
    if (!target) {
      throw new RequestError(
        `in_reply_to=${inReplyTo} ไม่มีอยู่ในกระทู้นี้ — ดูเลข seq ได้จาก get_discussion`,
      );
    }
  }

  const id = `msg-${crypto.randomUUID()}`;
  const created = now();

  const row = await db
    .prepare(
      `INSERT INTO messages
         (id, discussion_id, seq, kind, body, author_client, author_name, in_reply_to, created_at)
       SELECT ?1, ?2, COALESCE(MAX(seq), 0) + 1, ?3, ?4, ?5, ?6, ?7, ?8
         FROM messages WHERE discussion_id = ?2
       RETURNING seq`,
    )
    .bind(id, discussionId, kind, body, author.client, author.name, inReplyTo ?? null, created)
    .first<{ seq: number }>();

  if (!row) throw new Error("INSERT ไม่คืน seq กลับมา");

  return {
    id,
    seq: row.seq,
    kind,
    body,
    author_client: author.client,
    author_name: author.name,
    in_reply_to: inReplyTo ?? null,
    created_at: created,
  };
}

export interface MessagePage {
  messages: Message[];
  has_more: boolean;
  total: number;
  latest_seq: number;
}

/**
 * อ่านข้อความในกระทู้แบบแบ่งหน้า
 *
 * ขอมาเกินที่ต้องการหนึ่งแถวเพื่อรู้ว่ายังมีต่อไหม โดยไม่ต้องนับทั้งตารางทุกครั้ง
 * — วิธีเดียวกับที่ใช้ใน cf-odoo-mcp-server หลังเจอว่าผลที่ถูกตัดหน้าตาเหมือนผล
 * ที่ครบ แล้ว agent เอาไปสรุปยอดผิด
 */
export async function readMessages(
  db: D1Database,
  discussionId: string,
  afterSeq: number,
  limit: number,
): Promise<MessagePage> {
  const { results } = await db
    .prepare(
      `SELECT id, seq, kind, body, author_client, author_name, in_reply_to, created_at
         FROM messages
        WHERE discussion_id = ?1 AND seq > ?2
        ORDER BY seq
        LIMIT ?3`,
    )
    .bind(discussionId, afterSeq, limit + 1)
    .all<Message>();

  const hasMore = results.length > limit;
  const messages = hasMore ? results.slice(0, limit) : results;

  const stats = await db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(MAX(seq), 0) AS latest
         FROM messages WHERE discussion_id = ?1`,
    )
    .bind(discussionId)
    .first<{ total: number; latest: number }>();

  return {
    messages,
    has_more: hasMore,
    total: stats?.total ?? messages.length,
    latest_seq: stats?.latest ?? 0,
  };
}

export interface DiscussionSummary {
  id: string;
  title: string;
  created_by: string;
  created_at: string;
  message_count: number;
  latest_seq: number;
  last_activity: string | null;
  participants: string[];
}

export interface WorkspaceContext {
  workspace: Workspace;
  discussions: DiscussionSummary[];
  has_more: boolean;
  /** จำนวนกระทู้ทั้งหมดใน workspace — ความหมายนี้ไม่เปลี่ยนตามการกรอง */
  total_discussions: number;
  /**
   * ผลของการกรองตามความเงียบ — มีอยู่เสมอ ไม่ว่าผู้เรียกจะขอกรองหรือไม่
   *
   * `threshold_days` เป็น null แปลว่าไม่ได้กรอง ซึ่งต่างจากกรองแล้วไม่มีอะไรโดนซ่อน
   * ผู้อ่านต้องแยกสองอย่างนี้ออกจากกันได้จากผลลัพธ์เดียว — หลักเดียวกับที่ `acted_as`
   * แยกใบไม่มีเจ้าของ ออกจากใบที่มีเจ้าของแล้วตรงกัน
   *
   * **ไม่มีค่าเริ่มต้นให้เกณฑ์นี้โดยเจตนา** เพราะกระทู้ที่เงียบสามสิบวันอาจเป็นเรื่อง
   * ที่จบไปแล้ว หรือเรื่องที่รอคนนอกอยู่ ระบบแยกสองอย่างนี้ไม่ออก การตั้งเลขให้เอง
   * คือการตัดสินแทนผู้เรียกด้วยข้อมูลที่ไม่มี
   */
  quiet_discussions: { threshold_days: number | null; hidden: number };
  participants: string[];
}

/**
 * ภาพรวมของ workspace สำหรับ AI ที่เพิ่งเข้ามา
 *
 * รวมสถิติของทุกกระทู้ในคำสั่งเดียว ไม่ใช่ยิงทีละกระทู้ — จำนวนกระทู้โตได้เรื่อย ๆ
 * และ Workers มีเพดาน subrequest อยู่
 */
export async function readWorkspaceContext(
  db: D1Database,
  workspaceId: string,
  limit: number,
  quietForDays?: number,
): Promise<WorkspaceContext> {
  const workspace = await getWorkspace(db, workspaceId);

  // กระทู้ที่ไม่มีข้อความเลย ใช้วันที่เปิดเป็นความเคลื่อนไหวล่าสุด ไม่ใช่ถือว่าเงียบนิรันดร์
  const ACTIVITY = "COALESCE(MAX(m.created_at), d.created_at)";
  const cutoff =
    quietForDays === undefined
      ? null
      : new Date(Date.now() - quietForDays * 86_400_000).toISOString();

  const { results } = await db
    .prepare(
      `SELECT d.id, d.title, d.created_by, d.created_at,
              COUNT(m.id)              AS message_count,
              COALESCE(MAX(m.seq), 0)  AS latest_seq,
              MAX(m.created_at)        AS last_activity,
              GROUP_CONCAT(DISTINCT m.author_name) AS authors
         FROM discussions d
         LEFT JOIN messages m ON m.discussion_id = d.id
        WHERE d.workspace_id = ?1
        GROUP BY d.id
        ${cutoff === null ? "" : `HAVING ${ACTIVITY} >= ?3`}
        ORDER BY ${ACTIVITY} DESC
        LIMIT ?2`,
    )
    .bind(...(cutoff === null ? [workspaceId, limit + 1] : [workspaceId, limit + 1, cutoff]))
    .all<{
      id: string;
      title: string;
      created_by: string;
      created_at: string;
      message_count: number;
      latest_seq: number;
      last_activity: string | null;
      authors: string | null;
    }>();

  const hasMore = results.length > limit;
  const rows = hasMore ? results.slice(0, limit) : results;

  const total = await db
    .prepare("SELECT COUNT(*) AS n FROM discussions WHERE workspace_id = ?1")
    .bind(workspaceId)
    .first<{ n: number }>();

  // นับของที่ถูกกรองออกจริง ๆ ไม่ใช่ลบยอดกัน เพราะ `limit` ตัดจากรายการเดียวกัน
  // แล้วถ้าเอาสองยอดมาลบกัน ของที่แค่เกินเพดานจะถูกรายงานว่าถูกซ่อนเพราะเงียบ
  const quiet =
    cutoff === null
      ? { n: 0 }
      : ((await db
          .prepare(
            `SELECT COUNT(*) AS n FROM (
               SELECT d.id FROM discussions d
                 LEFT JOIN messages m ON m.discussion_id = d.id
                WHERE d.workspace_id = ?1
                GROUP BY d.id
               HAVING ${ACTIVITY} < ?2)`,
          )
          .bind(workspaceId, cutoff)
          .first<{ n: number }>()) ?? { n: 0 });

  const everyone = await db
    .prepare(
      `SELECT DISTINCT m.author_name AS name
         FROM messages m
         JOIN discussions d ON d.id = m.discussion_id
        WHERE d.workspace_id = ?1
        ORDER BY name`,
    )
    .bind(workspaceId)
    .all<{ name: string }>();

  return {
    workspace,
    discussions: rows.map((r) => ({
      id: r.id,
      title: r.title,
      created_by: r.created_by,
      created_at: r.created_at,
      message_count: r.message_count,
      latest_seq: r.latest_seq,
      last_activity: r.last_activity,
      participants: r.authors ? r.authors.split(",") : [],
    })),
    has_more: hasMore,
    total_discussions: total?.n ?? rows.length,
    quiet_discussions: { threshold_days: quietForDays ?? null, hidden: quiet.n },
    participants: everyone.results.map((r) => r.name),
  };
}
