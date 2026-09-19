#!/usr/bin/env bash
#
# สำรองฐานข้อมูล D1 ออกนอก Cloudflare แล้ว **ตรวจว่ากู้กลับได้จริง**
#
# ทำไมต้องมี: Time Travel ของ D1 ย้อนเวลาได้ 30 วันโดยไม่ต้องตั้งอะไร แต่มันอยู่ใน
# บัญชีเดียวกับตัวฐานข้อมูล ถ้าบัญชีหาย ถูกระงับ หรือ D1 ถูกลบ ประวัติย้อนเวลาหายไป
# พร้อมกัน — สคริปต์นี้คือชั้นที่สอง ไม่ใช่ตัวแทนของ Time Travel
#
#   ./scripts/backup.sh                    # เก็บที่ ~/collab-backups
#   ./scripts/backup.sh /path/to/dir       # เก็บที่อื่น
#
# ออกด้วย exit code ไม่ใช่ 0 เมื่อกู้กลับไม่ผ่าน เพื่อให้ cron ส่งเมลแจ้ง
set -euo pipefail

DB="${COLLAB_DB:-ai-collab}"
DEST="${1:-/opt/docker-test/backups/ai-collab}"
KEEP="${COLLAB_BACKUP_KEEP:-14}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ─────────────────────────────────────────────────────────────────────────
# ต้องอยู่ในรีโป ไม่ใช่เพื่อความเป็นระเบียบ
#
# `CLOUDFLARE_API_TOKEN` อยู่ใน `.env` ของโปรเจกต์ (gitignore ครอบไว้แล้ว) ซึ่ง
# wrangler อ่านเองเมื่อ cwd อยู่ในโปรเจกต์ · รันจากที่อื่นจะได้ `user auth missing
# api token non interactive` ทั้งที่ทุกอย่างถูก — เสียเวลาไล่หาสาเหตุมาแล้วหนึ่งรอบ
# ─────────────────────────────────────────────────────────────────────────
cd "$REPO"

# ─────────────────────────────────────────────────────────────────────────
# cron ได้ PATH สั้นมาก และ node ที่เจอก่อนอาจเก่าเกินไป
#
# บนเครื่องนี้ `/usr/bin/node` เป็น v20 ส่วน wrangler กับ `node:sqlite` ที่ตัวตรวจใช้
# ต้องการ v22 ขึ้นไป — **ตรวจแค่ว่ามี node ไหมจึงไม่พอ** รอบแรกที่เขียนสคริปต์นี้
# ตรวจแค่การมีอยู่ แล้ว cron จะล้มทุกคืนด้วยข้อความที่ถูกกลืนไป
#
# ล้มเงียบทุกคืนแย่กว่าไม่มี cron เลย เพราะคนจะเชื่อว่ามี backup อยู่
# ─────────────────────────────────────────────────────────────────────────
NODE_MIN=22

