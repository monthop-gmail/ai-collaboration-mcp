-- เพิ่มช่องบอกว่าใบนี้ผูกเฉพาะเรื่องของมัน หรือเป็นกติกาของทั้งโต๊ะ
--
-- ค่าเริ่มต้น 'project' ทำให้ใบเดิมทั้งหมดไม่เปลี่ยนความหมาย — ของที่มีอยู่แล้ว
-- ไม่มีใบไหนกลายเป็นกติกาโดยอัตโนมัติ ต้องมีคนถือรหัสมาปักเองทีละใบ
--
-- รันครั้งเดียว: npx wrangler d1 execute ai-collab --remote --file migrations/0003-decision-scope.sql

ALTER TABLE decisions ADD COLUMN scope TEXT NOT NULL DEFAULT 'project';
