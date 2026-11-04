# 06 — Module manifest

> **Proposed ทั้งไฟล์ — ยังไม่ implement ในโค้ดนี้** สิ่งที่ใกล้ที่สุดในโค้ดวันนี้คือ allowlist ของ tool ต่อ client
> (`src/client-policy.ts` `CLIENT_POLICIES`, `resolvePolicy`, `effectiveAllowlist`) และ `READ_ONLY_TOOLS` (`src/readonly.ts`)
> ซึ่งเป็นค่าตั้งในโค้ด ไม่ใช่ manifest ที่โมดูลประกาศเอง

## ข้อกำหนดที่เสนอ สำหรับโมดูล MCP ที่เข้า Cloudflare MCP portal
1. **ชื่อ tool ในสัญญาคงเดิม ไม่ต้องใส่ prefix เอง — prefix เกิดที่ชั้น portal** · manifest ประกาศรายชื่อ tool ทั้งหมดล่วงหน้า
   - ข้อเท็จจริง (ทดสอบจริง 3–4 พ.ย. 2026): Cloudflare MCP portal ตั้งชื่อ tool ที่ผู้ใช้เห็นเป็น `<server>_<tool>` เอง ⇒ โมดูลสองตัวที่มีชื่อ tool เดียวกันไม่ชนกันใน portal เดียว
   - ถ้าใช้**นอก portal** (client เดียวต่อตรงหลายโมดูล) ชื่อยังอาจชนได้ · client แต่ละค่ายจัดการชื่อซ้ำอย่างไร: ไม่แน่ใจ — ต้องตรวจ
2. **Access ครอบ `/authorize`** — เส้นทาง OAuth authorize ของโมดูลอยู่หลัง Cloudflare Access
3. **Require user auth** — โมดูลต้องรู้ตัวผู้ใช้ทุกการเรียก ไม่รับการเรียกแบบไม่ระบุผู้ใช้
4. **Audit เก็บบัญชี + แอป** — ทุกการเขียนบันทึกบัญชีที่ยืนยันแล้ว และป้ายแอปแยกกัน (ดู Proposed ใน [04](04-identity.md))
5. **ค่าเริ่มต้นอ่านอย่างเดียว** — tool ที่เขียนต้องเปิดเพิ่มโดยชัดแจ้ง
6. **สิทธิ์รายบัญชีอยู่ที่โมดูล ไม่อยู่ที่ portal** — สวิตช์เปิด/ปิด tool ใน portal เป็นค่ารายผู้ใช้ (preference) **ไม่ใช่การควบคุมสิทธิ์**; โมดูลต้องตรวจสิทธิ์เองทุกการเรียก และต้องมี**เทสต์ลบ** ที่พิสูจน์ว่าบัญชีที่ไม่ได้รับอนุญาตถูกปฏิเสธ (ดู [07](07-conformance.md))
7. **เส้นเครื่องไม่รับตัวตนจาก header** — bot ที่ต่อตรงต้องใช้โทเคนผูกชื่อหรือ service token ที่ตรวจได้ (ดู Proposed ใน [04](04-identity.md))
8. **tool ที่ปิดใบหรือปักกติกาประกาศระดับการยืนยันที่ต้องใช้** ผูกกับ `decided_by_method` ใน [03](03-decisions.md)
9. **ระบุวิธีเพิกถอน grant ของบัญชีเดียว** — ข้อเท็จจริงของโต๊ะนี้: การหมุน `MCP_AUTH_TOKEN` **ไม่เพิกถอน** OAuth grant ที่ออกไปแล้ว เพราะ grant เก็บใน `OAUTH_KV` (`src/env.ts`) ส่วน `MCP_AUTH_TOKEN` เป็นรหัสของเส้น static และหน้า consent
10. **การเปลี่ยนรายการ tool เป็น breaking change ต่อการเชื่อมต่อที่มีอยู่** — เพิ่ม ลบ หรือเปลี่ยนชื่อ tool ต้องถือว่ากระทบผู้ใช้ทุกคนที่เชื่อมต่ออยู่
    - ข้อเท็จจริง (ทดสอบจริง 3–4 พ.ย. 2026): เมื่อ upstream เพิ่ม tool ใหม่ แอดมินต้อง sync server ที่ portal และการเชื่อมต่อของผู้ใช้ที่มีอยู่**ไม่ได้รับ tool ใหม่เอง** ผู้ใช้ต้องปิด-เปิด server ใน selection ของตัวเอง · ก่อนนั้นการเรียก tool ใหม่ได้ JSON-RPC `-32602` ซึ่งแยกไม่ได้จากชื่อผิดหรือ server ถูกปิด
    - manifest ต้องมี `tools_version` (เลขรุ่น หรือ hash ของรายการ tool) ที่เปลี่ยนทุกครั้งที่รายการ tool เปลี่ยน
    - ขั้นตอน deploy ของโมดูลที่เปลี่ยน `tools_version` ต้องมี: (ก) sync server ที่ portal (ข) แจ้งผู้ใช้ให้โหลด selection ใหม่ (ปิด-เปิด server) — ผู้ใช้ที่เจอ `-32602` หลัง deploy ให้ทำข้อ (ข) ก่อนสรุปว่า tool เสีย

## รูป manifest ที่เสนอ (ร่าง)
- `module_id`, `manifest_version`, `contract` (= `2`)
- `tools`: รายชื่อ + `access` ∈ `read | write` (ชื่อตามสัญญา ไม่ใส่ prefix — ข้อ 1)
- `tools_version`: เลขรุ่นหรือ hash ของรายการ tool — เปลี่ยนเมื่อรายการ tool เปลี่ยน (ข้อ 10)
- `auth`: `require_user: true`, `authorize_behind_access: true`
- `audit`: `fields: [account, app_label]`
- `default_access`: `read`
- `auth.machine`: `{ allowed: [named_token, access_service_token], header_identity: false }`
- `tools[].requires`: `owner_signed | approval_secret | none` — สำหรับ tool ที่ปิดใบ/ปักกติกา (ในโต๊ะนี้คือ `resolve_decision`, `set_decision_scope`)
- `revocation`: วิธีเพิกถอน grant ของบัญชีเดียว โดยไม่ต้องหมุนรหัสของทุกคน

## คำถามเปิด (ยังไม่ตัดสิน)
- `owner_signed` จะได้มาจากอะไร — Access identity, การลงนามจากอุปกรณ์เจ้าของ หรืออื่น: ไม่แน่ใจ — ต้องตรวจ

## คำถามที่ปิดแล้ว
- ~~โต๊ะสองตัวที่ใช้สัญญาเดียวกันมีชื่อ tool ชุดเดียวกัน ถ้าเข้า portal เดียวจะชนกันหรือไม่~~ — **ปิด**: portal ใส่ prefix `<server>_` ให้เอง จึงไม่ชนใน portal เดียว ชื่อ tool ตาม [README](README.md) คงเดิม (ข้อ 1) · กรณีใช้นอก portal ยังเปิดอยู่ในข้อ 1
