# 03 — การตัดสินใจ

แหล่งความจริง: `src/db-work.ts` `recordDecision`, `resolveDecision`, `setDecisionScope`, `readStandingRules`; `schema.sql` ตาราง `decisions`; migrations 0001–0004

## สถานะ
- MUST: `status` ∈ `proposed | approved | rejected` (`DECISION_STATUSES`) · `record_decision` สร้างได้เฉพาะ `proposed` ไม่มี tool ให้ AI สร้างเป็น `approved` ตรง ๆ
- ปิดได้ครั้งเดียว — ปิดซ้ำได้ error ที่บอกว่าใครปิดเมื่อไหร่ (`resolveDecision`)
- `superseded_by` (ตอนปฏิเสธเพราะซ้ำ): ห้ามชี้ตัวเอง · ต้องอยู่ workspace เดียวกัน · ห้ามชี้ใบที่ `rejected` (`resolveDecision`)

## `decided_by_kind` — ความหมายจริงวันนี้
server เป็นผู้กำหนด ผู้เรียกเลือกเองไม่ได้ (`resolveDecision`):
- `human` = ผู้เรียกส่ง `approval_code` ที่**ตรงกับ `APPROVAL_SECRET`** ของ server — แปลว่า "มีผู้ส่งรหัสลับถูก" **ไม่ใช่** "คนคนนี้กดเอง" ใครถือรหัสก็ได้ `human` ทั้ง AI ที่ได้รหัสมา
- `relayed` = ไม่ส่งรหัส (ค่าเริ่มต้น) — AI บอกว่าคนสั่ง ไม่มีอะไรยืนยัน
- ถ้าส่งรหัสแต่ server ไม่ได้ตั้ง `APPROVAL_SECRET` หรือรหัสผิด → error ไม่ปิดใบ
- type `DecidedByKind` มีค่า `ai` ด้วย แต่ `resolveDecision` ตั้งได้แค่ `relayed` หรือ `human` — ค่า `ai` ไม่มีเส้นทางเขียนในโค้ดวันนี้
- เก็บ `decided_by`, `decided_by_client` (จาก connection), `decided_reason`, `decided_at`, `acting_context`

## `set_decision_scope`
- MUST: `scope` ∈ `project | workspace` ค่าเริ่ม `project` (`DECISION_SCOPES`, migration 0003)
- MUST: เปลี่ยนได้เฉพาะเมื่อส่ง `approval_code` ตรงกับ `APPROVAL_SECRET` และตั้ง `workspace` ได้เฉพาะใบที่ `approved` (`setDecisionScope`; เทสต์ `test/standing-rules.test.ts` "ปักได้เฉพาะเมื่อมีคนถือรหัส")
- บันทึก `scope_set_by`, `scope_set_at` ทั้งตอนปักและถอด (migration 0004) — คนละเรื่องกับ `decided_by`
- ใบ `approved` + `workspace` = standing rule แสดงใน `get_workspace_context.standing_rules` เป็น id + title (`readStandingRules`)

## Proposed (ยังไม่ implement)
- `decided_by_method` ∈ `approval_secret | owner_signed | none` — บอก**วิธี**ที่ได้หลักฐาน แยกจากระดับ `decided_by_kind`
- `decided_by_sub` — ตัวระบุบัญชีของผู้อนุมัติ (เช่น subject จาก IdP) เมื่อ method เป็น `owner_signed`
- เมื่อมีสองฟิลด์นี้ `human` จะหมายถึง "บัญชีเจ้าของยืนยันเอง" ได้จริง; ระหว่างนี้ผู้อ่านต้องตีความ `human` ตามข้างบน
