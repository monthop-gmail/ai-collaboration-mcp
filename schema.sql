-- โต๊ะประชุมกลางของ AI ทุกค่าย — schema ของ Phase 1
--
-- รันซ้ำได้ ทุกคำสั่งเป็น IF NOT EXISTS และ seed ใช้ INSERT OR IGNORE

CREATE TABLE IF NOT EXISTS workspaces (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discussions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title        TEXT NOT NULL,
  -- ชื่อ client ที่เปิดกระทู้ ไม่ใช่ค่าที่ client ส่งมาเอง
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discussions_workspace
  ON discussions (workspace_id, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id),

  -- เลขเรียงต่อเนื่องต่อกระทู้ เริ่มที่ 1
  --
  -- UNIQUE ข้างล่างคือหัวใจของทั้ง schema: ถ้าสองตัวโพสต์พร้อมกันแล้วคำนวณ seq
  -- ได้เลขเดียวกัน ตัวที่สองจะถูก database ปฏิเสธ ไม่ใช่เขียนทับเงียบ ๆ
  -- ทำให้ "AI ทุกตัวเห็นลำดับเดียวกัน" เป็นสิ่งที่ database รับประกัน
  seq           INTEGER NOT NULL,

  -- proposal / review / question / note — เส้นแบ่งระหว่างโต๊ะประชุมกับห้องแชต
  kind          TEXT NOT NULL,
  body          TEXT NOT NULL,

  -- มาจาก OAuth token เท่านั้น client ส่งมาเองไม่ได้ ไม่งั้นปลอมเป็นใครก็ได้
  author_client TEXT NOT NULL,
  author_name   TEXT NOT NULL,

  -- seq ของข้อความที่กำลังตอบ อยู่ในกระทู้เดียวกัน
  in_reply_to   INTEGER,
  created_at    TEXT NOT NULL,

  UNIQUE (discussion_id, seq)
);

INSERT OR IGNORE INTO workspaces (id, name, created_at)
VALUES ('ws-001', 'Workspace #001', '2026-08-30T00:00:00.000Z');

-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — สิ่งที่ตกผลึกจากการคุย
-- ─────────────────────────────────────────────────────────────────────────

-- ข้อสรุปที่เสนอให้ตัดสิน
--
-- แยกจาก message เพราะ "เสนอ" กับ "ตัดสินแล้ว" คนละสถานะกัน ข้อความในกระทู้คือ
-- การถกเถียง ส่วนตารางนี้คือสิ่งที่ต้องผูกพันกันต่อ
CREATE TABLE IF NOT EXISTS decisions (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  -- กระทู้ที่เป็นที่มา อาจว่างได้ถ้าตัดสินนอกกระทู้
  discussion_id TEXT REFERENCES discussions(id),
  title         TEXT NOT NULL,
  detail        TEXT NOT NULL,

  -- proposed | approved | rejected
  --
  -- MCP สร้างได้เฉพาะ proposed เท่านั้น ไม่มี tool ไหนให้ AI ตั้งเป็น approved
  -- เพราะ "เสนอ" ไม่เท่ากับ "ตัดสิน" ช่องด้านล่างเผื่อไว้ให้คนอนุมัติ (AC 8)
  -- ซึ่งยังไม่ได้ทำ
  status        TEXT NOT NULL,

  proposed_by        TEXT NOT NULL,
  proposed_by_client TEXT NOT NULL,
  created_at         TEXT NOT NULL,

  -- ใครเป็นคนเคาะ และเป็นคนหรือ AI — ว่างอยู่จนกว่าจะมีคนอนุมัติ
  decided_by      TEXT,
  decided_by_kind TEXT,
  decided_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_decisions_workspace
  ON decisions (workspace_id, created_at);

-- งานที่ต้องมีคนทำ
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  discussion_id TEXT REFERENCES discussions(id),
  title         TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',

  -- open | in_progress | blocked | done
  status        TEXT NOT NULL,
  -- ชื่อผู้รับผิดชอบ เป็นข้อความอิสระเพราะ agent ปลายทางอาจยังไม่เคยต่อเข้ามา
  assigned_to   TEXT,

  created_by        TEXT NOT NULL,
  created_by_client TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  -- คนล่าสุดที่แก้ ยังไม่ได้เก็บประวัติทั้งหมด ดู NOTES หัวข้อข้อจำกัด
  updated_by        TEXT,
  updated_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace
  ON tasks (workspace_id, status, created_at);

-- การส่งต่องาน
--
-- ไม่ใช่แค่เปลี่ยนชื่อผู้รับผิดชอบ เพราะของที่มีค่าคือ "ทำอะไรไปแล้ว เหลืออะไร
-- ติดตรงไหน" ซึ่งเป็นสิ่งที่หายไปทุกครั้งเวลาส่งงานกันด้วยการเปลี่ยน field เฉย ๆ
CREATE TABLE IF NOT EXISTS handoffs (
  id       TEXT PRIMARY KEY,
  task_id  TEXT NOT NULL REFERENCES tasks(id),
  to_whom  TEXT NOT NULL,
  context  TEXT NOT NULL,

  -- pending | accepted
  status   TEXT NOT NULL,

  from_name   TEXT NOT NULL,
  from_client TEXT NOT NULL,
  created_at  TEXT NOT NULL,

  accepted_by     TEXT,
  accepted_client TEXT,
  accepted_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_handoffs_task    ON handoffs (task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_handoffs_pending ON handoffs (status, created_at);

-- แผนที่จะลงมือทำ
--
-- แยกจากข้อความในกระทู้เพราะแผนคือของที่ส่งให้คนไป implement ต้องหาเจอโดยไม่ต้อง
-- อ่านทั้งกระทู้ ถ้าเป็นข้อความที่ 17 ในกระทู้ที่มี 40 ข้อความ คนที่เพิ่งเข้ามาจะ
-- ถามว่า "แผนคืออะไร" ไม่ได้ และแผนอาจหลุดออกนอกหน้าที่อ่านมาโดยไม่มีใครรู้
--
-- แก้ไม่ได้แต่เขียนทับได้ — ถ้าแผนเปลี่ยนให้บันทึกใหม่แล้วชี้ `supersedes` ไปตัวเก่า
-- รักษาหลัก append-only เหมือนข้อความ และทำให้ตามรอยได้ว่าแผนเปลี่ยนไปยังไง
CREATE TABLE IF NOT EXISTS plans (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  -- กระทู้และข้อสรุปที่เป็นที่มา ว่างได้ทั้งคู่
  discussion_id TEXT REFERENCES discussions(id),
  decision_id   TEXT REFERENCES decisions(id),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  -- แผนตัวก่อนที่แผนนี้มาแทน ว่างแปลว่าเป็นแผนแรก
  supersedes    TEXT REFERENCES plans(id),

  created_by        TEXT NOT NULL,
  created_by_client TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plans_workspace  ON plans (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plans_supersedes ON plans (supersedes);
