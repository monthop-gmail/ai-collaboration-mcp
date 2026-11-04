# 05 — `get_workspace_context`

แหล่งความจริง: `src/tools.ts` (handler ของ `get_workspace_context`), `src/db.ts` `readWorkspaceContext`, `src/db-work.ts` `readOpenItems`, `readWorkspaceHealth`, `readStandingRules`

## Input
`workspace` (ค่าเริ่ม `ws-001`) · `limit` 1–200 · `quiet_for_days` (ซ่อนกระทู้ที่เงียบเกินกำหนด; ไม่ส่ง = ไม่ซ่อน)

## คีย์ระดับบน (ลำดับตามโค้ด)
`contract` · `workspace` · `you_are` · `has_more` · `total_discussions` · `quiet_discussions` (`threshold_days`, `hidden`) ·
`warning` (เฉพาะเมื่อ `has_more`) · `standing_rules` · `participants` · `open_items` · `discussions`

- MUST: ชุดคีย์ระดับบน `contract, workspace, you_are, has_more, total_discussions, quiet_discussions, standing_rules, participants, open_items, discussions` (+ `warning` เมื่อไม่ครบ) ล็อกโดยเทสต์ `test/response-shape.test.ts` "get_workspace_context คืนคีย์ระดับบนชุดนี้"

- MUST: คีย์บอกความครบอยู่หน้า `discussions`, `participants`, `open_items` และอยู่ในสองร้อยไบต์แรก (เทสต์ `test/read-completeness.test.ts`)
- MUST: ขอ `quiet_for_days` แล้วต้องบอกเสมอว่าซ่อนไปกี่อัน (เทสต์ `test/discussion-filter.test.ts`)
- `participants` = ชื่อที่**เคยโพสต์** เท่านั้น ผู้ที่ลงมือโดยไม่โพสต์ดูที่ `get_participants`

## `open_items`
ยอดของโต๊ะ เช่น `decisions_awaiting`, `plans_current`, `latest_plan`, `tasks` (นับต่อ status), `handoffs_pending` (= ยอดที่ต้องมีคนรับจริง), `handoffs_inactive` และ `waiting_for_you`, `health` (`readOpenItems`)

### `waiting_for_you` — ห้าถัง
งานทุกใบที่จ่าหน้าถึงผู้เรียกอยู่ในถังเดียวเท่านั้น และ `total` คือผลรวม (`readOpenItems`):

| ถัง | เนื้อหา |
|---|---|
| `unaccepted` | `handoffs` ที่ต้องรับ + `tasks` ที่ยังไม่มีใครรับ |
| `in_progress` | งานที่กำลังทำ |
| `blocked` | ติดอยู่ — ต้องปลดล็อก ไม่ใช่รับ |
| `parked` | จอดไว้โดยตั้งใจ: `title` หรือ `detail` ขึ้นต้นด้วย `PARKED` (`IS_PARKED`) |
| `accepted_not_started` | ของผู้เรียกแล้ว แต่ status ยัง `open` |

ลำดับการจัดถัง: `blocked` มาก่อน `parked` ก่อน `accepted_not_started` ก่อน `unaccepted` แต่ละถังแสดงตัวอย่างไม่เกิน 10 แถว (`WAITING_PREVIEW`) พร้อม `total`
- MUST: ก่อน 2026-10-12 ถัง blocked/parked/accepted_not_started นับรวมใน `unaccepted` — ผู้อ่านตัวเลขเก่าต้องรู้ (description ของ tool)

### `health` (`WorkspaceHealth`)
- `handoffs`: `waiting`, `stale`, `inactive` — ของทั้งโต๊ะ ไม่ใช่ของผู้เรียก
- `delegated`: แถวที่ผู้ลงมือไม่ตรงกับผู้ที่บันทึกระบุ (`handoffs`, `tasks`, `total`)
- `open_tasks`: `unstarted` และ `parked` — MUST: `open = unstarted + parked` เสมอ (เทสต์ `test/response-shape.test.ts` "health แตกยอดเดิม ไม่ได้หักยอดเดิม")
- `done_without_result`: งาน done ที่ไม่มี `result_ref` (เทสต์ `test/result-ref.test.ts`)
- `unseen_targets`: ชื่อปลายทาง handoff ที่ไม่เคยลงมือในโต๊ะนี้
- ทุกค่าเป็นข้อสังเกต ไม่ใช่คำตัดสิน (เทสต์ `test/workspace-health.test.ts`)

### `standing_rules`
decision `approved` + `scope = workspace` แสดง id และ title เท่านั้น อ่านรายละเอียดด้วย `get_decisions` ([03](03-decisions.md))
