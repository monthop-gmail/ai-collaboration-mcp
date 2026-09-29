#!/usr/bin/env bash
#
# เคาะ decision บนโต๊ะ
#
#   ./scripts/decide.sh                # ใบที่ยังไม่มีใครเคาะ — อ่านอย่างเดียว
#   ./scripts/decide.sh payload.json   # อ่านใบให้ดู แล้วถามก่อนส่ง
#
# รหัสอนุมัติอยู่ในไฟล์ payload เท่านั้น **ห้ามใส่ใน argument** — argv เห็นได้จาก `ps`
# และตกอยู่ใน shell history · เก็บไฟล์ไว้นอกรีโปและ chmod 600
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

URL="${COLLAB_URL:-https://ai-collaboration-mcp.monthop-gmail.workers.dev/mcp}"
WS="${COLLAB_WORKSPACE:-ws-001}"
TOKEN="${MCP_TOKEN:-}"
die() { printf '\n  ปฏิเสธ: %s\n\n' "$*" >&2; exit 2; }
[ -n "$TOKEN" ] || die "ไม่มี MCP_TOKEN"

# ยิง tool แล้วคืนเนื้อล้วน ๆ · body ไปทาง stdin เพราะ argv ของ curl เห็นได้จาก `ps`
#
# การตรวจว่าคำตอบอ่านได้จริงต้องอยู่ที่นี่ที่เดียว · รุ่นแรกเขียน `.get("result", {})`
# ไว้ในผู้เรียก แล้ว 401 กลายเป็นรายการว่าง พิมพ์ออกมาว่า "ไม่มีใบที่รออยู่" ทั้งที่มี 14 ใบ
# — `absent` ถูกยุบเป็น `empty` ซึ่งอ่านเหมือนคำตอบที่ถูกต้อง จึงแย่กว่า error
call() {
  printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$1" "$2" \
  | curl -sS --max-time 30 "$URL" -H "authorization: Bearer $TOKEN" \
      -H 'content-type: application/json' -H 'accept: application/json' --data-binary @- \
  | python3 -c '
import json, sys
raw = sys.stdin.read()
try: f = json.loads(raw)
except Exception: sys.exit("  อ่านคำตอบไม่ออก: " + raw[:300])
# error เป็น object (JSON-RPC) หรือสตริง (worker ตอบ 401) — รับแบบเดียว อีกแบบจะเงียบ
if f.get("error"): sys.exit("  เซิร์ฟเวอร์ตอบ error: " + json.dumps(f, ensure_ascii=False)[:300])
c = f.get("result", {}).get("content")
if not c: sys.exit("  คำตอบไม่มี result.content: " + raw[:300])
if f["result"].get("isError"): sys.exit("  tool ไม่สำเร็จ: " + c[0].get("text", ""))
sys.stdout.write(c[0]["text"])'
}

rows() { python3 -c '
import json, sys
raw = sys.stdin.read()
if not raw.strip(): sys.exit(1)   # ต้นท่อพิมพ์เหตุไปแล้ว อย่าทับด้วย traceback
b = json.loads(raw)
if "decisions" not in b: sys.exit("  คำตอบไม่มีคีย์ decisions")
'"$1"''; }

if [ $# -eq 0 ]; then
  printf '\n\033[1mใบที่ยังไม่มีใครเคาะ ใน %s\033[0m\n' "$WS"
  call get_decisions "{\"workspace\":\"$WS\",\"status\":\"proposed\",\"limit\":200}" | rows '
for d in b["decisions"]: print("  %s\n    %s" % (d["id"], d["title"]))
print("  รวม %d ใบ" % len(b["decisions"]))'
  exit 0
fi

P="$1"
[ -f "$P" ] || die "ต้องเป็นไฟล์ payload — รหัสอนุมัติห้ามอยู่ใน argument"
[ "$(stat -c %a "$P" 2>/dev/null)" = 600 ] || printf '  ⚠ %s ไม่ได้เป็น mode 600 ทั้งที่มีรหัสอยู่ข้างใน\n' "$P" >&2

# ตรวจเฉพาะสองข้อที่ปลายทางจับไม่ได้ · ที่เหลือ tool ปฏิเสธเองอยู่แล้ว
ID="$(python3 -c '
import json, sys
try: p = json.load(sys.stdin)
except Exception as e: sys.exit("  payload ไม่ใช่ JSON ที่อ่านได้ — " + str(e))
extra = sorted(set(p) - {"decision_id","verdict","reason","approval_code","superseded_by"})
# คีย์ที่พิมพ์ผิดจะถูกทิ้งเงียบ ๆ แล้วบันทึกเป็น relayed ทั้งที่ตั้งใจยืนยัน
if extra: sys.exit("  คีย์ที่ tool ไม่รู้จัก: " + ", ".join(extra) + " — พิมพ์ผิดหรือเปล่า")
if "<" in (p.get("approval_code") or ""): sys.exit("  approval_code ยังเป็น placeholder")
if not p.get("decision_id"): sys.exit("  ไม่มี decision_id")
print(p["decision_id"])' < "$P")"

# อ่านใบให้ดูก่อนเสมอ — 27 ก.ย. มีการปิดใบของอีกทีมโดยทุกช่องที่ระบบคืนมาถูกต้องหมด
# มันเป็นของใบอื่นเท่านั้น · คนต้องเห็นหัวเรื่องก่อนกดยืนยัน
printf '\n\033[1mใบที่กำลังจะเคาะ\033[0m\n'
call get_decisions "{\"workspace\":\"$WS\",\"limit\":200}" | ID="$ID" rows '
import os
hit = [d for d in b["decisions"] if d["id"] == os.environ["ID"]]
if not hit: sys.exit("  ไม่พบใบ " + os.environ["ID"])
d = hit[0]
if d["status"] != "proposed": sys.exit("  ใบนี้สถานะ %s แล้ว เคาะซ้ำไม่ได้" % d["status"])
print("  " + d["title"])
print("  เสนอโดย " + d["proposed_by"] + " · " + d["created_at"] + "\n")
print("  " + (d.get("detail") or "(ไม่มีเนื้อ)").replace("\n", "\n  "))'

printf '\n  พิมพ์ yes เพื่อส่ง: '
read -r OK
[ "$OK" = yes ] || die "ยกเลิก ไม่ได้แตะอะไร"

printf '\n\033[1mผล\033[0m\n'
call resolve_decision "$(cat "$P")" | python3 -c '
import json, sys
raw = sys.stdin.read()
if not raw.strip(): sys.exit(1)
d = json.loads(raw)
for k in ("status","decided_by","decided_by_kind","decided_at"): print("  %-16s %s" % (k, d.get(k)))
if d.get("decided_by_kind") == "relayed":
    print("\n  บันทึกเป็น relayed เพราะไม่ได้ส่งรหัส — ยืนยันไม่ได้ว่ามีคนอยู่ตรงนั้น")'
