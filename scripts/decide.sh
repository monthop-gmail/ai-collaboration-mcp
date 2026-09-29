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

# `call` แกะเปลือก MCP ออกให้ แล้วคืน**เนื้อของ tool ล้วน ๆ**
#
# การตรวจว่าคำตอบอ่านได้จริงอยู่ที่นี่ที่เดียว เพราะรุ่นแรกกระจายไปอยู่ในผู้เรียกแต่ละราย
# แล้วเส้นทางที่แค่ "อ่าน" เขียน `.get("result", {})` ไว้ — **ทุกความล้มเหลวจึงกลายเป็น
# รายการว่าง และถูกพิมพ์ออกมาว่า "ไม่มีใบที่รออยู่"** ทั้งที่อาจเป็นโทเคนผิดหรือ tool ตอบ error
#
# นั่นคือ `absent` ถูกยุบเป็น `empty` ซึ่งเป็นข้อที่กติการีโปห้ามไว้ตรง ๆ · เจอของจริง 29 ก.ย.
# ตอนสคริปต์บอกว่าโต๊ะไม่มีใบรอ ทั้งที่มี 14 ใบ
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
  # ปลายทางตอบ JSON เปล่า แต่รองรับ SSE ไว้ด้วยเผื่อเปลี่ยน
  line="$(printf '%s' "$raw" | grep '^data:' | head -1 || true)"
  payload="${line#data:}"
  [ -n "$payload" ] || payload="$raw"
  printf '%s' "$payload" | NAME="$name" python3 -c '
import json, os, sys
raw = sys.stdin.read()
name = os.environ["NAME"]
def die(why):
    print("\n  ปฏิเสธ: %s (%s)" % (why, name), file=sys.stderr)
    print("  สิ่งที่เซิร์ฟเวอร์ตอบมา 400 ตัวแรก:", file=sys.stderr)
    print("  " + raw[:400].replace("\n", "\n  "), file=sys.stderr)
    sys.exit(3)
if not raw.strip():
    die("คำตอบว่างเปล่า")
try:
    frame = json.loads(raw)
except Exception:
    die("คำตอบไม่ใช่ JSON")
if frame.get("error"):
    e = frame["error"]
    # JSON-RPC ตอบ error เป็น object แต่ตัว worker ตอบ 401 เป็นสตริง — ต้องรับทั้งสองแบบ
    # ถ้ารับแบบเดียว อีกแบบจะโยน traceback หรือ (แบบเดิม) เงียบแล้วกลายเป็นรายการว่าง
    if isinstance(e, dict):
        why = e.get("message") or json.dumps(e, ensure_ascii=False)
    else:
        why = str(e)
        if why == "unauthorized":
            why += " — โทเคนใน MCP_TOKEN ไม่ผ่าน ไม่ใช่ว่าโต๊ะไม่มีใบ"
        if frame.get("reason"):
            why += " · reason=" + str(frame["reason"])
    die("เซิร์ฟเวอร์ตอบ error: %s" % why)
res = frame.get("result")
if not isinstance(res, dict) or not res.get("content"):
    die("คำตอบไม่มี result.content")
text = res["content"][0].get("text", "")
if res.get("isError"):
    die("tool ตอบว่าไม่สำเร็จ: %s" % text)
sys.stdout.write(text)'
}

# อ่านรายการใบจากเนื้อที่ `call` คืนมา · ไม่มีคีย์ `decisions` = อ่านไม่ออก ไม่ใช่ว่าง
READ_ROWS='
import json, sys
raw = sys.stdin.read()
try:
    body = json.loads(raw)
except Exception:
    print("\n  ปฏิเสธ: เนื้อของ tool ไม่ใช่ JSON", file=sys.stderr); sys.exit(3)
if "decisions" not in body:
    print("\n  ปฏิเสธ: คำตอบไม่มีคีย์ decisions — อ่านไม่ออกว่าโต๊ะมีอะไร", file=sys.stderr)
    print("  " + raw[:400].replace("\n", "\n  "), file=sys.stderr)
    sys.exit(3)
rows = body["decisions"]
'

# ── ไม่ระบุใบ = ดูว่ามีอะไรรออยู่ · อ่านอย่างเดียว ─────────────────────────
if [ -z "$TARGET" ]; then
  b "ใบที่ยังไม่มีใครเคาะ ใน $WORKSPACE"
  call get_decisions "{\"workspace\":\"$WORKSPACE\",\"status\":\"proposed\",\"limit\":200}" \
    | python3 -c "$READ_ROWS"'
