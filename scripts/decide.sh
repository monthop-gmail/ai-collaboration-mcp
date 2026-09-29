#!/usr/bin/env bash
#
# เคาะ decision บนโต๊ะ โดยที่ `APPROVAL_SECRET` ไม่ผ่านมือใครนอกจากเจ้าของงาน
#
# **ทำไมต้องมี:** `APPROVAL_SECRET` เป็นค่าที่มีความหมายก็ต่อเมื่อ**มีแต่คนเท่านั้นที่รู้**
# ถ้าเก็บไว้ใน config ของ AI ตัวไหน การปิดทุกใบจะถูกบันทึกว่ามีคนยืนยันทั้งที่ไม่มี
# ซึ่งแย่กว่าไม่มีกลไกนี้เลย · สคริปต์นี้ถามค่าตอนรัน ไม่รับทาง argument และไม่พิมพ์ออกมา
#
#   ./scripts/decide.sh                    # ดูใบที่ยังไม่มีใครเคาะ — อ่านอย่างเดียว
#   ./scripts/decide.sh dec-xxxxxxxx       # อ่านใบนั้นให้ครบ แล้วถามก่อนเคาะ
#
# **ห้ามส่งรหัสทาง argument** — argv มองเห็นได้จาก `ps` และตกอยู่ใน shell history
# สคริปต์จึงรับทาง prompt ที่ปิดการแสดงผลเท่านั้น
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

URL="${COLLAB_URL:-https://ai-collaboration-mcp.monthop-gmail.workers.dev/mcp}"
WORKSPACE="${COLLAB_WORKSPACE:-ws-001}"
TOKEN="${MCP_TOKEN:-}"
TARGET="${1:-}"

b() { printf '\n\033[1m%s\033[0m\n' "$*"; }
stop() { printf '\n  ปฏิเสธ: %s\n\n' "$*" >&2; exit 2; }

[ -n "$TOKEN" ] || stop "ไม่มี MCP_TOKEN — ตั้งเป็น env ก่อนรัน (อย่าใส่ใน argument)"

# ไม่รับรหัสอนุมัติทาง argument เด็ดขาด · ถ้ามีคนพยายามส่งมา ให้หยุดและบอกว่าทำไม
for arg in "$@"; do
  case "$arg" in
    dec-*) ;;
    approved|rejected) ;;
    *) stop "รับได้เฉพาะรหัสใบ (dec-…) — รหัสอนุมัติต้องพิมพ์ตอนถาม ไม่ใช่ใส่ในคำสั่ง" ;;
  esac
done

# โค้ด python ข้างล่างอยู่ใน single quote ของ bash — **ห้ามใช้ \" ข้างใน f-string**
# bash ส่ง \" เข้าไปเป็นตัวอักษรจริง แล้ว python อ่านเป็น line continuation แล้วพัง
# ตอนรัน ไม่ใช่ตอนตรวจ · `bash -n` ผ่านฉลุยเพราะมันไม่แตะข้างใน · ใช้ % หรือ + ต่อสตริงแทน
# เจอมาแล้วตอนเขียนไฟล์นี้ · ด่านที่จับได้คือยิงสคริปต์จริงใส่เซิร์ฟเวอร์จำลอง ไม่ใช่ lint

rpc_id=0
call() {
  local name="$1" args="$2" raw line payload
  rpc_id=$((rpc_id + 1))
  if ! raw="$(curl -sS --max-time 30 "$URL" \
        -H "authorization: Bearer $TOKEN" \
        -H "content-type: application/json" \
        -H "accept: application/json, text/event-stream" \
        -d "{\"jsonrpc\":\"2.0\",\"id\":$rpc_id,\"method\":\"tools/call\",\"params\":{\"name\":\"$name\",\"arguments\":$args}}")"; then
    stop "เรียก $name ไม่สำเร็จ — ไม่สรุปว่าเคาะแล้ว"
  fi
  line="$(printf '%s' "$raw" | grep '^data:' | head -1 || true)"
  payload="${line#data:}"
  [ -n "$payload" ] || payload="$raw"
  printf '%s' "$payload"
}

# ── ไม่ระบุใบ = ดูว่ามีอะไรรออยู่ · อ่านอย่างเดียว ─────────────────────────
if [ -z "$TARGET" ]; then
  b "ใบที่ยังไม่มีใครเคาะ ใน $WORKSPACE"
  call get_decisions "{\"workspace\":\"$WORKSPACE\",\"status\":\"proposed\",\"limit\":50}" \
    | python3 -c '
import json, sys
frame = json.load(sys.stdin)
body = frame.get("result", {}).get("content", [{}])[0].get("text", "{}")
rows = json.loads(body).get("decisions", [])
if not rows:
    print("  ไม่มีใบที่รออยู่")
else:
    for d in rows:
        print("  " + d["id"])
        print("    " + d["title"])
        print("    เสนอโดย " + d["proposed_by"] + " · " + d["created_at"])
        print()
    print("  รวม %d ใบ · เคาะด้วย ./scripts/decide.sh <รหัสใบ>" % len(rows))'
  exit 0
fi

