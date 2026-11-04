-- วิธีที่ใช้ยืนยันตอนปิด decision (OAC-1)
--
-- `decided_by_method` บอกว่าการปิดใบผ่านการยืนยันแบบไหน — คนละแกนกับ
-- `decided_by_kind` ซึ่งเป็นระดับของหลักฐาน · วันนี้ server เขียนสองค่า:
--
--   approval_secret  ผู้เรียกส่ง APPROVAL_SECRET ที่ถูกต้องมาด้วย
--   none             ปิดโดยไม่ส่งรหัส (relayed)
--
-- `decided_by_sub` เผื่อไว้ให้ตัวตนที่ยืนยันแล้วในอนาคต · ยังไม่มีโค้ดเส้นไหนเขียน
--
-- **ไม่ backfill** · ใบที่ปิดก่อนไมเกรชันนี้เป็น `NULL` ซึ่งแปลว่า "ไม่ได้บันทึก"
-- ไม่ใช่ "none" — เดาย้อนหลังจาก `decided_by_kind` จะเป็นการเขียนสิ่งที่ไม่ได้วัด
-- ไม่แตะค่าของคอลัมน์เดิมใด ๆ
--
-- รันให้ครบ **ทุกปลายทาง** ไม่ใช่แค่ production —
--
--   npx wrangler d1 execute ai-collab --remote --file migrations/0008-decision-method.sql
--   npx wrangler d1 execute ai-collab-poc --remote --config wrangler.poc.jsonc --file migrations/0008-decision-method.sql
--
-- ยืนยันด้วย `./scripts/check-migrations.sh` และ `--poc` ซึ่งถามฐานข้อมูลเอง
-- รันซ้ำจะ error ว่า duplicate column ซึ่งถูกแล้ว — SQLite ไม่มี ADD COLUMN IF NOT EXISTS

ALTER TABLE decisions ADD COLUMN decided_by_method TEXT;
ALTER TABLE decisions ADD COLUMN decided_by_sub    TEXT;