major_of() {
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

current_major() {
  if command -v node >/dev/null 2>&1; then major_of node; else echo 0; fi
}

if [ "$(current_major)" -lt "$NODE_MIN" ]; then
  best=""
  best_v=0
  for d in "$HOME"/.nvm/versions/node/*/bin; do
    [ -x "$d/node" ] || continue
    v="$(major_of "$d/node")"
    if [ "$v" -gt "$best_v" ]; then best="$d"; best_v="$v"; fi
  done
  if [ -n "$best" ]; then
    PATH="$best:$PATH"
    export PATH
  fi
fi

if [ "$(current_major)" -lt "$NODE_MIN" ]; then
  echo "ต้องการ Node.js v$NODE_MIN ขึ้นไป — ที่เจอคือ v$(node --version 2>/dev/null || echo '(ไม่มี)')" >&2
  echo "PATH=$PATH" >&2
  exit 2
fi

for need in node npx jq; do
  command -v "$need" >/dev/null 2>&1 || { echo "ไม่พบคำสั่ง '$need' ใน PATH=$PATH" >&2; exit 2; }
done

# ─────────────────────────────────────────────────────────────────────────
# ห้ามเขียนลงในรีโป — dump มีเนื้อทั้งโต๊ะ ถ้าหลุดขึ้น git คือหลุดถาวร
#
# กันที่นี่เพราะความผิดพลาดนี้ย้อนไม่ได้จริง ๆ ไม่ใช่เพราะไม่ไว้ใจคนรัน
# ─────────────────────────────────────────────────────────────────────────
# ตรวจ *ก่อน* สร้างโฟลเดอร์ ไม่งั้นคำสั่งที่ถูกปฏิเสธยังทิ้งโฟลเดอร์เปล่าไว้ในรีโป
DEST_ABS="$(realpath -m "$DEST")"
case "$DEST_ABS/" in
  "$REPO"/*) echo "ปฏิเสธ: $DEST_ABS อยู่ในรีโป — dump มีเนื้อทั้งโต๊ะ ห้ามเข้า git" >&2; exit 2 ;;
esac
# 700/600 ตามแบบเดียวกับสคริปต์สำรองของ thudong บนเครื่องนี้ — dump มีเนื้อทั้งโต๊ะ
install -d -m 700 "$DEST_ABS"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DUMP="$DEST_ABS/collab-$STAMP.sql"

TABLES="workspaces discussions messages decisions tasks handoffs plans"

# ยอดแถวสดของทุกตาราง คืนเป็น JSON
#
# ยิงทีละตาราง ไม่รวมเป็น UNION เดียว เพราะ SQLite ของ D1 จำกัดจำนวนท่อนใน
# compound SELECT ไว้ต่ำกว่าที่คาด — เจ็ดท่อนได้ `too many terms in compound SELECT`
# ซึ่งเป็นข้อผิดพลาดตอนรัน ไม่ใช่ตอนเขียน · แผลเดียวกับที่ `health` ชนมาแล้ว
#
# เจ็ดรอบต่อการสำรองหนึ่งครั้งไม่ใช่ราคาที่ต้องประหยัด
counts() {
  local out="{}"
  for t in $TABLES; do
    local n
    # เก็บ stderr ไว้ดู ไม่ทิ้ง — รอบแรกที่เขียนสคริปต์นี้ `2>/dev/null` กลืนข้อความว่า
    # `npx: command not found` ไป แล้วอาการที่เห็นคือค่าว่างเฉย ๆ ซึ่งไล่ต้นตอไม่ได้เลย
    if ! npx wrangler d1 execute "$DB" --remote --json \
         --command "SELECT COUNT(*) AS n FROM $t" >"$WORK/q.out" 2>"$WORK/q.err"; then
      echo "นับ $t ไม่ได้:" >&2; tail -5 "$WORK/q.err" >&2; return 1
    fi
    n="$(jq -r '.[0].results[0].n' < "$WORK/q.out" 2>/dev/null || true)"
    case "$n" in
      ''|*[!0-9]*) echo "นับ $t ได้ค่าที่อ่านไม่ออก: '$n'" >&2; tail -5 "$WORK/q.err" >&2; return 1 ;;
    esac
    out="$(printf '%s' "$out" | jq -c --arg t "$t" --argjson n "$n" '.[$t] = $n')"
  done
  printf '%s\n' "$out"
}

# ─────────────────────────────────────────────────────────────────────────
# นับก่อน → export → นับหลัง
#
# ยอดใน dump ต้องอยู่ *ระหว่าง* สองค่านี้ ไม่ใช่เท่ากับค่าใดค่าหนึ่ง เพราะโต๊ะมีคน
# เขียนตลอดเวลา การบังคับให้เท่ากันเป๊ะจะทำให้ backup ที่ถูกต้องสอบตกเมื่อมีใคร
# โพสต์ระหว่างที่ export กำลังวิ่ง — แล้วคนจะเลิกเชื่อผลของสคริปต์นี้
# ─────────────────────────────────────────────────────────────────────────
echo "== นับยอดก่อน export =="
counts > "$WORK/before.json"
cat "$WORK/before.json"

echo "== export =="
npx wrangler d1 export "$DB" --remote --output "$DUMP" >/dev/null
chmod 600 "$DUMP"
echo "ได้ไฟล์ $DUMP ($(du -h "$DUMP" | cut -f1))"

echo "== นับยอดหลัง export =="
counts > "$WORK/after.json"
cat "$WORK/after.json"

echo
echo "== ตรวจว่ากู้กลับได้จริง =="
if ! node scripts/verify-backup.mjs "$DUMP" "$WORK/before.json" "$WORK/after.json"; then
  mv "$DUMP" "$DUMP.FAILED"
  echo "ตั้งชื่อไฟล์เป็น .FAILED แล้ว เพื่อไม่ให้ถูกนับเป็น backup ที่ใช้ได้" >&2
  exit 1
fi

# เก็บย้อนหลังเท่าที่กำหนด — ลบเฉพาะไฟล์ที่ผ่านการตรวจแล้ว ไฟล์ .FAILED เก็บไว้เสมอ
ls -1t "$DEST_ABS"/collab-*.sql 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  echo "ลบไฟล์เก่า $(basename "$old")"
  rm -f "$old"
done

echo
echo "เรียบร้อย · $DUMP"
