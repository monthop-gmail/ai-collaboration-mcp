-- เพิ่มช่องบอกว่าใบนี้ผูกเฉพาะเรื่องของมัน หรือเป็นกติกาของทั้งโต๊ะ
--
-- ค่าเริ่มต้น 'project' ทำให้ใบเดิมทั้งหมดไม่เปลี่ยนความหมาย — ของที่มีอยู่แล้ว
-- ไม่มีใบไหนกลายเป็นกติกาโดยอัตโนมัติ ต้องมีคนถือรหัสมาปักเองทีละใบ
--
-- รันให้ครบ **ทุกปลายทาง** ไม่ใช่แค่ production —
-- ก่อน 21 ก.ย. คอมเมนต์บรรทัดนี้เขียนแต่ชื่อ DB ของ production คนที่ทำตาม
-- อย่างซื่อสัตย์ที่สุดจึงลง production ครบแล้วลืม poc ทุกครั้ง จน
-- `get_workspace_context` พังอยู่หลายวันบน poc โดยทีมอื่นเจอก่อนเรา
--
--   npx wrangler d1 execute ai-collab --remote --file migrations/0003-decision-scope.sql
--   npx wrangler d1 execute ai-collab-poc --remote --config wrangler.poc.jsonc --file migrations/0003-decision-scope.sql
--
-- ยืนยันด้วย `./scripts/check-migrations.sh` และ `--poc` ซึ่งถามฐานข้อมูลเอง
-- ว่าคอลัมน์มีจริงไหม · `deploy.sh` เรียกมันให้อยู่แล้วก่อน deploy ทุกครั้ง

ALTER TABLE decisions ADD COLUMN scope TEXT NOT NULL DEFAULT 'project';
