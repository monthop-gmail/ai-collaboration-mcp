-- เพิ่มช่องสำหรับการปิด decision (approve / reject)
--
-- `schema.sql` คือรูปร่างที่ถูกต้องสำหรับ database ใหม่และสำหรับ test ส่วนไฟล์ใน
-- โฟลเดอร์นี้คือบันทึกว่าทำอะไรกับ database ที่มีข้อมูลอยู่แล้วบ้าง เพราะ
-- `CREATE TABLE IF NOT EXISTS` ไม่เพิ่มคอลัมน์ให้ตารางที่มีอยู่
--
-- รันครั้งเดียว: npx wrangler d1 execute ai-collab --remote --file migrations/0001-decision-resolution.sql
-- รันซ้ำจะ error ว่า duplicate column ซึ่งถูกแล้ว — SQLite ไม่มี ADD COLUMN IF NOT EXISTS

ALTER TABLE decisions ADD COLUMN decided_by_client TEXT;
ALTER TABLE decisions ADD COLUMN decided_reason    TEXT;