# ── ระบุใบ = อ่านให้ครบก่อน แล้วค่อยถาม ────────────────────────────────────
#
# แสดงหัวเรื่องและเนื้อเต็มก่อนถามเสมอ — 27 ก.ย. มีการเขียนบันทึกผลของงานหนึ่งลงใน
# ใบของอีกทีมแล้วกดปิด ส่วนใบตัวจริงยังเปิดอยู่ · ตอนนั้นทุกช่องที่ระบบคืนกลับมาถูกต้องหมด
# **มันเป็นของใบอื่นเท่านั้น** · ให้คนได้เห็นว่ากำลังเคาะใบไหนก่อนพิมพ์รหัส
b "ใบที่กำลังจะเคาะ"
DETAIL="$(call get_decisions "{\"workspace\":\"$WORKSPACE\",\"limit\":200}")"
printf '%s' "$DETAIL" | TARGET="$TARGET" python3 -c '
import json, os, sys
frame = json.load(sys.stdin)
body = frame.get("result", {}).get("content", [{}])[0].get("text", "{}")
rows = json.loads(body).get("decisions", [])
want = os.environ["TARGET"]
hit = [d for d in rows if d["id"] == want or d["id"].startswith(want)]
if not hit:
    print("  ไม่พบใบ " + want + " ใน workspace นี้", file=sys.stderr); sys.exit(2)
if len(hit) > 1:
    print("  รหัสย่อ %s ตรงกับ %d ใบ — ใส่ให้ยาวขึ้น" % (want, len(hit)), file=sys.stderr); sys.exit(2)
d = hit[0]
print("  รหัส     " + d["id"])
print("  หัวเรื่อง  " + d["title"])
print("  สถานะ    " + d["status"])
print("  เสนอโดย  " + d["proposed_by"] + " · " + d["created_at"])
if d.get("decided_by"):
    print("  เคาะแล้ว  %s (%s) · %s" % (d["decided_by"], d.get("decided_by_kind"), d["decided_at"]))
print()
print("  ── เนื้อของใบ ──")
for ln in (d.get("detail") or "(ไม่มีเนื้อ)").split("\n"):
    print("  " + ln)
' || exit 2

STATUS="$(printf '%s' "$DETAIL" | TARGET="$TARGET" python3 -c '
import json, os, sys
body = json.load(sys.stdin)["result"]["content"][0]["text"]
want = os.environ["TARGET"]
for d in json.loads(body).get("decisions", []):
    if d["id"] == want or d["id"].startswith(want):
        print(d["status"]); break')"

if [ "$STATUS" != "proposed" ]; then
  stop "ใบนี้สถานะ '$STATUS' แล้ว ไม่ใช่ 'proposed' — เคาะซ้ำไม่ได้"
fi

b "ยืนยัน"
printf '  พิมพ์ approved หรือ rejected (อย่างอื่นคือยกเลิก): '
read -r VERDICT
case "$VERDICT" in
  approved|rejected) ;;
  *) stop "ยกเลิก ไม่ได้แตะอะไร" ;;
esac

printf '  เหตุผล (คนอ่านเดือนหน้าต้องเข้าใจได้): '
read -r REASON
[ -n "$REASON" ] || stop "ต้องมีเหตุผล — ใบที่ปิดโดยไม่มีเหตุผล อ่านย้อนไม่ได้ว่าทำไม"

# `read -s` ปิดการแสดงผล — รหัสไม่ขึ้นหน้าจอ ไม่เข้า history ไม่อยู่ใน argv
printf '  รหัสอนุมัติ (ไม่แสดงผล · เว้นว่าง = บันทึกเป็น relayed): '
read -rs CODE
echo

ARGS="$(VERDICT="$VERDICT" REASON="$REASON" CODE="$CODE" TARGET="$TARGET" python3 -c '
import json, os
a = {"decision_id": os.environ["TARGET"], "verdict": os.environ["VERDICT"], "reason": os.environ["REASON"]}
if os.environ["CODE"]:
    a["approval_code"] = os.environ["CODE"]
print(json.dumps(a, ensure_ascii=False))')"

b "กำลังเคาะ"
RESULT="$(call resolve_decision "$ARGS")"
unset CODE ARGS

printf '%s' "$RESULT" | python3 -c '
import json, sys
frame = json.load(sys.stdin)
res = frame.get("result", {})
text = res.get("content", [{}])[0].get("text", "")
if res.get("isError") or frame.get("error"):
    print("  ไม่สำเร็จ:", text or frame.get("error", {}).get("message", ""), file=sys.stderr)
    sys.exit(1)
d = json.loads(text)
print("  สถานะ        %s" % d.get("status"))
print("  ปิดโดย       %s" % d.get("decided_by"))
print("  ชนิดผู้ปิด    %s" % d.get("decided_by_kind"))
print("  เมื่อ         %s" % d.get("decided_at"))
print()
if d.get("decided_by_kind") == "relayed":
    print("  หมายเหตุ: บันทึกเป็น relayed เพราะไม่ได้ส่งรหัส — ใช้งานได้ปกติ แต่ยืนยันไม่ได้ว่ามีคนอยู่ตรงนั้น")
'
