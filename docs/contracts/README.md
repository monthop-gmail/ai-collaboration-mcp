# สัญญากลางของโต๊ะประสานงาน — ฉบับแรก (CTR-1)

เอกสารนี้ถอดจาก**โค้ดของ repo นี้ตามที่เป็นอยู่** ที่ `main` @ `b797b93d` (CTR-1) และอัปเดตที่ `main` @ `5b3dc02` หลัง OAC-1 (#49, merge `151f9f6a`) (CTR-2) โต๊ะนี้คือ reference implementation
โต๊ะตัวที่สองต้อง implement ตามสเปกนี้ให้สลับกันได้

**หลัก: สัญญาเป็นมาตรฐาน ไม่ใช่ตัวโมดูล** ผู้เรียก (AI/bot/คน) ผูกกับรูปร่างของ tool และผลลัพธ์ ไม่ผูกกับโค้ดหรือฐานข้อมูลของโต๊ะใดโต๊ะหนึ่ง

## คำศัพท์
- **MUST** = โต๊ะที่อ้างว่าทำตามสัญญาต้องทำ และมีเทสต์ใน `test/` ล็อกไว้ (ดู [07](07-conformance.md))
- **SHOULD** = โค้ดนี้ทำ แต่ยังไม่มีเทสต์ล็อก หรือเป็นรายละเอียดที่อีกโต๊ะอาจทำต่างได้โดยไม่ทำให้ผู้เรียกพัง
- **Proposed (ยังไม่ implement)** = ยังไม่มีในโค้ด ห้ามอ้างว่ามีแล้ว

## เวอร์ชัน
- เลข contract = **`contract 2`** — `CONTRACT_VERSION = 2` ใน `src/tool-kit.ts`
- MUST: ทุก tool ขึ้นต้น description ด้วย `contract 2` (`registerTool` ใน `src/tool-kit.ts`) และผลลัพธ์มีคีย์ `contract: 2`
  (เทสต์ `test/response-shape.test.ts` "เลข contract ตรงกันทุกที่", `test/tool-kit.test.ts` "ประกาศเลข contract ให้ทุก tool")
- เลขเป็นจำนวนเต็ม ไม่ใช่ semver; ใช้วินิจฉัยว่าผู้เรียกกับโต๊ะพูดรุ่นเดียวกันไหม ไม่ใช่กลไกกันพัง (คอมเมนต์ใน `src/tool-kit.ts`)

## Tool ที่อยู่ในสัญญา
`create_discussion` · `post_message` · `get_discussion` · `get_workspace_context` (`src/tools.ts`) ·
`record_decision` · `get_decisions` · `set_decision_scope` · `resolve_decision` · `record_plan` · `get_plans` ·
`create_task` · `update_task` · `get_tasks` · `create_handoff` · `get_handoffs` · `accept_handoff` (`src/tools-work.ts`) ·
`get_participants` — รวม 17 tool ที่ลงทะเบียนผ่าน `registerTool` ใน `src/`

## สถานะต่อข้อ

| ข้อ | ไฟล์ | สถานะ | หลักฐานในโค้ด |
|---|---|---|---|
| ระเบียนงาน (discussion · task · handoff · decision · plan) | [01](01-work-records.md) | implemented | `schema.sql`, `src/db.ts` `postMessage`/`readMessages`, `src/db-work.ts` `createTask`/`updateTask`/`createHandoff`/`acceptHandoff`/`recordPlan` |
| `blocked_kind` | [02](02-blocked-kind.md) | **proposed** | ไม่มีในโค้ด — มีแค่ `status = blocked` ใน `TASK_STATUSES` |
| การตัดสินใจ + standing rules + `decided_by_method` | [03](03-decisions.md) | implemented (`owner_signed` proposed · ความหมายของ `human` แคบ ดูไฟล์) | `src/db-work.ts` `recordDecision`/`resolveDecision`/`setDecisionScope`/`readStandingRules`, migration 0008, `test/approval-hardening.test.ts` |
| ตัวตนผู้เขียน | [04](04-identity.md) | implemented; "บัญชี + ป้ายแอป" และกติกาเส้นเครื่อง proposed | `src/identity.ts` `resolveAuthor`/`staticIdentityFor`/`nameForToken`, `src/index.ts` `authorizeReadOnly`/`hasStaticBearer` |
| `get_workspace_context` | [05](05-workspace-context.md) | implemented | `src/tools.ts`, `src/db.ts` `readWorkspaceContext`, `src/db-work.ts` `readOpenItems`/`readWorkspaceHealth` |
| Module manifest | [06](06-module-manifest.md) | **proposed ทั้งไฟล์** | — |
| Conformance | [07](07-conformance.md) | partial (มีเทสต์ของโต๊ะนี้; ชุดรันเทียบข้ามโต๊ะยัง proposed) | `test/*.test.ts` |
