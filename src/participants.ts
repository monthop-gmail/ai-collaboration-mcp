/**
 * Phase 1 ข้อ P1.1 — คืน **ข้อเท็จจริงที่สังเกตได้** ของแต่ละชื่อ ไม่ใช่ข้อสรุปว่าใครมีตัวตน
 *
 * `get_workspace_context` มีช่อง `participants` อยู่แล้ว แต่มันนับจาก `author_name` ของ
 * ตาราง `messages` เท่านั้น — **ทีมที่ต่อเข้ามา รับงาน ทำเสร็จ แต่ไม่เคยโพสต์ข้อความ
 * จะไม่มีชื่ออยู่ในนั้นเลย** ส่วนคนที่เข้ามาทักทายครั้งเดียวแล้วหายไปจะมี
 *
 * ถ้าเอารายการนั้นไปใช้ตัดสินว่าปลายทางมีตัวตนไหม **มันกลับหัวกับสิ่งที่อยากวัด**
 *
 * ## สองข้อที่วัดมาแล้วและเป็นเหตุผลของรูปนี้
 *
 * ชื่อ `ChatGPT` ผูกกับรหัส client ของ OAuth อย่างน้อยสี่ค่าที่ต่างกัน · ส่วนชื่อ `Cursor`
 * เป็นรหัสเดียวที่ทำงานอย่างน้อยห้าบทบาท — ผู้ปฏิบัติงานที่ไซต์ ผู้รีวิวสถาปัตยกรรม
 * ผู้ร่างจดหมาย ผู้เปิดกระทู้ และผู้กดรับ handoff ที่จ่าหน้าถึงทีมอื่น
 *
 * > **แถวหนึ่งแถวไม่ใช่หนึ่งตัวตน และไม่ใช่หนึ่งผู้กระทำ · มันเป็นแค่ป้ายชื่อ**
 * > ชื่อเดียวอาจมาจากหลายกุญแจ และกุญแจเดียวอาจเป็นผู้กระทำหลายคนที่ไม่รู้จักกัน
 *
 * จึงไม่คืน `last_seen` ของชื่อเป็นค่าเดียว เพราะมันตอบคำถามที่คนถามจริงไม่ได้ — คำถาม
 * คือ *ปลายทางนี้จะรับงานได้ไหม* ไม่ใช่ *ป้ายนี้ถูกใช้ครั้งล่าสุดเมื่อไร*
 *
 * ## สิ่งที่ตั้งใจไม่คืน
 *
 * **ไม่มี trust · ไม่มี availability · ไม่มี personhood · ไม่มีคะแนน** ตามที่ freeze ไว้ใน
 * `dis-c6095786` seq 7 ข้อ 4 · คืนกลไกกับจำนวน แล้วให้ผู้อ่านสรุปเอง
 */
/** กลไกที่ชื่อนี้เข้ามา — อ่านจาก `author_client` ตรง ๆ ไม่ได้ตีความเพิ่ม */
export const MECHANISMS = ["oauth", "static-header", "static-token"] as const;
export type Mechanism = (typeof MECHANISMS)[number];

export interface ObservedClient {
  /** ค่าที่ server บันทึกไว้จริง ไม่ใช่ของที่ผู้เรียกส่งมาเอง */
  client: string;
  mechanism: Mechanism;
  last_seen: string;
}

export interface ParticipantObservation {
  /** การสะกดล่าสุดที่เห็น — ใช้เป็นชื่อหลักของแถว */
  name: string;
  /**
   * ทุกการสะกดที่เคยเห็นของชื่อเดียวกัน
   *
   * มีมากกว่าหนึ่งเมื่อมีคนพิมพ์ตัวพิมพ์ใหญ่เล็กต่างกัน · ไม่ใช่ข้อผิดพลาด แต่เป็น
   * ความเสี่ยงของการส่งงาน เพราะปลายทางที่พิมพ์คนละแบบอาจไม่ถูกจับคู่ในเครื่องมืออื่น
   */
  spellings: string[];
  /** กุญแจที่เคยใช้ชื่อนี้ — มากกว่าหนึ่งแปลว่าป้ายเดียวมาจากหลายตัวตน */
  clients: ObservedClient[];
  /** เคยพูด — นับจากข้อความในกระทู้ */
  spoke: { messages: number; last_seen: string } | null;
  /**
   * เคยลงมือ — นับจากการกระทำที่ทิ้งร่องรอยไว้ ไม่ใช่การถูกเอ่ยถึง
   *
   * แยกจาก `spoke` เพราะสองอย่างนี้ตอบคำถามคนละข้อ และการยุบให้เหลือค่าเดียวคือ
   * เหตุผลที่ `participants` เดิมตอบคำถามที่คนถามจริงไม่ได้
   */
  acted: { events: number; last_seen: string; kinds: Record<string, number> } | null;
}

