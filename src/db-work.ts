/**
 * SQL ของสิ่งที่ตกผลึกจากการคุย — decision, task, handoff
 *
 * แยกจาก `db.ts` ซึ่งดูแลฝั่งบทสนทนา เพราะสองกลุ่มนี้เปลี่ยนคนละจังหวะกัน แต่กติกา
 * เดียวกันยังใช้อยู่ทั้งหมด: prepared statement ทุกจุด และผู้กระทำมาจาก connection
 * ไม่ใช่จาก argument
 */

import { RequestError, type Author } from "./db";

export const DECISION_STATUSES = ["proposed", "approved", "rejected"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const TASK_STATUSES = ["open", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Decision {
  id: string;
  workspace_id: string;
  discussion_id: string | null;
  title: string;
  detail: string;
  status: DecisionStatus;
  proposed_by: string;
  proposed_by_client: string;
  created_at: string;
  decided_by: string | null;
  decided_by_kind: string | null;
  decided_at: string | null;
}

export interface Task {
  id: string;
  workspace_id: string;
  discussion_id: string | null;
  title: string;
  detail: string;
  status: TaskStatus;
  assigned_to: string | null;
  created_by: string;
  created_by_client: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}

export interface Handoff {
  id: string;
  task_id: string;
  to_whom: string;
  context: string;
  status: "pending" | "accepted";
  from_name: string;
  from_client: string;
  created_at: string;
  accepted_by: string | null;
  accepted_client: string | null;
  accepted_at: string | null;
}

function now(): string {
  return new Date().toISOString();
}

async function requireWorkspace(db: D1Database, id: string): Promise<void> {
  const row = await db
    .prepare("SELECT id FROM workspaces WHERE id = ?1")
    .bind(id)
    .first<{ id: string }>();
  if (!row) throw new RequestError(`ไม่พบ workspace '${id}'`);
}

async function requireDiscussion(db: D1Database, id: string): Promise<void> {
  const row = await db
    .prepare("SELECT id FROM discussions WHERE id = ?1")
    .bind(id)
    .first<{ id: string }>();
  if (!row) throw new RequestError(`ไม่พบ discussion '${id}'`);
}

/* ── decision ─────────────────────────────────────────────────────────── */

/**
 * บันทึกข้อสรุปที่เสนอให้ตัดสิน
 *
 * สถานะเป็น `proposed` เสมอและตั้งเป็นอย่างอื่นจาก MCP ไม่ได้ — "เสนอ" ไม่เท่ากับ
 * "ตัดสิน" การให้ AI ประกาศว่าเรื่องจบแล้วเองจะทำให้ตารางนี้ไม่ต่างจากข้อความ
 * ธรรมดา ช่อง `decided_by` เผื่อไว้ให้คนอนุมัติซึ่งยังไม่ได้ทำ
 */
export async function recordDecision(
  db: D1Database,
  workspaceId: string,
  title: string,
  detail: string,
  author: Author,
  discussionId?: string,
): Promise<Decision> {
  await requireWorkspace(db, workspaceId);
  if (discussionId !== undefined) await requireDiscussion(db, discussionId);

  const decision: Decision = {
    id: `dec-${crypto.randomUUID()}`,
    workspace_id: workspaceId,
    discussion_id: discussionId ?? null,
    title,
    detail,
    status: "proposed",
    proposed_by: author.name,
    proposed_by_client: author.client,
    created_at: now(),
    decided_by: null,
    decided_by_kind: null,
    decided_at: null,
  };

  await db
    .prepare(
      `INSERT INTO decisions
         (id, workspace_id, discussion_id, title, detail, status,
          proposed_by, proposed_by_client, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      decision.id,
      decision.workspace_id,
      decision.discussion_id,
      decision.title,
      decision.detail,
      decision.status,
      decision.proposed_by,
      decision.proposed_by_client,
      decision.created_at,
    )
    .run();

  return decision;
}

export interface Page<T> {
  rows: T[];
  has_more: boolean;
  total: number;
}

/** อ่านรายการแบบบอกได้ว่าถูกตัดหรือไม่ — ขอเกินมาหนึ่งแถวเพื่อรู้ว่ายังมีต่อ */
async function paginate<T>(
  db: D1Database,
  listSql: string,
  countSql: string,
  params: unknown[],
  limit: number,
): Promise<Page<T>> {
  const { results } = await db
    .prepare(listSql)
    .bind(...params, limit + 1)
    .all<T>();

  const hasMore = results.length > limit;
  const total = await db
    .prepare(countSql)
    .bind(...params)
    .first<{ n: number }>();

  return {
    rows: hasMore ? results.slice(0, limit) : results,
    has_more: hasMore,
    total: total?.n ?? results.length,
  };
}

export async function readDecisions(
  db: D1Database,
  workspaceId: string,
  limit: number,
  status?: DecisionStatus,
): Promise<Page<Decision>> {
  await requireWorkspace(db, workspaceId);

  const filter = status ? " AND status = ?2" : "";
  const params: unknown[] = status ? [workspaceId, status] : [workspaceId];
  const next = status ? "?3" : "?2";

  return paginate<Decision>(
    db,
    `SELECT * FROM decisions WHERE workspace_id = ?1${filter}
      ORDER BY created_at DESC LIMIT ${next}`,
    `SELECT COUNT(*) AS n FROM decisions WHERE workspace_id = ?1${filter}`,
    params,
    limit,
  );
}

/* ── task ─────────────────────────────────────────────────────────────── */

export async function createTask(
  db: D1Database,
  workspaceId: string,
  title: string,
  detail: string,
  author: Author,
  discussionId?: string,
  assignedTo?: string,
): Promise<Task> {
  await requireWorkspace(db, workspaceId);
  if (discussionId !== undefined) await requireDiscussion(db, discussionId);

  const task: Task = {
    id: `task-${crypto.randomUUID()}`,
    workspace_id: workspaceId,
    discussion_id: discussionId ?? null,
    title,
    detail,
    status: "open",
    assigned_to: assignedTo ?? null,
    created_by: author.name,
    created_by_client: author.client,
    created_at: now(),
    updated_by: null,
    updated_at: null,
  };

  await db
    .prepare(
      `INSERT INTO tasks
         (id, workspace_id, discussion_id, title, detail, status, assigned_to,
          created_by, created_by_client, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      task.id,
      task.workspace_id,
      task.discussion_id,
      task.title,
      task.detail,
      task.status,
      task.assigned_to,
      task.created_by,
      task.created_by_client,
      task.created_at,
    )
    .run();

  return task;
}

export async function getTask(db: D1Database, id: string): Promise<Task> {
  const row = await db.prepare("SELECT * FROM tasks WHERE id = ?1").bind(id).first<Task>();
  if (!row) throw new RequestError(`ไม่พบ task '${id}'`);
  return row;
}

/**
 * แก้สถานะหรือผู้รับผิดชอบของงาน
 *
 * ต้องส่งมาอย่างน้อยหนึ่งอย่าง การเรียกโดยไม่เปลี่ยนอะไรเลยแล้วได้ success กลับไป
 * จะทำให้ผู้เรียกเข้าใจว่าแก้แล้วทั้งที่ไม่ได้แก้
 */
export async function updateTask(
  db: D1Database,
  id: string,
  author: Author,
  changes: { status?: TaskStatus; assigned_to?: string; detail?: string },
): Promise<Task> {
  await getTask(db, id);

  const sets: string[] = [];
  const params: unknown[] = [];

  if (changes.status !== undefined) {
    params.push(changes.status);
    sets.push(`status = ?${params.length}`);
  }
  if (changes.assigned_to !== undefined) {
    params.push(changes.assigned_to);
    sets.push(`assigned_to = ?${params.length}`);
  }
  if (changes.detail !== undefined) {
    params.push(changes.detail);
    sets.push(`detail = ?${params.length}`);
  }

  if (sets.length === 0) {
    throw new RequestError("ต้องระบุอย่างน้อยหนึ่งอย่างที่จะแก้ (status, assigned_to หรือ detail)");
  }

  params.push(author.name);
  sets.push(`updated_by = ?${params.length}`);
  params.push(now());
  sets.push(`updated_at = ?${params.length}`);
  params.push(id);

  await db
    .prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?${params.length}`)
    .bind(...params)
    .run();

  return getTask(db, id);
}

export async function readTasks(
  db: D1Database,
  workspaceId: string,
  limit: number,
  filters: { status?: TaskStatus; assigned_to?: string } = {},
): Promise<Page<Task>> {
  await requireWorkspace(db, workspaceId);

  const clauses: string[] = [];
  const params: unknown[] = [workspaceId];

  if (filters.status !== undefined) {
    params.push(filters.status);
    clauses.push(`status = ?${params.length}`);
  }
  if (filters.assigned_to !== undefined) {
    params.push(filters.assigned_to);
    clauses.push(`assigned_to = ?${params.length}`);
  }

  const where = clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";

  return paginate<Task>(
    db,
    `SELECT * FROM tasks WHERE workspace_id = ?1${where}
      ORDER BY created_at DESC LIMIT ?${params.length + 1}`,
    `SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ?1${where}`,
    params,
    limit,
  );
}

/* ── handoff ──────────────────────────────────────────────────────────── */

/**
 * ส่งงานต่อให้คนอื่น
 *
 * ตั้ง `assigned_to` ของงานไปด้วยในคราวเดียว เพราะการส่งต่อที่ไม่เปลี่ยนผู้รับผิดชอบ
 * จะทำให้สองที่พูดไม่ตรงกัน — คนอ่านตาราง task จะไม่รู้ว่างานย้ายไปแล้ว
 *
 * ไม่ตรวจว่าปลายทางมีตัวตนอยู่จริง เพราะ agent ที่จะรับอาจยังไม่เคยต่อเข้ามา
 */
export async function createHandoff(
  db: D1Database,
  taskId: string,
  toWhom: string,
  context: string,
  author: Author,
): Promise<{ handoff: Handoff; task: Task }> {
  await getTask(db, taskId);

  const handoff: Handoff = {
    id: `ho-${crypto.randomUUID()}`,
    task_id: taskId,
    to_whom: toWhom,
    context,
    status: "pending",
    from_name: author.name,
    from_client: author.client,
    created_at: now(),
    accepted_by: null,
    accepted_client: null,
    accepted_at: null,
  };

  await db
    .prepare(
      `INSERT INTO handoffs
         (id, task_id, to_whom, context, status, from_name, from_client, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      handoff.id,
      handoff.task_id,
      handoff.to_whom,
      handoff.context,
      handoff.status,
      handoff.from_name,
      handoff.from_client,
      handoff.created_at,
    )
    .run();

  const task = await updateTask(db, taskId, author, { assigned_to: toWhom });
  return { handoff, task };
}

export async function readHandoffs(
  db: D1Database,
  limit: number,
  filters: { task_id?: string; to_whom?: string; status?: "pending" | "accepted" } = {},
): Promise<Page<Handoff>> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const [column, value] of [
    ["task_id", filters.task_id],
    ["to_whom", filters.to_whom],
    ["status", filters.status],
  ] as const) {
    if (value === undefined) continue;
    params.push(value);
    clauses.push(`${column} = ?${params.length}`);
  }

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";

  return paginate<Handoff>(
    db,
    `SELECT * FROM handoffs${where} ORDER BY created_at DESC LIMIT ?${params.length + 1}`,
    `SELECT COUNT(*) AS n FROM handoffs${where}`,
    params,
    limit,
  );
}

/**
 * รับงานที่ถูกส่งต่อมา
 *
 * ผู้รับคือคนที่เรียก ไม่ใช่ค่าที่ส่งมาใน argument ด้วยเหตุผลเดียวกับผู้เขียนข้อความ
 * และเปลี่ยนงานเป็น `in_progress` พร้อมตั้งผู้รับผิดชอบเป็นชื่อจริงของผู้รับ ซึ่ง
 * อาจไม่ตรงกับ `to_whom` ที่ผู้ส่งพิมพ์ไว้
 */
export async function acceptHandoff(
  db: D1Database,
  handoffId: string,
  author: Author,
): Promise<{ handoff: Handoff; task: Task }> {
  const existing = await db
    .prepare("SELECT * FROM handoffs WHERE id = ?1")
    .bind(handoffId)
    .first<Handoff>();
  if (!existing) throw new RequestError(`ไม่พบ handoff '${handoffId}'`);

  if (existing.status === "accepted") {
    throw new RequestError(
      `handoff นี้ถูกรับไปแล้วโดย ${existing.accepted_by} เมื่อ ${existing.accepted_at}`,
    );
  }

  const acceptedAt = now();
  await db
    .prepare(
      `UPDATE handoffs
          SET status = 'accepted', accepted_by = ?1, accepted_client = ?2, accepted_at = ?3
        WHERE id = ?4`,
    )
    .bind(author.name, author.client, acceptedAt, handoffId)
    .run();

  const task = await updateTask(db, existing.task_id, author, {
    status: "in_progress",
    assigned_to: author.name,
  });

  return {
    handoff: {
      ...existing,
      status: "accepted",
      accepted_by: author.name,
      accepted_client: author.client,
      accepted_at: acceptedAt,
    },
    task,
  };
}
