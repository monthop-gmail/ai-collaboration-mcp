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
- เก็บ `decided_by`, `decided_by_client` (จาก connection), `decided_reason`, `decided_at`, `acting_context`, `decided_by_method`
- การเทียบรหัสเป็นแบบ constant-time (`timingSafeEqualStr` จาก `src/timing-safe.ts`) ทั้งใน `resolveDecision` และ `setDecisionScope` · รหัสยาวกว่าที่ขึ้นต้นด้วยรหัสจริงถูกปฏิเสธ (เทสต์ `test/approval-hardening.test.ts` describe "timingSafeEqualStr", "resolve_decision · decided_by_method")
- `decided_by_client` แบบ `static-header:<ชื่อ>` เป็น**ป้ายที่ผู้ถือโทเคนประกาศเอง** ผ่าน header ไม่ใช่ตัวตนที่ตรวจแล้ว (ดู [04](04-identity.md)) — ผู้อ่านต้องดู `decided_by_method` ประกอบเสมอ และไม่ตีความ `human` เกินกว่า "มีผู้ส่งรหัสลับถูก"

## `set_decision_scope`
- MUST: `scope` ∈ `project | workspace` ค่าเริ่ม `project` (`DECISION_SCOPES`, migration 0003)
- MUST: เปลี่ยนได้เฉพาะเมื่อส่ง `approval_code` ตรงกับ `APPROVAL_SECRET` และตั้ง `workspace` ได้เฉพาะใบที่ `approved` (`setDecisionScope`; เทสต์ `test/standing-rules.test.ts` "ปักได้เฉพาะเมื่อมีคนถือรหัส")
- บันทึก `scope_set_by`, `scope_set_at` ทั้งตอนปักและถอด (migration 0004) — คนละเรื่องกับ `decided_by`
- ใบ `approved` + `workspace` = standing rule แสดงใน `get_workspace_context.standing_rules` เป็น id + title (`readStandingRules`)

## `decided_by_method` และ `decided_by_sub` (OAC-1 · implemented)
แหล่งความจริง: migration `0008-decision-method.sql` · `DecidedByMethod` และ `resolveDecision` ใน `src/db-work.ts` · เทสต์ `test/approval-hardening.test.ts`

- `decided_by_method` = **วิธี**ที่ใช้ยืนยันตอนปิดใบ คนละแกนกับ `decided_by_kind` ซึ่งเป็นระดับหลักฐาน · server เขียนวันนี้สองค่า:
  - `approval_secret` — ส่ง `approval_code` ตรงกับ `APPROVAL_SECRET` (คู่กับ `decided_by_kind = human`)
  - `none` — ปิดโดยไม่ส่งรหัส (คู่กับ `decided_by_kind = relayed`)
- `decided_by_sub` = ช่องสำหรับตัวระบุบัญชีที่ยืนยันแล้วในอนาคต · **ยังไม่มีเส้นไหนเขียน** ค่าเป็น `null` เสมอ
- MUST: ทุกแถว decision มีคีย์ `decided_by_method` และ `decided_by_sub` เสมอ ใบที่ยังไม่ปิดเป็น `null` (เทสต์ "ชุดคีย์ของแถว decision")
- MUST: **`null` = "ระบบยังไม่ได้เก็บ"** ≠ **`"none"` = "เก็บแล้ว และไม่มีการยืนยัน"** · ใบที่ปิดก่อน migration 0008 เป็น `null` รวมถึงใบ `human` เก่า
- MUST: **ห้าม backfill** `decided_by_method` จาก `decided_by_kind` หรือคอลัมน์อื่น เพราะเป็นการเขียนสิ่งที่ไม่ได้วัด (คอมเมนต์ใน migration 0008)
- ไม่มีเส้นทางใดให้ค่า `owner_signed` (เทสต์ "ไม่มีทางได้ owner_signed")
- สถานะ runtime: deploy production แล้ว แถวปิดโดยไม่ส่งรหัสได้ `none` ตามคาด · **เส้น `approval_secret` บน runtime จริงยังรอหลักฐาน** เพราะยังไม่มีใบ `human` หลัง deploy (มีเทสต์ในโค้ดแล้ว)

## Proposed (ยังไม่ implement)
- ค่า `owner_signed` ของ `decided_by_method` — บัญชีเจ้าของลงนามยืนยันเอง และเขียน `decided_by_sub` จาก subject ที่ IdP ยืนยัน
- เมื่อมี `owner_signed` แล้ว `human` จะหมายถึง "บัญชีเจ้าของยืนยันเอง" ได้จริง; ระหว่างนี้ผู้อ่านต้องตีความ `human` ตามข้างบน
