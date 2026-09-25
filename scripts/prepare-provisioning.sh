#!/usr/bin/env bash
#
# เตรียมของให้เจ้าของงานรัน — **สคริปต์นี้ไม่เปลี่ยนอะไรเลยสักอย่าง**
#
# ตรวจสถานะปัจจุบัน สร้างโทเคนใหม่ลงไฟล์นอกรีโป แล้วพิมพ์คำสั่งที่ต้องรันต่อ
# ของที่ย้อนไม่ได้ — เขียน D1 กับเขียนความลับ — เจ้าของงานเป็นคนกดเอง
#
#   ./scripts/prepare-provisioning.sh                  # ตรวจอย่างเดียว
#   ./scripts/prepare-provisioning.sh ~/lab-tokens.txt # ตรวจ + สร้างโทเคนลงไฟล์
#
# **ไม่พิมพ์ค่าโทเคนออกหน้าจอเลย** — เขียนลงไฟล์ mode 600 นอกรีโป แล้วบอกแค่ชื่อ
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO="$PWD"
DB="ai-collab"
OUT="${1:-}"

# ชื่อที่ต้องออกโทเคนให้ · แก้ตรงนี้ถ้ารายชื่อเปลี่ยน
ROLES=(
  "lab/baseline" "lab/langgraph" "lab/crewai" "lab/msaf" "lab/ceiling"
  "audit/lead" "audit/evidence" "audit/reviewer"
)

# workspace ที่แต่ละรอบต้องใช้ · หนึ่งใบต่อหนึ่งรอบวัด ห้ามใช้ซ้ำ
WORKSPACES=(
  "ws-lab-ceiling-01|Lab ceiling 01"
  "ws-lab-baseline-01|Lab baseline 01"
  "ws-lab-langgraph-01|Lab LangGraph 01"
  "ws-lab-crewai-01|Lab CrewAI 01"
  "ws-lab-msaf-01|Lab MS Agent Framework 01"
)

b() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ── 1 · workspace ที่มีอยู่แล้ว ────────────────────────────────────────────
b "workspace ที่มีอยู่บน $DB"
EXISTING="$(npx wrangler d1 execute "$DB" --remote --json \
  --command "SELECT id FROM workspaces ORDER BY id;" 2>/dev/null \
  | python3 -c 'import json,sys; print(" ".join(r["id"] for r in json.load(sys.stdin)[0]["results"]))')"
[ -n "$EXISTING" ] || { echo "  อ่านไม่สำเร็จ — ไม่สรุปว่าไม่มี" >&2; exit 1; }
printf '  %s\n' "$EXISTING"

MISSING=()
for entry in "${WORKSPACES[@]}"; do
  id="${entry%%|*}"
  case " $EXISTING " in *" $id "*) ;; *) MISSING+=("$entry") ;; esac
done

# ── 2 · ไมเกรชัน ──────────────────────────────────────────────────────────
b "ไมเกรชัน"
./scripts/check-migrations.sh || true

# ── 3 · ความลับที่ตั้งไว้แล้ว (ชื่ออย่างเดียว) ─────────────────────────────
b "ความลับที่ตั้งไว้แล้ว"
npx wrangler secret list 2>/dev/null \
  | python3 -c 'import json,sys; [print("  "+s["name"]) for s in json.load(sys.stdin)]' 2>/dev/null \
  || echo "  อ่านรายการไม่ได้"
echo "  (ค่าอ่านกลับไม่ได้ — Cloudflare ให้เขียนอย่างเดียว)"

# ── 4 · สร้างโทเคน ────────────────────────────────────────────────────────
if [ -n "$OUT" ]; then
  OUT_ABS="$(realpath -m "$OUT")"
  case "$OUT_ABS/" in
    "$REPO"/*) echo "ปฏิเสธ: $OUT_ABS อยู่ในรีโป — ไฟล์นี้ถือโทเคนจริง ห้ามเข้า git" >&2; exit 2 ;;
  esac
  [ -e "$OUT_ABS" ] && { echo "ปฏิเสธ: $OUT_ABS มีอยู่แล้ว — ไม่เขียนทับของที่อาจเป็นค่าเดิม" >&2; exit 2; }

  install -m 600 /dev/null "$OUT_ABS"
  for role in "${ROLES[@]}"; do
    printf '%s=%s\n' "$(openssl rand -hex 32)" "$role" >> "$OUT_ABS"
  done

  b "สร้างโทเคน ${#ROLES[@]} ใบแล้ว"
  echo "  ไฟล์: $OUT_ABS  (mode 600)"
  printf '  ชื่อ: %s\n' "${ROLES[*]}"
  echo "  ค่าโทเคนไม่ถูกพิมพ์ออกหน้าจอ — เปิดไฟล์เอาเอง"
fi

# ── 5 · คำสั่งที่ต้องรันต่อ ────────────────────────────────────────────────
b "ที่ต้องรันต่อ — เจ้าของงานเท่านั้น"

if [ ${#MISSING[@]} -eq 0 ]; then
  echo "  1. แถว workspace ครบแล้ว ไม่ต้องทำอะไร"
else
  echo "  1. เพิ่มแถว workspace ${#MISSING[@]} ใบ"
  echo
  echo "     npx wrangler d1 execute $DB --remote --command \""
  echo "     INSERT INTO workspaces (id, name, created_at) VALUES"
  last=$(( ${#MISSING[@]} - 1 ))
  for i in "${!MISSING[@]}"; do
    id="${MISSING[$i]%%|*}"; name="${MISSING[$i]#*|}"
    [ "$i" -eq "$last" ] && sep=";" || sep=","
    printf "      ('%s','%s','%sT00:00:00.000Z')%s\n" "$id" "$name" "$(date -u +%Y-%m-%d)" "$sep"
  done
  echo "     \""
fi

echo
if [ -n "$OUT" ]; then
  echo "  2. เติมค่าเดิมของ MCP_AUTH_TOKENS ลงไฟล์ก่อน แล้วค่อยเขียนทับ"
  echo
  echo "     # เปิดไฟล์ แล้ววางค่าเดิมเพิ่มบรรทัดละใบ รูป token=ชื่อ"
  echo "     \$EDITOR $OUT_ABS"
  echo
  echo "     # ป้อนผ่าน stdin ไม่ต้องพิมพ์ค่าเอง และไม่เข้า shell history"
  echo "     paste -sd, - < $OUT_ABS | npx wrangler secret put MCP_AUTH_TOKENS"
  echo
  echo "     # ยืนยันทันที อย่าเพิ่งปิดหน้าต่าง"
  echo "     ./scripts/verify-tokens.sh $OUT_ABS"
else
  echo "  2. โทเคน — รันสคริปต์นี้ซ้ำพร้อมพาธไฟล์ปลายทางนอกรีโป"
  echo "     ./scripts/prepare-provisioning.sh ~/lab-tokens.txt"
fi

cat <<'WARN'

  ⚠ wrangler secret put เขียนทับทั้งก้อน ย้อนไม่ได้ และอ่านค่าเดิมกลับไม่ได้
    9 ก.ย. เคยตกไปหนึ่งใบ ทุก client ได้ 401 พร้อมกันยี่สิบนาที
    ถ้าไม่มีสำเนาค่าเดิม อย่าเดา — ออกใหม่ทั้งชุดแล้วแจ้งทุกทีมแทน

  รายละเอียดเต็ม: docs/provisioning-runbook.md
WARN
