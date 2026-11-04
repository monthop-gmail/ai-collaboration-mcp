# 06 — Module manifest

> **Proposed ทั้งไฟล์ — ยังไม่ implement ในโค้ดนี้** สิ่งที่ใกล้ที่สุดในโค้ดวันนี้คือ allowlist ของ tool ต่อ client
> (`src/client-policy.ts` `CLIENT_POLICIES`, `resolvePolicy`, `effectiveAllowlist`) และ `READ_ONLY_TOOLS` (`src/readonly.ts`)
> ซึ่งเป็นค่าตั้งในโค้ด ไม่ใช่ manifest ที่โมดูลประกาศเอง

## ข้อกำหนดที่เสนอ สำหรับโมดูล MCP ที่เข้า Cloudflare MCP portal
1. **ชื่อ tool ไม่ชน** — ทุก tool มีชื่อไม่ซ้ำกับโมดูลอื่นใน portal เดียวกัน; manifest ประกาศรายชื่อ tool ทั้งหมดล่วงหน้า
2. **Access ครอบ `/authorize`** — เส้นทาง OAuth authorize ของโมดูลอยู่หลัง Cloudflare Access
3. **Require user auth** — โมดูลต้องรู้ตัวผู้ใช้ทุกการเรียก ไม่รับการเรียกแบบไม่ระบุผู้ใช้
4. **Audit เก็บบัญชี + แอป** — ทุกการเขียนบันทึกบัญชีที่ยืนยันแล้ว และป้ายแอปแยกกัน (ดู Proposed ใน [04](04-identity.md))
5. **ค่าเริ่มต้นอ่านอย่างเดียว** — tool ที่เขียนต้องเปิดเพิ่มโดยชัดแจ้ง
6. **สิทธิ์รายบัญชีอยู่ที่โมดูล ไม่อยู่ที่ portal** — สวิตช์เปิด/ปิด tool ใน portal เป็นค่ารายผู้ใช้ (preference) **ไม่ใช่การควบคุมสิทธิ์**; โมดูลต้องตรวจสิทธิ์เองทุกการเรียก

## รูป manifest ที่เสนอ (ร่าง)
- `module_id`, `manifest_version`, `contract` (= `2`)
- `tools`: รายชื่อ + `access` ∈ `read | write`
- `auth`: `require_user: true`, `authorize_behind_access: true`
- `audit`: `fields: [account, app_label]`
- `default_access`: `read`
