# 06 — Module manifest

> **Proposed ทั้งไฟล์ — ยังไม่ implement ในโค้ดนี้** สิ่งที่ใกล้ที่สุดในโค้ดวันนี้คือ allowlist ของ tool ต่อ client
> (`src/client-policy.ts` `CLIENT_POLICIES`, `resolvePolicy`, `effectiveAllowlist`) และ `READ_ONLY_TOOLS` (`src/readonly.ts`)
> ซึ่งเป็นค่าตั้งในโค้ด ไม่ใช่ manifest ที่โมดูลประกาศเอง

## ข้อกำหนดที่เสนอ สำหรับโมดูล MCP ที่เข้า Cloudflare MCP portal
1. **ชื่อ tool ใช้ prefix ต่อโมดูล** (เช่น `<module_id>_<tool>`) แทนการประกาศว่าไม่ซ้ำ; manifest ประกาศรายชื่อ tool ทั้งหมดล่วงหน้า — ดูคำถามเปิดข้างล่าง
2. **Access ครอบ `/authorize`** — เส้นทาง OAuth authorize ของโมดูลอยู่หลัง Cloudflare Access
3. **Require user auth** — โมดูลต้องรู้ตัวผู้ใช้ทุกการเรียก ไม่รับการเรียกแบบไม่ระบุผู้ใช้
4. **Audit เก็บบัญชี + แอป** — ทุกการเขียนบันทึกบัญชีที่ยืนยันแล้ว และป้ายแอปแยกกัน (ดู Proposed ใน [04](04-identity.md))
5. **ค่าเริ่มต้นอ่านอย่างเดียว** — tool ที่เขียนต้องเปิดเพิ่มโดยชัดแจ้ง
6. **สิทธิ์รายบัญชีอยู่ที่โมดูล ไม่อยู่ที่ portal** — สวิตช์เปิด/ปิด tool ใน portal เป็นค่ารายผู้ใช้ (preference) **ไม่ใช่การควบคุมสิทธิ์**; โมดูลต้องตรวจสิทธิ์เองทุกการเรียก และต้องมี**เทสต์ลบ** ที่พิสูจน์ว่าบัญชีที่ไม่ได้รับอนุญาตถูกปฏิเสธ (ดู [07](07-conformance.md))
7. **เส้นเครื่องไม่รับตัวตนจาก header** — bot ที่ต่อตรงต้องใช้โทเคนผูกชื่อหรือ service token ที่ตรวจได้ (ดู Proposed ใน [04](04-identity.md))
8. **tool ที่ปิดใบหรือปักกติกาประกาศระดับการยืนยันที่ต้องใช้** ผูกกับ `decided_by_method` ใน [03](03-decisions.md)
9. **ระบุวิธีเพิกถอน grant ของบัญชีเดียว** — ข้อเท็จจริงของโต๊ะนี้: การหมุน `MCP_AUTH_TOKEN` **ไม่เพิกถอน** OAuth grant ที่ออกไปแล้ว เพราะ grant เก็บใน `OAUTH_KV` (`src/env.ts`) ส่วน `MCP_AUTH_TOKEN` เป็นรหัสของเส้น static และหน้า consent

## รูป manifest ที่เสนอ (ร่าง)
- `module_id`, `manifest_version`, `contract` (= `2`)
- `tools`: รายชื่อ + `access` ∈ `read | write`
- `auth`: `require_user: true`, `authorize_behind_access: true`
- `audit`: `fields: [account, app_label]`
- `default_access`: `read`
- `auth.machine`: `{ allowed: [named_token, access_service_token], header_identity: false }`
- `tools[].requires`: `owner_signed | approval_secret | none` — สำหรับ tool ที่ปิดใบ/ปักกติกา (ในโต๊ะนี้คือ `resolve_decision`, `set_decision_scope`)
- `revocation`: วิธีเพิกถอน grant ของบัญชีเดียว โดยไม่ต้องหมุนรหัสของทุกคน

## คำถามเปิด (ยังไม่ตัดสิน)
- โต๊ะสองตัวที่ใช้สัญญาเดียวกันมีชื่อ tool ชุดเดียวกัน ถ้าเข้า portal เดียวจะ**ชนกัน** — เลือกระหว่าง (ก) prefix ต่อโมดูล ซึ่งทำให้ชื่อ tool ต่างจากที่ [README](README.md) ระบุ หรือ (ข) portal แยกต่อโต๊ะ
- `owner_signed` จะได้มาจากอะไร — Access identity, การลงนามจากอุปกรณ์เจ้าของ หรืออื่น: ไม่แน่ใจ — ต้องตรวจ

