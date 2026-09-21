#!/usr/bin/env bash
#
# ถามฐานข้อมูลปลายทางว่าไมเกรชันลงครบหรือยัง — ก่อน deploy ไม่ใช่หลัง
#
# **ทำไมต้องมี:** 21 ก.ย. `get_workspace_context` พังทั้งตัวบน deployment ทดสอบด้วย
# `no such column: scope_set_by` · ไมเกรชัน `0003` กับ `0004` ไม่เคยถูกรันบน D1 ของ poc
# ทั้งที่โค้ดที่อ่านคอลัมน์นั้น deploy ขึ้นไปแล้ว
#
# กฎ "ไมเกรชันก่อน deploy เสมอ" เขียนอยู่ใน `CLAUDE.md` ตั้งแต่ก่อนหน้านั้น และ
# `deploy.sh` ก็กันครบทุกอย่าง — dirty tree · ผิด branch · ตามหลัง origin · typecheck
# · test · build — **แต่ไม่มีด่านไหนอยู่ตรงที่มันพังจริง** ซึ่งเป็นรูปเดิมของสัปดาห์นี้
#
# และคอมเมนต์หัวไฟล์ไมเกรชันทุกใบเขียนคำสั่งตัวอย่างด้วยชื่อ DB ของ production อย่างเดียว
# คนที่ทำตามอย่างซื่อสัตย์ที่สุดจึงลงให้ production ครบ แล้วลืม poc ทุกครั้ง
#
# **ตรวจด้วยการถามฐานข้อมูล ไม่ใช่ด้วยการอ่านทะเบียนที่คนต้องจำมากา** — ทะเบียนที่
# ต้องอาศัยความจำคือทะเบียนที่จะไม่ตรงโดยไม่มีใครรู้ตัว ซึ่งคือสิ่งที่เพิ่งเกิด
#
#   ./scripts/check-migrations.sh          # เทียบกับ D1 ของ production
#   ./scripts/check-migrations.sh --poc    # เทียบกับ D1 ของ deployment ทดสอบ
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONFIG_FILE="wrangler.jsonc"
CONFIG_ARG=""
if [ "${1:-}" = "--poc" ]; then
  CONFIG_FILE="wrangler.poc.jsonc"
  CONFIG_ARG="--config wrangler.poc.jsonc"
fi

DB="$(grep -A6 '"d1_databases"' "$CONFIG_FILE" | sed -n 's/.*"database_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
[ -n "$DB" ] || { printf '\n  อ่านชื่อ D1 จาก %s ไม่ได้\n' "$CONFIG_FILE" >&2; exit 1; }

# ──────────────────────────────────────────────────────────────────────────
# สิ่งที่ตรวจได้ และสิ่งที่ตรวจไม่ได้ — ต้องแยกออกจากกันเสมอ
#
# อ่าน `ALTER TABLE <t> ADD COLUMN <c>` ออกจากไฟล์ไมเกรชันเอง แล้วถามฐานข้อมูลว่า
# คอลัมน์นั้นมีจริงไหม · **ไม่ได้อ่านทะเบียนที่คนกรอก** จึงไม่มีทางที่ทะเบียนจะตรง
# ทั้งที่ฐานข้อมูลไม่ตรง
#
# คำสั่งชนิดอื่น (CREATE INDEX · UPDATE · CREATE TABLE) ตรวจแบบนี้ไม่ได้ และสคริปต์นี้
# **นับแล้วพิมพ์ออกมาว่ามีกี่บรรทัดที่ข้าม** — "ผ่าน" ที่ไม่บอกว่าเดินไปกี่ที่ อ่านเหมือน
# "ตรวจครบ" ทุกประการ ซึ่งเป็นข้อที่ทั้งโต๊ะเจ็บกันมาทั้งสัปดาห์
# ──────────────────────────────────────────────────────────────────────────
declare -A NEEDS=()   # "ตาราง|คอลัมน์" -> ไฟล์ที่เพิ่มมัน
CHECKABLE=0
SKIPPED=0

