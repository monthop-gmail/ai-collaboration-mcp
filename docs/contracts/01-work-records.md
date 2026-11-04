# 01 — ระเบียนงาน

แหล่งความจริง: `schema.sql` + `migrations/0001`–`0007`, ฟังก์ชันใน `src/db.ts` และ `src/db-work.ts`

## Discussion / message
- discussion: `id`, `workspace_id`, `title`, `created_by`, `created_at` (`createDiscussion`)
- message: `seq`, `kind`, `body`, `author_client`, `author_name`, `in_reply_to`, `created_at` (`postMessage`)
- MUST: `seq` เรียงต่อเนื่องต่อกระทู้ เริ่มที่ 1 และ UNIQUE `(discussion_id, seq)` — สองตัวโพสต์พร้อมกันได้เลขซ้ำ ตัวหลังถูกปฏิเสธ ไม่เขียนทับเงียบ (`schema.sql`; เทสต์ `test/db.test.ts` "การออกเลข seq")
- MUST: `kind` ∈ `proposal | review | question | note` (`MESSAGE_KINDS` ใน `src/db.ts`)
- `in_reply_to` = seq ของข้อความในกระทู้เดียวกัน หรือว่าง
- MUST: `get_discussion` อ่านต่อด้วย `after_seq` และบอก `has_more` (`readMessages`)
- MUST: ผู้เขียนมาจาก connection ไม่ใช่ argument (ดู [04](04-identity.md); เทสต์ `test/db.test.ts` "ผู้เขียนมาจาก connection ไม่ใช่จากคำขอ")

## Task
- field: `id`, `workspace_id`, `discussion_id`, `title`, `detail`, `status`, `assigned_to`, `created_by`, `created_by_client`, `created_at`, `updated_by`, `updated_at`, `result_ref`, `acting_context`
- MUST: `status` ∈ `open | in_progress | blocked | done` (`TASK_STATUSES`)
- `assigned_to` เป็นข้อความอิสระ = บันทึกความเป็นเจ้าของเท่านั้น **ไม่ใช่การส่งต่อ** (`handoffReminder` ใน `src/tool-kit.ts`; เทสต์ `test/tool-kit.test.ts`)
- `result_ref` = ตัวชี้ว่าผลอยู่ที่ไหน ไม่ใช่ตัวผล · `null` = ยังไม่มีใครบันทึกตัวชี้ ไม่ได้แปลว่าไม่มีผล (migration 0005; เทสต์ `test/result-ref.test.ts`)
- แถวจาก `get_tasks` มีคีย์ `handoff` = id ของ handoff ที่ยังรอรับ หรือ `null` (`getCurrentHandoffId`)
- `updated_by` เก็บแค่คนล่าสุด ไม่มีประวัติทั้งหมด (คอมเมนต์ใน `schema.sql`)
- MUST: รับ handoff ไม่ลบสถานะ `blocked` (เทสต์ `test/accept-keeps-status.test.ts`)

## Handoff
- field: `id`, `task_id`, `to_whom`, `context`, `status` (`pending | accepted`), `from_name`, `from_client`, `created_at`, `accepted_by`, `accepted_client`, `accepted_at`, `acting_context`, `capability`
- `state` คำนวณตอนอ่าน: `waiting | stale | superseded | obsolete | accepted` (`HANDOFF_STATES`); `stale` = รอเกิน `STALE_AFTER_DAYS = 7`; ที่ต้องมีคนรับคือ `waiting`, `stale` (`ACTIONABLE_HANDOFF_STATES`)
- MUST: `capability` = **declared, not verified** — server ไม่ตรวจว่าผู้รับทำได้จริง และไม่ใช้ตัดสินสิทธิ์; กรองแบบตรงทั้งคำในรายการคั่นจุลภาค ถามได้ทีละค่า (migration 0007, `normalizeCapability`; เทสต์ `test/read-completeness.test.ts`)
- ผลของ `accept_handoff` บอกว่าผู้รับตรงกับผู้ที่จ่าหน้าถึงหรือไม่ (`actedAs`; เทสต์ `test/acted-as.test.ts`)

## Decision และ Plan
- decision ดู [03](03-decisions.md)
- plan: `id`, `workspace_id`, `discussion_id`, `decision_id`, `title`, `body`, `supersedes`, `created_by`, `created_by_client`, `created_at` — ตัวใหม่ชี้หาตัวเก่าด้วย `supersedes` (`recordPlan`)

## Standing rules
decision ที่ `status = approved` และ `scope = workspace` (`readStandingRules`) — ดู [03](03-decisions.md)

## รูปร่างผลลัพธ์ (absent ≠ empty)
- MUST: ทุกแถวมีทุกคีย์เสมอ ค่าที่ไม่มีเป็น `null` ไม่ใช่ตัดคีย์ทิ้ง
- MUST: `summary=true` ตัดได้เฉพาะช่องข้อความยาวช่องเดียว และผลบอก `row_fields` กับ `omitted_fields` เสมอ เพื่อไม่ให้ "ไม่ได้ส่ง" ถูกอ่านเป็น "ว่าง" (`src/tools-work.ts`; เทสต์ `test/response-shape.test.ts`)
- MUST: คีย์บอกความครบ (`total`, `has_more`, `next_cursor`, `warning`) อยู่**ก่อน** array เพื่อไม่ถูกตัดทิ้งพร้อมกัน (เทสต์ `test/pagination.test.ts`, `test/read-completeness.test.ts`)
- MUST: cursor ทึบ เดินผ่านทุกแถวครั้งเดียวพอดี (`test/pagination.test.ts` "cursor เดินผ่านทุกแถวพอดีครั้งเดียว"); `limit` 1–200 ค่าเริ่ม 50 (`DEFAULT_LIMIT`, `MAX_LIMIT`)
- พฤติกรรมที่เป็นอยู่: การไล่รายการแยกตาม workspace แต่การลงมือด้วย id ข้าม workspace ได้ (เทสต์ `test/workspace-isolation.test.ts`) — โต๊ะที่สองไม่ควรถือว่านี่เป็นข้อกำหนด
