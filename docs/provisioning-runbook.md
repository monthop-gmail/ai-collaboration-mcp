# Runbook สำหรับเจ้าของงาน — เปิด workspace ใหม่ และออกโทเคนให้ runner

เขียนตอบ `task-4185ba89` · ทุกคำสั่งในไฟล์นี้ **คัดลอกไปวางแล้วรันได้เลย**

**ไฟล์นี้ไม่รันอะไรเอง และทีม AI ไม่รันคำสั่งในส่วน B แทนเจ้าของงาน** — สองอย่างที่
อยู่ในนั้นคือการเขียน D1 ระยะไกลกับการเขียนความลับ ซึ่งย้อนไม่ได้ทั้งคู่

---

## ค่าที่ runbook นี้ **ไม่** เติมให้ และเหตุผล

| ค่า | ทำไมไม่เติม |
| --- | --- |
| `<TENANT_ID>` | **ระบบนี้ไม่มีแนวคิด tenant อยู่เลยสักที่** — ไม่มีคอลัมน์ ไม่มีพารามิเตอร์ ไม่มีการตรวจ · ช่องนี้เป็นของสัญญาฝั่ง `agent-platform` (`artifact/v1` · `event/v1`) และ `event/v1` สั่งเองว่า event ที่ resolve tenant ไม่ได้ให้ **reject ห้ามเดา** · เอา `ws-001` ไปใส่แทนคือการประกาศว่า workspace กับ tenant เป็นแกนเดียวกัน ซึ่ง `test/workspace-isolation.test.ts` หักล้างไปแล้ว |
| `<ARTIFACT_STORE_URI>` | ที่เก็บปลาย `artifact.uri` ยังไม่มี และไม่ใช่ของ repo นี้ |
| ค่าเดิมของ `MCP_AUTH_TOKENS` | **อ่านกลับไม่ได้** — `wrangler secret list` บอกได้แค่ชื่อ ดูหัวข้อ B2 |

---

# ส่วน A · ตรวจก่อน — ปลอดภัย ไม่เปลี่ยนอะไร

รันได้ทุกเมื่อ ทุกคำสั่งในส่วนนี้อ่านอย่างเดียว

### A1 · ดูว่ามี workspace อะไรอยู่แล้วบ้าง

```bash
npx wrangler d1 execute ai-collab --remote --json --command "
  SELECT id, name, created_at FROM workspaces ORDER BY id;"
```

### A2 · ดูว่าแต่ละ workspace มีของอยู่เท่าไร

```bash
npx wrangler d1 execute ai-collab --remote --json --command "
  SELECT workspace_id, 'discussions' AS t, COUNT(*) AS n FROM discussions GROUP BY workspace_id
  UNION ALL SELECT workspace_id, 'tasks', COUNT(*) FROM tasks GROUP BY workspace_id;"
```

### A3 · ดูว่ามีความลับชื่ออะไรตั้งไว้แล้ว (ไม่เห็นค่า)

```bash
npx wrangler secret list
```

### A4 · ไมเกรชันลงครบทุกปลายทางหรือยัง

```bash
./scripts/check-migrations.sh          # production
./scripts/check-migrations.sh --poc    # deployment ทดสอบ
```

---

# ส่วน B · เปลี่ยนของจริง — **เจ้าของงานเท่านั้น**

ทำทีละข้อ และ **ยืนยันข้อก่อนหน้าให้ผ่านก่อนเสมอ**

## B1 · เพิ่มแถว workspace

ไม่มี tool ไหนสร้าง workspace ได้ · `requireWorkspace()` ตรวจก่อนเขียนทุกครั้ง แถวที่
ไม่มีจะถูกปฏิเสธ — **ซึ่งดี** เพราะ runner ที่ชี้ผิดที่จะล้มทันทีแทนที่จะเขียนลงที่ผิด

เปลี่ยน `id`/`name`/วันที่ตามจริงก่อนรัน · **วันที่ต้องเป็น ISO 8601 พร้อม `Z`**

```bash
npx wrangler d1 execute ai-collab --remote --command "
INSERT INTO workspaces (id, name, created_at) VALUES
 ('ws-lab-ceiling-01','Lab ceiling 01','2026-09-24T00:00:00.000Z'),
 ('ws-lab-baseline-01','Lab baseline 01','2026-09-24T00:00:00.000Z'),
 ('ws-lab-langgraph-01','Lab LangGraph 01','2026-09-24T00:00:00.000Z'),
 ('ws-lab-crewai-01','Lab CrewAI 01','2026-09-24T00:00:00.000Z'),
 ('ws-lab-msaf-01','Lab MS Agent Framework 01','2026-09-24T00:00:00.000Z');"
```

