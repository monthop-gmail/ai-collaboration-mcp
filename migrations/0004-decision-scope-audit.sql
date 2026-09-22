-- บันทึกว่าใครเปลี่ยน `scope` ล่าสุดและเมื่อไหร่
--
-- ไมเกรชัน 0003 เพิ่ม `scope` แต่ไม่ได้เก็บว่าใครปัก ผลคือตอบได้ว่า "ทุกใบที่ถูกปัก
-- มีคนถือรหัสเป็นคนทำ" แต่ตอบไม่ได้ว่า "ใบไหนใครปักตอนไหน"
--
-- ว่างทั้งสองช่องแปลว่าไม่มีใครเคยแตะ `scope` ของใบนั้น ซึ่งเป็นจริงสำหรับใบเดิม
-- ทุกใบ ยกเว้น dec-9850cb54 ที่ถูกปักไปก่อนมีคอลัมน์นี้ — ของใบนั้นจะว่างเหมือนกัน
-- และนั่นคือความจริง ไม่ใช่ข้อมูลหาย เราไม่มีบันทึกว่าใครปักจริง ๆ
--
-- รันให้ครบ **ทุกปลายทาง** ไม่ใช่แค่ production —
-- ก่อน 21 ก.ย. คอมเมนต์บรรทัดนี้เขียนแต่ชื่อ DB ของ production คนที่ทำตาม
-- อย่างซื่อสัตย์ที่สุดจึงลง production ครบแล้วลืม poc ทุกครั้ง จน
-- `get_workspace_context` พังอยู่หลายวันบน poc โดยทีมอื่นเจอก่อนเรา
--
--   npx wrangler d1 execute ai-collab --remote --file migrations/0004-decision-scope-audit.sql
--   npx wrangler d1 execute ai-collab-poc --remote --config wrangler.poc.jsonc --file migrations/0004-decision-scope-audit.sql
--
-- ยืนยันด้วย `./scripts/check-migrations.sh` และ `--poc` ซึ่งถามฐานข้อมูลเอง
-- ว่าคอลัมน์มีจริงไหม · `deploy.sh` เรียกมันให้อยู่แล้วก่อน deploy ทุกครั้ง

ALTER TABLE decisions ADD COLUMN scope_set_by TEXT;
ALTER TABLE decisions ADD COLUMN scope_set_at TEXT;
