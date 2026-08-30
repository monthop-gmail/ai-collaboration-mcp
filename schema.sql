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