shopt -s nullglob
FILES=(migrations/*.sql)
[ ${#FILES[@]} -gt 0 ] || { printf '\n  ไม่มีไฟล์ไมเกรชันใน migrations/\n' >&2; exit 1; }

for file in "${FILES[@]}"; do
  while IFS= read -r line; do
    stripped="${line%%--*}"
    [ -n "${stripped// }" ] || continue
    if [[ "$stripped" =~ [Aa][Ll][Tt][Ee][Rr]\ +[Tt][Aa][Bb][Ll][Ee]\ +\"?([A-Za-z_][A-Za-z0-9_]*)\"?\ +[Aa][Dd][Dd]\ +([Cc][Oo][Ll][Uu][Mm][Nn]\ +)?\"?([A-Za-z_][A-Za-z0-9_]*)\"? ]]; then
      NEEDS["${BASH_REMATCH[1]}|${BASH_REMATCH[3]}"]="$file"
      CHECKABLE=$((CHECKABLE + 1))
    elif [[ "$stripped" =~ ^[[:space:]]*(CREATE|UPDATE|INSERT|DROP|DELETE|ALTER) ]]; then
      SKIPPED=$((SKIPPED + 1))
    fi
  done < "$file"
done

# ถามตารางละครั้ง ไม่ใช่คอลัมน์ละครั้ง
declare -A HAVE=()
for key in "${!NEEDS[@]}"; do
  table="${key%%|*}"
  [ -n "${HAVE[$table]+x}" ] && continue
  # แยก "คำสั่งล้ม" ออกจาก "คำสั่งสำเร็จแต่อ่านผลไม่ออก" — สองอย่างนี้ต้องพูดคนละประโยค
  #
  # และต้องดักเอง ไม่ปล่อยให้ `set -e` ฆ่าสคริปต์ตรง assignment เพราะแบบนั้นได้ exit
  # code ที่ถูกแต่ **ไม่มีข้อความสักบรรทัด** — ปฏิเสธโดยไม่บอกว่าทำไม คือของที่โต๊ะนี้
  # ไล่ปิดกันทั้งสัปดาห์ และเคยทำให้คนอ่านสถานะ BLOCKED เป็น "กำลังรอ" มาแล้ว
  if ! raw="$(npx wrangler d1 execute "$DB" --remote $CONFIG_ARG --json \
                --command "SELECT group_concat(name) AS c FROM pragma_table_info('$table');" 2>/dev/null)"; then
    printf '\n  ปฏิเสธ: ต่อ D1 %s ไม่ได้ — ไม่สรุปว่าผ่าน\n\n' "$DB" >&2
    exit 1
  fi

  cols="$(printf '%s' "$raw" | python3 -c 'import json,sys
try:
    r = json.load(sys.stdin)[0]["results"]
    print(r[0]["c"] or "")
except Exception:
    print("__QUERY_FAILED__")')"

  # sentinel เป็นสตริงธรรมดา ไม่ใช่ NUL — bash ตัด NUL ทิ้งเงียบ ๆ ตอน command
  # substitution แล้ว "อ่านผลไม่ออก" จะกลายเป็น "ตารางว่าง" ซึ่งคนละเรื่องกันคนละทิศ
  if [ "$cols" = "__QUERY_FAILED__" ]; then
    printf '\n  ปฏิเสธ: ถาม D1 %s เรื่องตาราง %s แล้วอ่านผลไม่ออก — ไม่สรุปว่าผ่าน\n\n' "$DB" "$table" >&2
    exit 1
  fi

  HAVE[$table]=",$cols,"
done

MISSING=()
for key in "${!NEEDS[@]}"; do
  table="${key%%|*}"; column="${key##*|}"
  [[ "${HAVE[$table]}" == *",$column,"* ]] || MISSING+=("${NEEDS[$key]}|$table.$column")
done

if [ ${#MISSING[@]} -gt 0 ]; then
  printf '\n  ปฏิเสธ: D1 %s ขาดคอลัมน์ที่ไมเกรชันเพิ่มไว้ %s ช่อง\n\n' "$DB" "${#MISSING[@]}" >&2
  printf '%s\n' "${MISSING[@]}" | sort -u | while IFS='|' read -r file target; do
    printf '    %-44s %s\n' "$target" "$file" >&2
  done
  printf '\n  รันไมเกรชันที่ขาดก่อน แล้วค่อย deploy:\n\n' >&2
  printf '%s\n' "${MISSING[@]}" | cut -d'|' -f1 | sort -u | while read -r file; do
    printf '    npx wrangler d1 execute %s --remote %s --file %s\n' "$DB" "$CONFIG_ARG" "$file" >&2
  done
  echo >&2
  exit 1
fi

printf '  ไมเกรชันลง D1 %s ครบ — ตรวจ %s คอลัมน์จากไฟล์ %s ใบ' "$DB" "$CHECKABLE" "${#FILES[@]}"
[ "$SKIPPED" -gt 0 ] && printf ' · ข้าม %s บรรทัดที่ไม่ใช่ ADD COLUMN' "$SKIPPED"
echo