export interface ParticipantReport {
  participants: ParticipantObservation[];
  /**
   * ข้อจำกัดเขียนไว้ในผลลัพธ์ ไม่ใช่ในเอกสารข้างนอก
   *
   * ผู้อ่านคือโมเดลที่อ่านผลของ tool ไม่ใช่คนที่เปิด repo — กฎที่อยู่คนละที่กับของที่
   * มันอธิบาย คือกฎที่จะถูกอ่านข้ามไป
   */
  limitations: string[];
}

const LIMITATIONS = [
  "ใช้สรุปว่าปลายทางมีตัวตน พร้อมรับงาน หรือเชื่อถือได้ ไม่ได้ — คืนเฉพาะสิ่งที่ server เห็น",
  "ชื่อเป็นป้ายสำหรับส่งงาน ไม่ใช่ตัวตน — ชื่อเดียวมาจากหลายกุญแจได้ และกุญแจเดียวทำงานหลายบทบาทได้",
  "clients นับจากการกระทำที่บันทึกรหัสไว้เท่านั้น — การแก้ใบและการเปิดกระทู้ไม่ได้เก็บรหัส จึงนับใน acted แต่ไม่โผล่ใน clients",
  "ไม่มีชื่อในรายการ แปลว่าไม่เคยทั้งพูดและลงมือใน workspace นี้ ไม่ได้แปลว่าไม่มีอยู่",
] as const;

function mechanismOf(client: string): Mechanism {
  if (client.startsWith("static-token:")) return "static-token";
  if (client.startsWith("static-header:")) return "static-header";
  return "oauth";
}

interface Row {
  name: string | null;
  client?: string | null;
  n: number;
  last_seen: string | null;
}

/** แต่ละคิวรีสั้นโดยตั้งใจ — D1 จำกัดจำนวนท่อนใน compound SELECT ไว้ต่ำกว่าที่คาด */
const ACTED_QUERIES: Array<{ kind: string; sql: string }> = [
  {
    kind: "handoffs_accepted",
    sql: `SELECT h.accepted_by AS name, h.accepted_client AS client,
                 COUNT(*) AS n, MAX(h.accepted_at) AS last_seen
            FROM handoffs h JOIN tasks t ON t.id = h.task_id
           WHERE t.workspace_id = ?1 AND h.accepted_by IS NOT NULL
           GROUP BY h.accepted_by, h.accepted_client`,
  },
  {
    kind: "tasks_created",
    sql: `SELECT created_by AS name, created_by_client AS client,
                 COUNT(*) AS n, MAX(created_at) AS last_seen
            FROM tasks WHERE workspace_id = ?1 GROUP BY created_by, created_by_client`,
  },
  {
    kind: "tasks_updated",
    sql: `SELECT updated_by AS name, NULL AS client,
                 COUNT(*) AS n, MAX(updated_at) AS last_seen
            FROM tasks WHERE workspace_id = ?1 AND updated_by IS NOT NULL GROUP BY updated_by`,
  },
  {
    kind: "discussions_created",
    sql: `SELECT created_by AS name, NULL AS client,
                 COUNT(*) AS n, MAX(created_at) AS last_seen
            FROM discussions WHERE workspace_id = ?1 GROUP BY created_by`,
  },
  {
    kind: "decisions_proposed",
    sql: `SELECT proposed_by AS name, proposed_by_client AS client,
                 COUNT(*) AS n, MAX(created_at) AS last_seen
            FROM decisions WHERE workspace_id = ?1 GROUP BY proposed_by, proposed_by_client`,
  },
  {
    kind: "decisions_decided",
    sql: `SELECT decided_by AS name, decided_by_client AS client,
                 COUNT(*) AS n, MAX(decided_at) AS last_seen
            FROM decisions WHERE workspace_id = ?1 AND decided_by IS NOT NULL
           GROUP BY decided_by, decided_by_client`,
  },
  {
    kind: "plans_created",
    sql: `SELECT created_by AS name, created_by_client AS client,
                 COUNT(*) AS n, MAX(created_at) AS last_seen
            FROM plans WHERE workspace_id = ?1 GROUP BY created_by, created_by_client`,
  },
];

