-- เพิ่มช่องชี้ว่าตัวที่ถูกปฏิเสธถูกแทนด้วยอันไหน
--
-- รันครั้งเดียว: npx wrangler d1 execute ai-collab --remote --file migrations/0002-decision-superseded-by.sql

ALTER TABLE decisions ADD COLUMN superseded_by TEXT REFERENCES decisions(id);