if not rows:
    print("  ไม่มีใบที่รออยู่")
else:
    for d in rows:
        print("  " + d["id"])
        print("    " + d["title"])
        print("    เสนอโดย " + d["proposed_by"] + " · " + d["created_at"])
        print()
    print("  รวม %d ใบ · เคาะด้วย ./scripts/decide.sh <รหัสใบ>" % len(rows))
if body.get("has_more"):
    print("  (ยังมีมากกว่านี้ — แสดงแค่ 200 ใบแรก)")'
  exit 0
fi

# ── ระบุใบ = อ่านให้ครบก่อน แล้วค่อยถาม ────────────────────────────────────
#
# แสดงหัวเรื่องและเนื้อเต็มก่อนถามเสมอ — 27 ก.ย. มีการเขียนบันทึกผลของงานหนึ่งลงใน
# ใบของอีกทีมแล้วกดปิด ส่วนใบตัวจริงยังเปิดอยู่ · ตอนนั้นทุกช่องที่ระบบคืนกลับมาถูกต้องหมด
# **มันเป็นของใบอื่นเท่านั้น** · ให้คนได้เห็นว่ากำลังเคาะใบไหนก่อนพิมพ์รหัส
b "ใบที่กำลังจะเคาะ"
DETAIL="$(call get_decisions "{\"workspace\":\"$WORKSPACE\",\"limit\":200}")"

FOUND="$(printf '%s' "$DETAIL" | TARGET="$TARGET" python3 -c "$READ_ROWS"'
import os
want = os.environ["TARGET"]
hit = [d for d in rows if d["id"] == want or d["id"].startswith(want)]
if not hit:
    tail = " (และยังมีใบเกิน 200 ใบที่ยังไม่ได้ดู)" if body.get("has_more") else ""
    print("\n  ปฏิเสธ: ไม่พบใบ " + want + " ใน " + str(len(rows)) + " ใบที่อ่านมา" + tail, file=sys.stderr)
    sys.exit(3)
if len(hit) > 1:
    print("\n  ปฏิเสธ: รหัสย่อ %s ตรงกับ %d ใบ — ใส่ให้ยาวขึ้น" % (want, len(hit)), file=sys.stderr)
    sys.exit(3)
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
print()
print("__ID__" + d["id"])
print("__STATUS__" + d["status"])')"

printf '%s\n' "$FOUND" | grep -v '^__'
# ใช้รหัสเต็มที่อ่านได้จริง ไม่ใช่รหัสย่อที่ผู้ใช้พิมพ์ — กันการเคาะใบที่ไม่ใช่ใบที่เพิ่งอ่าน
FULL_ID="$(printf '%s\n' "$FOUND" | sed -n 's/^__ID__//p')"
STATUS="$(printf '%s\n' "$FOUND" | sed -n 's/^__STATUS__//p')"
[ -n "$FULL_ID" ] || stop "อ่านรหัสใบไม่ออก"

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

ARGS="$(VERDICT="$VERDICT" REASON="$REASON" CODE="$CODE" FULL_ID="$FULL_ID" python3 -c '
import json, os
a = {"decision_id": os.environ["FULL_ID"], "verdict": os.environ["VERDICT"], "reason": os.environ["REASON"]}
if os.environ["CODE"]:
    a["approval_code"] = os.environ["CODE"]
print(json.dumps(a, ensure_ascii=False))')"

b "กำลังเคาะ"
RESULT="$(call resolve_decision "$ARGS")"
unset CODE ARGS

printf '%s' "$RESULT" | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    print("  เคาะไปแล้วแต่อ่านผลกลับไม่ออก — ตรวจด้วย ./scripts/decide.sh ก่อนทำซ้ำ", file=sys.stderr)
    print("  " + raw[:400], file=sys.stderr); sys.exit(3)
print("  สถานะ        %s" % d.get("status"))
print("  ปิดโดย       %s" % d.get("decided_by"))
print("  ชนิดผู้ปิด    %s" % d.get("decided_by_kind"))
print("  เมื่อ         %s" % d.get("decided_at"))
print()
if d.get("decided_by_kind") == "relayed":
    print("  หมายเหตุ: บันทึกเป็น relayed เพราะไม่ได้ส่งรหัส — ใช้งานได้ปกติ แต่ยืนยันไม่ได้ว่ามีคนอยู่ตรงนั้น")
'
