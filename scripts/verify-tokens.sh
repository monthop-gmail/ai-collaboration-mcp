#!/usr/bin/env bash
#
# ยิงทุกโทเคนใน `MCP_AUTH_TOKENS` แล้วยืนยันว่าแต่ละใบยังได้ชื่อที่ถูกต้อง
#
# **ทำไมต้องมี:** `wrangler secret put` เขียนทับค่าเดิมทั้งก้อนทันที ไม่ถาม ย้อนไม่ได้
# และค่าเดิมอ่านกลับไม่ได้เลย — Cloudflare ให้เขียนอย่างเดียว `secret list` บอกแค่ชื่อ
#
# แปลว่าการเพิ่มโทเคนใบใหม่ = พิมพ์ค่าทั้งก้อนใหม่ด้วยมือ และถ้าตกใบใดใบหนึ่ง
# ทีมนั้นจะได้ `401` ทันทีโดยไม่มีอะไรฟ้อง · **เคยเกิดจริงเมื่อ 9 ก.ย. ทุก client ที่
# เข้าทาง static bearer ได้ 401 พร้อมกันยี่สิบนาที**
#
# สคริปต์นี้ย่นเวลานั้นเหลือไม่กี่วินาที
#
#   ./scripts/verify-tokens.sh /path/to/tokens.txt
#   echo "$VALUE" | ./scripts/verify-tokens.sh -
#
# ไฟล์ที่รับคือ **ค่าเดียวกับที่จะใส่ใน MCP_AUTH_TOKENS** รูป `token=ชื่อ` คั่นด้วย comma
# เก็บไว้บนเครื่องของเจ้าของงานเท่านั้น ห้ามเข้า git ห้ามโพสต์
#
# **ไม่พิมพ์โทเคนออกมาเลยแม้แต่ตัวเดียว** รายงานเฉพาะชื่อกับผลว่าผ่านหรือไม่
set -euo pipefail

URL="${COLLAB_URL:-https://ai-collaboration-mcp.monthop-gmail.workers.dev/mcp}"
SRC="${1:-}"

if [ -z "$SRC" ]; then
  echo "ใช้: $0 <ไฟล์ค่า MCP_AUTH_TOKENS | ->" >&2
  exit 2
fi

VALUE="$(if [ "$SRC" = "-" ]; then cat; else cat "$SRC"; fi)"
[ -n "$VALUE" ] || { echo "ค่าว่าง ไม่มีอะไรให้ตรวจ" >&2; exit 2; }

BODY='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_workspace_context","arguments":{"limit":1}}}'

fail=0
total=0

# แยกด้วย comma แล้ว trim ทั้งสองฝั่ง — กติกาเดียวกับ `nameForToken()` ใน src/identity.ts
# ถ้าที่นี่ parse ต่างจาก server ผลที่ได้จะไม่ใช่ผลของสิ่งที่ server จะเห็น
while IFS= read -r entry; do
  entry="$(printf '%s' "$entry" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [ -n "$entry" ] || continue
  case "$entry" in *=*) ;; *) continue ;; esac

  token="$(printf '%s' "${entry%%=*}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  want="$(printf '%s' "${entry#*=}"  | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  { [ -n "$token" ] && [ -n "$want" ]; } || continue

  total=$((total + 1))

  got="$(curl -s --max-time 20 -X POST "$URL" \
          -H 'content-type: application/json' \
          -H 'accept: application/json, text/event-stream' \
          -H "authorization: Bearer $token" \
          -d "$BODY" \
        | sed -n 's/^data: //p' \
        | tr -d '\\\\' \
        | sed -n 's/.*"you_are": *"\([^"]*\)".*/\1/p' | head -1)"

  if [ "$got" = "$want" ]; then
    printf '  ผ่าน    %s\n' "$want"
  else
    printf '  ไม่ผ่าน %s  →  ได้ %s\n' "$want" "${got:-(ไม่ได้ชื่อกลับมา)}"
    fail=$((fail + 1))
  fi
done <<EOF
$(printf '%s' "$VALUE" | tr ',' '\n')
EOF

echo
echo "ตรวจ $total ใบ · ไม่ผ่าน $fail"

# ไฟล์ที่ parse ไม่ได้เลยต้องไม่ผ่าน ไม่ใช่รายงานว่าตรวจครบศูนย์ใบแล้วจบสวย ๆ
# — ตัวตรวจที่ไม่ได้ตรวจอะไร กับตัวตรวจที่ตรวจแล้วผ่าน หน้าตาเหมือนกันจากข้างนอก
if [ "$total" -eq 0 ]; then
  echo "ไม่พบรายการรูป token=ชื่อ เลยสักใบ — ไฟล์ผิดรูปหรือว่าง" >&2
  exit 2
fi
[ "$fail" -eq 0 ] || {
  echo "มีใบที่ชื่อไม่ตรง — อย่าเพิ่งปิดหน้าต่างนี้ ค่าเดิมอ่านกลับไม่ได้" >&2
  exit 1
}