const SPOKE_SQL = `SELECT m.author_name AS name, m.author_client AS client,
                          COUNT(*) AS n, MAX(m.created_at) AS last_seen
                     FROM messages m JOIN discussions d ON d.id = m.discussion_id
                    WHERE d.workspace_id = ?1
                    GROUP BY m.author_name, m.author_client`;

/** เก็บของทีละชื่อ โดยจับคู่แบบไม่สนตัวพิมพ์ — กติกาเดียวกับที่ `waiting_for_you` ใช้ */
class Bucket {
  spellings = new Map<string, string>();
  clients = new Map<string, ObservedClient>();
  spokeCount = 0;
  spokeLast: string | null = null;
  actedKinds: Record<string, number> = {};
  actedCount = 0;
  actedLast: string | null = null;
  latestSpelling = "";
  latestAt = "";

  see(name: string, at: string | null): void {
    this.spellings.set(name, name);
    if (at && at > this.latestAt) {
      this.latestAt = at;
      this.latestSpelling = name;
    }
    if (!this.latestSpelling) this.latestSpelling = name;
  }

  addClient(client: string | null | undefined, at: string | null): void {
    if (!client || !at) return;
    const seen = this.clients.get(client);
    if (!seen || at > seen.last_seen) {
      this.clients.set(client, { client, mechanism: mechanismOf(client), last_seen: at });
    }
  }
}

export async function readParticipants(
  db: D1Database,
  workspaceId: string,
): Promise<ParticipantReport> {
  const statements = [
    db.prepare(SPOKE_SQL).bind(workspaceId),
    ...ACTED_QUERIES.map((q) => db.prepare(q.sql).bind(workspaceId)),
  ];
  const [spoke, ...acted] = await db.batch(statements);

  const buckets = new Map<string, Bucket>();
  const bucketFor = (name: string): Bucket => {
    const key = name.toLowerCase();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = new Bucket();
      buckets.set(key, bucket);
    }
    return bucket;
  };

  for (const row of spoke.results as Row[]) {
    if (!row.name) continue;
    const bucket = bucketFor(row.name);
    bucket.see(row.name, row.last_seen);
    bucket.addClient(row.client, row.last_seen);
    bucket.spokeCount += row.n;
    if (row.last_seen && (!bucket.spokeLast || row.last_seen > bucket.spokeLast)) {
      bucket.spokeLast = row.last_seen;
    }
  }

  acted.forEach((result, index) => {
    const kind = ACTED_QUERIES[index].kind;
    for (const row of result.results as Row[]) {
      if (!row.name) continue;
      const bucket = bucketFor(row.name);
      bucket.see(row.name, row.last_seen);
      bucket.addClient(row.client, row.last_seen);
      bucket.actedKinds[kind] = (bucket.actedKinds[kind] ?? 0) + row.n;
      bucket.actedCount += row.n;
      if (row.last_seen && (!bucket.actedLast || row.last_seen > bucket.actedLast)) {
        bucket.actedLast = row.last_seen;
      }
    }
  });

  const participants = [...buckets.values()]
    .map((b) => ({
      name: b.latestSpelling,
      spellings: [...b.spellings.keys()].sort(),
      clients: [...b.clients.values()].sort((a, c) => c.last_seen.localeCompare(a.last_seen)),
      spoke: b.spokeLast ? { messages: b.spokeCount, last_seen: b.spokeLast } : null,
      acted: b.actedLast
        ? { events: b.actedCount, last_seen: b.actedLast, kinds: b.actedKinds }
        : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { participants, limitations: [...LIMITATIONS] };
}
