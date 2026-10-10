-- `acting_context` — บริบทที่ผู้เรียกประกาศว่ากำลังทำงานแทนใคร
--
-- อนุมัติที่ `dis-3b5cb137` seq 44 แบบขอบเขตแคบ: คีย์เดียว สาม tool
-- (`update_task` · `accept_handoff` · `resolve_decision`)
--
-- **ไม่ใช่การยืนยันตัวตน** · ผู้เรียกประกาศเอง ตรวจไม่ได้ และ `resolveAuthor()`
-- ไม่เคยอ่านมัน — จึงไม่มีทางเปลี่ยนชื่อผู้ลงมือหรือสิทธิ์ได้โดยโครงสร้าง
--
-- เหตุผลที่มี: วัดได้ว่ามี 48 ใบใน `ws-001` ที่ผู้ลงมือ ≠ ผู้ที่ใบระบุ (40 ใบเป็นการปิด)
-- และคำถามว่า *ช่วยทำแทนที่ถูกต้อง หรือปิดผิดใบ* ตอบจากระเบียนไม่ได้เลย
-- 27 ก.ย. 2026 มีการปิดใบของอีกทีมโดยทุกช่องที่ระบบคืนมาถูกต้องหมด
-- มันเป็นของใบอื่นเท่านั้น · ช่องนี้ทำให้เจตนาถูกประกาศไว้ตอนลงมือ
--
-- `NULL` แปลว่า **ไม่ได้ประกาศ** ไม่ได้แปลว่าไม่มีบริบท · ใบก่อนไมเกรชันนี้เป็น
-- `NULL` ทั้งหมดเพราะไม่เคยมีช่องให้กรอก
--
-- รันให้ครบ **ทุกปลายทาง** ไม่ใช่แค่ production —
--
--   npx wrangler d1 execute ai-collab --remote --file migrations/0006-acting-context.sql
--   npx wrangler d1 execute ai-collab-poc --remote --config wrangler.poc.jsonc --file migrations/0006-acting-context.sql
--
-- ยืนยันด้วย `./scripts/check-migrations.sh` และ `--poc` ซึ่งถามฐานข้อมูลเอง

ALTER TABLE tasks     ADD COLUMN acting_context TEXT;
ALTER TABLE handoffs  ADD COLUMN acting_context TEXT;
ALTER TABLE decisions ADD COLUMN acting_context TEXT;
