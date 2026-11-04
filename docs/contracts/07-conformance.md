# 07 — Conformance

## เทสต์ที่ล็อกพฤติกรรมตามสัญญาวันนี้ (`npm test`, vitest)

| ไฟล์ | สิ่งที่ล็อก | ไฟล์สัญญา |
|---|---|---|
| `test/response-shape.test.ts` | เลข contract ตรงกันทุก tool · คีย์ระดับบนของ `get_workspace_context` · `open = unstarted + parked` | [README](README.md), [05](05-workspace-context.md) |
| `test/tool-kit.test.ts` | ทุก tool ประกาศ contract · เตือนว่าตั้งผู้รับผิดชอบไม่ใช่การส่งต่อ | [README](README.md), [01](01-work-records.md) |
| `test/db.test.ts` | การออก `seq` · ผู้เขียนมาจาก connection | [01](01-work-records.md), [04](04-identity.md) |
| `test/db-work.test.ts` | วงจร decision และ task | [01](01-work-records.md), [03](03-decisions.md) |
| `test/pagination.test.ts` | หัวผลลัพธ์มาก่อน array · cursor เดินครบครั้งเดียว | [01](01-work-records.md) |
| `test/read-completeness.test.ts` | คีย์บอกความครบอยู่หน้า array · ตัวกรอง `capability` · `total` ของ handoff | [01](01-work-records.md), [05](05-workspace-context.md) |
| `test/result-ref.test.ts` | ตัวชี้ผล · `health.done_without_result` | [01](01-work-records.md), [05](05-workspace-context.md) |
| `test/accept-keeps-status.test.ts` | รับ handoff เลื่อนงานที่ยังไม่เริ่ม แต่ไม่ลบ `blocked` | [01](01-work-records.md) |
| `test/acted-as.test.ts` | ผลบอกว่าผู้รับ/ผู้แก้ตรงกับที่จ่าหน้าหรือไม่ | [01](01-work-records.md) |
| `test/acting-context.test.ts` | ไม่ส่ง `acting_context` เหมือนเดิมทุกประการ · ส่งแล้วถูกบันทึกเป็นคำประกาศ | [04](04-identity.md) |
| `test/standing-rules.test.ts` | ค่าเริ่มไม่ทำให้ใบเป็นกติกา · ปักได้เฉพาะผู้ถือรหัส | [03](03-decisions.md) |
| `test/identity.test.ts`, `test/identity-attribution.test.ts` | ตัวตนจาก OAuth · เส้น static · โทเคนผูกชื่อปลอมไม่ได้ | [04](04-identity.md) |
| `test/unresolved-attribution.test.ts`, `test/participants.test.ts` | ผู้เรียกไม่ประกาศชื่อถูกรายงาน · ชื่อเดียวหลายกุญแจ | [04](04-identity.md) |
| `test/implicit-scope.test.ts` | workspace ที่มาจากค่าเริ่มต้นแยกจากที่ผู้เรียกระบุ | [05](05-workspace-context.md) |
| `test/discussion-filter.test.ts` | `quiet_for_days` บอกยอดที่ซ่อนเสมอ | [05](05-workspace-context.md) |
| `test/workspace-health.test.ts` | handoff ค้างตามอายุของทั้งโต๊ะ · ผู้ลงมือไม่ตรงผู้ที่ระบุ | [05](05-workspace-context.md) |
| `test/workspace-isolation.test.ts` | รายการแยกตาม workspace · ลงมือด้วย id ข้าม workspace ได้ (พฤติกรรมที่เป็นอยู่) | [01](01-work-records.md) |
| `test/approval-hardening.test.ts` | เทียบรหัสแบบ constant-time · รหัสถูก → `human` + `approval_secret` · ไม่ส่ง → `relayed` + `none` · ไม่มีทางได้ `owner_signed` · รหัสผิดไม่ปิดใบ/ไม่เปลี่ยน scope · ทุกแถวมีคีย์ `decided_by_method`/`decided_by_sub` | [03](03-decisions.md) |
| `test/readonly.test.ts` | เส้นอ่านอย่างเดียวผูกกับรหัสของมัน | [04](04-identity.md) |
| `test/client-policy.test.ts`, `test/cross-task-guard.test.ts` | นโยบาย tool ต่อ client · คำเตือนข้ามใบ — เฉพาะ implementation นี้ ไม่ใช่สัญญากลาง | [06](06-module-manifest.md) |

เทสต์ที่เหลือ (`jwt`, `vault`, `view`, `deployment-config`) เป็นเรื่องของ implementation นี้ ไม่ใช่สัญญา

## MUST เพิ่มหลัง OAC-1
- `decided_by_method`: ใบที่ยังไม่ปิดเป็น `null` และใบที่ปิดโดยไม่ส่งรหัสเป็น `"none"` — ล็อกโดย `test/approval-hardening.test.ts` "ชุดคีย์ของแถว decision" และ "ไม่ส่งรหัส → relayed + none" · โต๊ะที่สองต้องไม่ให้ `null` กับ `"none"` ปนกัน
- ใบที่ปิดก่อน migration 0008 ต้องคงเป็น `null`: ไม่มีเทสต์ล็อกตรงข้อนี้ — ล็อกได้แค่ว่า migration ไม่มีคำสั่ง backfill

## Proposed (ยังไม่ implement) — ชุดรันเทียบข้ามโต๊ะ
เทสต์ข้างบนเรียกฟังก์ชันภายในของโต๊ะนี้ อีกโต๊ะรันตรง ๆ ไม่ได้ ข้อเสนอ: ชุดเทสต์ black-box ที่คุยผ่าน MCP endpoint อย่างเดียว
1. `tools/list` — ทุก tool ในรายการของ [README](README.md) มีอยู่ และ description บรรทัดแรก = `contract 2`
2. โพสต์พร้อมกันสองข้อความ → seq ไม่ซ้ำ ไม่หาย
3. ส่งชื่อผู้เขียนใน argument → ถูกเพิกเฉย ผู้เขียนตาม connection
4. `summary=true` → มี `row_fields`, `omitted_fields` · คีย์ความครบอยู่ก่อน array
5. cursor เดินครบทุกแถวครั้งเดียว
6. `resolve_decision` ไม่ส่งรหัส → `decided_by_kind = relayed`; รหัสผิด → error ไม่ปิด
7. `set_decision_scope` workspace บนใบ `proposed` → ปฏิเสธ
8. `get_workspace_context.waiting_for_you` — งานหนึ่งใบอยู่ถังเดียว และ `total` = ผลรวม
9. `health.open_tasks`: `open = unstarted + parked`
10. `capability` กรองตรงทั้งคำ ถามหลายค่าในครั้งเดียวได้ error
11. ปิดใบโดยไม่ส่งรหัส → `decided_by_method = "none"` ไม่ใช่ `null`
12. **เทสต์ลบของสิทธิ์รายบัญชี**: บัญชีที่โมดูลไม่อนุญาตเรียก write tool ตรงด้วย argument ที่ valid → ถูกปฏิเสธ **แม้สวิตช์ใน portal เปิด** (ดู [06](06-module-manifest.md) ข้อ 6)
