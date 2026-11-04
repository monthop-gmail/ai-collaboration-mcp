# 02 — `blocked_kind`

## ที่โค้ดรองรับวันนี้
- ไม่มี `blocked_kind` ในโค้ด schema หรือเทสต์ (ค้นทั้ง `src/` `test/` ไม่พบ)
- มีเพียง `status = blocked` ใน `TASK_STATUSES` (`src/db-work.ts`) เหตุที่ติดอยู่ได้แค่เป็นข้อความอิสระใน `detail` หรือในข้อความกระทู้
- `get_workspace_context` แยกถัง `blocked` ออกจาก `unaccepted` แล้ว (ดู [05](05-workspace-context.md)) แต่ไม่รู้ว่าติดเพราะอะไร

## Proposed (ยังไม่ implement)
ฟิลด์ `blocked_kind` บน task ใช้ได้เมื่อ `status = blocked` ค่าใดค่าหนึ่ง:

| ค่า | ความหมาย |
|---|---|
| `test_fail` | งานทำแล้วแต่เทสต์ไม่ผ่าน |
| `timeout` | หมดเวลาที่กำหนด |
| `quota` | โควต้า/งบของ engine หมด |
| `engine_error` | engine หรือ worker ผิดพลาด |
| `needs_decision` | ต้องให้คนตัดสินก่อนทำต่อ |
| `needs_access` | ไม่มีสิทธิ์เข้าถึงทรัพยากร |

ข้อเสนอประกอบ: ค่าที่ไม่อยู่ใน enum ต้องถูกปฏิเสธ · ตั้ง status อื่นต้องล้างค่าเป็น `null` · ค่าว่างเมื่อ blocked = "ไม่ได้ระบุ" ไม่ใช่ "ไม่มีเหตุ" · ต้องมี migration และเทสต์ก่อนย้ายมาเป็น implemented
