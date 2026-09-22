-- เพิ่มช่องสำหรับการปิด decision (approve / reject)
--
-- `schema.sql` คือรูปร่างที่ถูกต้องสำหรับ database ใหม่และสำหรับ test ส่วนไฟล์ใน
-- โฟลเดอร์นี้คือบันทึกว่าทำอะไรกับ database ที่มีข้อมูลอยู่แล้วบ้าง เพราะ
-- `CREATE TABLE IF NOT EXISTS` ไม่เพิ่มคอลัมน์ให้ตารางที่มีอยู่
--
-- รันให้ครบ **ทุกปลายทาง** ไม่ใช่แค่ production —
-- ก่อน 21 ก.ย. คอมเมนต์บรรทัดนี้เขียนแต่ชื่อ DB ของ production คนที่ทำตาม
-- อย่างซื่อสัตย์ที่สุดจึงลง production ครบแล้วลืม poc ทุกครั้ง จน
-- `get_workspace_context` พังอยู่หลายวันบน poc โดยทีมอื่นเจอก่อนเรา
--
--   npx wrangler d1 execute ai-collab --remote --file migrations/0001-decision-resolution.sql
--   npx wrangler d1 execute ai-collab-poc --remote --config wrangler.poc.jsonc --file migrations/0001-decision-resolution.sql
--
-- ยืนยันด้วย `./scripts/check-migrations.sh` และ `--poc` ซึ่งถามฐานข้อมูลเอง
-- ว่าคอลัมน์มีจริงไหม · `deploy.sh` เรียกมันให้อยู่แล้วก่อน deploy ทุกครั้ง
-- รันซ้ำจะ error ว่า duplicate column ซึ่งถูกแล้ว — SQLite ไม่มี ADD COLUMN IF NOT EXISTS

ALTER TABLE decisions ADD COLUMN decided_by_client TEXT;
ALTER TABLE decisions ADD COLUMN decided_reason    TEXT;