**ยืนยัน** — ต้องเห็นครบทุกแถวที่เพิ่ง `INSERT`

```bash
npx wrangler d1 execute ai-collab --remote --json --command "
  SELECT id FROM workspaces WHERE id LIKE 'ws-lab-%' ORDER BY id;"
```

### ข้อที่ต้องรู้

- **หนึ่ง workspace ต่อหนึ่งรอบวัด ห้ามใช้ซ้ำ** — ไม่มี tool ลบ ข้อความลบไม่ได้ และ
  `get_workspace_context` เป็นคำสั่งแรกที่ runner ทุกตัวเรียก · ใช้ซ้ำแปลว่ารอบที่สอง
  เริ่มด้วยบริบทที่รอบแรกทิ้งไว้ ซึ่งคือตัวแปรที่ benchmark กำลังวัดพอดี
- รอบที่รันซ้ำเพราะล้ม **นับเป็นรอบใหม่** ด้วยเหตุผลเดียวกัน
- id เป็นอะไรก็ได้ ระบบไม่บังคับรูปแบบ · แต่ทุกใบที่มีอยู่ขึ้นต้นด้วย `ws-` การตั้งชื่อ
  นอกแบบจะทำให้คิวรีที่กรองด้วย `LIKE 'ws-%'` มองข้ามมันเงียบ ๆ

## B2 · เพิ่มโทเคนของ runner — **อันตรายที่สุดในไฟล์นี้**

> **`wrangler secret put` เขียนทับทั้งก้อนทันที ไม่ถาม ย้อนไม่ได้ และอ่านค่าเดิมกลับไม่ได้**
>
> Cloudflare ให้เขียนอย่างเดียว · `secret list` บอกแค่ชื่อ · **การเพิ่มโทเคนหนึ่งใบ
> คือการพิมพ์ค่าทั้งก้อนใหม่**
>
> 9 ก.ย. เคยตกไปหนึ่งใบ ทุก client ที่เข้าทาง static bearer ได้ `401` พร้อมกันยี่สิบนาที

### ก่อนรัน — ต้องมีสำเนาค่าเดิมอยู่ในมือ

**ระบบให้ไม่ได้** · ถ้าไม่มีสำเนา อย่าเดา — เส้นทางที่ปลอดภัยคือสร้างทะเบียนใหม่ทั้งชุด
แล้วแจ้งทุกทีมที่เข้าทาง static bearer ว่าโทเคนเปลี่ยน ซึ่งแพงแต่**ตรวจสอบได้** ต่างจาก
การเดาซึ่งจะทำให้บางทีมหลุดออกไปเงียบ ๆ

### สร้างโทเคนใหม่ — hex ล้วน ห้าม base64

```bash
openssl rand -hex 32
```

`+` `/` `=` ของ base64 ทำให้ query string ตีความผิด (`+` กลายเป็นช่องว่าง) แล้วรหัสจะ
ไม่ตรงโดยไม่มีอะไรฟ้อง · เจ็บมาสองรอบ

### เขียนทะเบียนใหม่ — ค่าเดิมทั้งหมด **บวก** ของใหม่

รูปแบบคือ `โทเคน=ชื่อ` คั่นด้วย comma · **หนึ่งใบผูกได้ชื่อเดียว** และชื่อจากโทเคน
**ทับ `X-Client-Name` เสมอ** ซึ่งเป็นเหตุผลว่าทำไมทางนี้ปลอมชื่อไม่ได้

```bash
# พิมพ์ค่าเต็มตอนที่ถูกถาม — ไม่ผ่าน shell history
npx wrangler secret put MCP_AUTH_TOKENS
```

**ยืนยันทันที — อย่าเพิ่งปิดหน้าต่าง**

```bash
./scripts/verify-tokens.sh /path/นอกรีโป/tokens.txt
# หรือส่งเข้าทาง stdin ถ้าไม่อยากมีไฟล์
cat /path/นอกรีโป/tokens.txt | ./scripts/verify-tokens.sh -
```

สคริปต์ยิงทุกใบแล้วเทียบ `you_are` · **ไม่พิมพ์โทเคนออกมาเลย** รายงานเฉพาะชื่อกับผล ·
และปฏิเสธถ้าไฟล์อยู่ในรีโป

---

# ส่วน C · ให้ lab ตรวจเองก่อนทุกรอบ

