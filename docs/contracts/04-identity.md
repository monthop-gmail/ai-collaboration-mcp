# 04 — ตัวตนผู้เขียน

แหล่งความจริง: `src/identity.ts` (`resolveAuthor`, `staticIdentityFor`, `nameForToken`, `readClientNameHeader`, `CLIENT_PREFIX`, `mechanismOfClient`), `src/index.ts`

## หลัก
- MUST: ตัวตนผู้เขียนมาจาก **connection** ไม่ใช่ argument ของ tool — ไม่มี tool ไหนรับชื่อผู้เขียน (`resolveAuthor`; เทสต์ `test/db.test.ts`, `test/identity.test.ts`)
- MUST: `acting_context` = บริบทที่ผู้เรียก**ประกาศ** ว่าทำแทนใคร · ตรวจไม่ได้ · ไม่ใช่ identity · ไม่เปลี่ยนผู้ที่ถูกบันทึกเป็นผู้ลงมือ · ไม่ส่ง = `null` เหมือนเดิมทุกประการ (migration 0006, `normalizeActingContext`; เทสต์ `test/acting-context.test.ts`)

## ลำดับการได้ตัวตน (ตามโค้ด)
1. **OAuth** — ถ้ามี props จาก OAuth: `client` = client id, `name` = ชื่อ client (`resolveAuthor` → `oauthClient`)
2. ไม่มี OAuth (เส้น static bearer) ให้ `staticIdentityFor` เลือกตามลำดับ:
   1. **โทเคนผูกชื่อ** — โทเคนตรงกับรายการใน `MCP_AUTH_TOKENS` → `client = static-token:<ชื่อ>` (`nameForToken`) — ทางเดียวในเส้นนี้ที่ปลอมชื่อไม่ได้ (เทสต์ `test/identity-attribution.test.ts`)
   2. **header `X-Client-Name`** → `client = static-header:<ชื่อ>` ตัด control char, ยาวเกิน 140 ตัวถูกปฏิเสธ ไม่ตัดให้ (`readClientNameHeader`)
   3. **ค่าตั้ง `STATIC_CLIENT_NAME`** → `client = static-bearer`, `name` = ค่าที่ตั้ง
   4. ไม่มีอะไรเลย → `client = static-bearer`, `name = "Static bearer"`
- **เส้น JWT มีเฉพาะ `/mcp-readonly`** — `authorizeReadOnly` (`src/index.ts` L397): ถ้าตั้งค่า gateway JWT ครบและโทเคนมีรูป JWT (`looksLikeJwt`, L404) ตรวจลายเซ็นก่อน ได้ `client = jwt:<sub>` · ตรวจไม่ผ่าน**ไม่ตกไป**ลองรหัสอื่น · โทเคนที่ไม่ใช่รูป JWT จึงไปเทียบ `MCP_READONLY_TOKENS` (L416) · ตั้งค่า JWT ไม่ครบ = ปฏิเสธทุกคำขอบนเส้นนี้ (`gatewaySetup`)
- **เส้น `/mcp` ไม่มี JWT** — ลำดับใน `fetch` (`src/index.ts` L458–498): static bearer ก่อน (`hasStaticBearer` L422/L470: `MCP_AUTH_TOKENS` แล้ว `MCP_AUTH_TOKEN`) ถ้าไม่ผ่านตกไปที่ OAuth provider (L498) ซึ่งให้ตัวตนข้อ 1 · ชื่อของเส้น static เลือกตามข้อ 2 (`staticIdentityFor`, L172–173)
- `mechanismOfClient` อ่านชนิดทางเข้าย้อนจากคำนำหน้า; `oauth` คือค่าที่เหลือ ไม่ใช่ค่าที่ตรวจเจอ (`get_participants` limitations)
- เส้นอ่านอย่างเดียว `/mcp-readonly` ใช้ `MCP_READONLY_TOKENS` และจำกัด tool ด้วย `READ_ONLY_TOOLS` (`src/readonly.ts`; เทสต์ `test/readonly.test.ts`)
- `static-bearer` กลืนสองกรณี (ตั้งชื่อ/ไม่ตั้ง) แยกจากสิ่งที่บันทึกไม่ได้ — `get_participants.unresolved_attribution` รายงานผู้เรียกกลุ่มนี้ (เทสต์ `test/unresolved-attribution.test.ts`)
- ชื่อเป็นป้ายสำหรับส่งงาน ไม่ใช่ตัวตน: ชื่อเดียวมาจากหลายกุญแจได้ (เทสต์ `test/participants.test.ts`)

## Proposed (ยังไม่ implement)
- ระบุผู้เขียนด้วย **บัญชี + ป้ายแอป** แทน client id: บัญชี = subject ที่ IdP ยืนยัน · ป้ายแอป = ชื่อ client/แอปที่ใช้
- ป้ายแอปใช้**แสดงผลเท่านั้น** ห้ามใช้ตัดสินสิทธิ์หรือรวมเป็นตัวตน
- client id ใหม่ต่อการเชื่อมต่อจะไม่แตกบัญชีเดียวเป็นหลายผู้เขียนอีก
- **เส้นเครื่อง** (bot ต่อตรง ไม่ผ่าน portal) ยอมรับเป็นตัวตนได้เพียง `static-token:<ชื่อ>` (โทเคนผูกชื่อ) หรือ JWT/service token ที่ตรวจลายเซ็นได้ · **ไม่รับ `static-header:` เป็นตัวตนของ bot** เพราะใครถือโทเคนกลางก็ประกาศชื่อใดก็ได้ — วันนี้โค้ดยังรับ header อยู่ (ข้อ 2.2)
- audit ควรมี `actor_type` ∈ `human | bot | service` แยกจากชื่อ