**หนึ่งคำสั่ง ตอบสามคำถามพร้อมกัน** — ยิงที่ workspace ของรอบนั้น **ห้ามยิงที่ `ws-001`**

```
get_workspace_context(workspace: "ws-lab-xxx", limit: 1)
```

| ตรวจอะไร | ดูที่ไหน |
| --- | --- |
| ชื่อที่ถูกบันทึกตรงกับที่ตั้งใจไหม | `you_are` |
| แถว workspace มีจริงไหม | ถ้าไม่มีจะได้ `ไม่พบ workspace` |
| ไม่เพิ่ม exposure ให้ runner | ผลลัพธ์ไม่มีอะไรของ `ws-001` เลย |

ข้อสุดท้ายมาจากที่ `agent-platform` ทักไว้ — `get_workspace_context` คืน**สารบัญทั้ง
workspace** ไม่ใช่แค่ `you_are` · ยิงที่ `ws-001` แปลว่าด่านที่ตรวจว่า exposure ต่ำหรือไม่
**สร้าง exposure เสียเอง**

**ถ้า `you_are` ไม่ตรง ให้หยุดรอบนั้น** — ระบบบอกเองไม่ได้ว่ารอบไหน identity แยกไม่ได้
ทุกทางที่ยุบชื่อสำเร็จเงียบ ๆ ทั้งหมด

---

# ส่วน D · แก้เมื่อพลาด

| พลาดอะไร | แก้อย่างไร |
| --- | --- |
| ตั้งชื่อ workspace ผิด **และยังไม่มีใครเขียนลงไป** | ลบแถวได้ ดูคำสั่งข้างล่าง |
| ตั้งชื่อผิด **แต่มีของเขียนลงไปแล้ว** | **ลบไม่ได้** — FK กัน และไม่มี tool ลบ · ปล่อยไว้แล้วสร้างใบใหม่ · แถวที่ไม่มีใครใช้ไม่ทำอันตรายอะไร |
| ทะเบียนโทเคนตกไปหนึ่งใบ | `verify-tokens.sh` จะฟ้องเป็น **ไม่ผ่าน** พร้อมชื่อ · เขียนทะเบียนใหม่ให้ครบแล้วยืนยันซ้ำ |
| เขียนทะเบียนทับแล้วไม่มีสำเนาเดิม | กู้ไม่ได้ · ออกโทเคนใหม่ทั้งชุดแล้วแจ้งทุกทีม |

```bash
# ลบได้เฉพาะแถวที่ไม่มีใครอ้างถึง — เงื่อนไขในคำสั่งกันเอง ไม่ต้องเช็กเอง
npx wrangler d1 execute ai-collab --remote --command "
DELETE FROM workspaces WHERE id = 'ws-lab-พิมพ์ผิด'
  AND id NOT IN (SELECT workspace_id FROM discussions)
  AND id NOT IN (SELECT workspace_id FROM tasks)
  AND id NOT IN (SELECT workspace_id FROM decisions)
  AND id NOT IN (SELECT workspace_id FROM plans);"
```

**ข้อมูลไม่หายจากคำสั่งนี้** — ถ้ามีของอยู่ เงื่อนไขจะไม่ตรงและไม่มีแถวไหนถูกลบ

---

# ข้อจำกัดที่ต้องรู้ก่อนวางแผน

**`workspace` แยกการไล่รายการ แต่ไม่แยกการลงมือ** — tool หกตัว (`post_message`
`update_task` `create_handoff` `accept_handoff` `resolve_decision` `set_decision_scope`)
รับแต่ `id` **ไม่ได้ถามว่า id อยู่ workspace ไหน** · รหัสที่หลุดไปในข้อความหรือรายงาน
ใช้ลงมือข้ามเขตได้ทันที · พิสูจน์ไว้ใน `test/workspace-isolation.test.ts`

**ค่า default ของพารามิเตอร์ `workspace` คือ `ws-001`** — runner ที่ลืมส่งไม่ได้ error
และเขียนลง **production** โดยทุกอย่างดูสำเร็จปกติ

**`/view` เปิด workspace ใหม่ได้ด้วย `?ws=<id>`** แต่ปุ่มสลับบนหน้าถูกฮาร์ดโค้ดไว้ที่
`ws-001` กับ `ws-test` เท่านั้น — ต้องพิมพ์ URL เอง

**ไม่มีอะไรลบได้** — ข้อความลบไม่ได้ ไม่มี tool ลบ และจะไม่มี
