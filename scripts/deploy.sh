#!/usr/bin/env bash
#
# deploy production โดยผ่านด่านชุดเดียวกับ CI และฝังเลข commit ไปกับ deployment
#
# **ทำไมต้องมี:** 20 ก.ย. มี fix ที่ผ่าน CI และ merge เข้า `main` แล้ว แต่ไม่เคยถึง
# production เลย เพราะ deploy ทุกครั้งยิงจาก branch ที่ไม่มี fix นั้น
#
# ไม่มีใครทำอะไรผิดสักขั้น — คนแก้เปิด PR ถูกต้อง CI ตรวจผ่าน merge เรียบร้อย ส่วน
# คน deploy ก็ deploy ของที่เทสต์ผ่านหมด · **แต่ `main` กับ production เป็นสองเส้นที่
# ไม่รู้จักกัน** main ขยับได้โดย production ไม่รู้ และกลับกันด้วย
#
# สคริปต์นี้ทำให้สองเส้นนั้นรู้จักกัน และทำให้คำถาม "ตอนนี้รันอะไรอยู่" ตอบได้ด้วยการ
# อ่าน ไม่ใช่ด้วยการเดาจากเวลา — ซึ่งเดาผิดมาแล้วจริง
#
#   ./scripts/deploy.sh              # production จาก main
#   ./scripts/deploy.sh --poc        # deployment ทดสอบ จาก branch ไหนก็ได้
#
# ปฏิเสธไว้ก่อนเสมอ ถ้าจะข้ามต้องบอกให้ชัดด้วย ALLOW_DIRTY / ALLOW_BRANCH
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONFIG=""
TARGET="production"
if [ "${1:-}" = "--poc" ]; then
  CONFIG="--config wrangler.poc.jsonc"
  TARGET="poc"
fi

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
stop() { printf '\n  ปฏิเสธ: %s\n' "$*" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────
# 1 · ต้นทางต้องชัด
#
# production มาจาก `main` เท่านั้น · deployment ทดสอบมาจาก branch ไหนก็ได้ เพราะ
# มันมีไว้ลองของที่ยังไม่ผ่านรีวิวพอดี — สองอันนี้จึงมีกติกาคนละชุดโดยตั้งใจ
# ─────────────────────────────────────────────────────────────────────────
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

[ -z "$(git status --porcelain)" ] || [ -n "${ALLOW_DIRTY:-}" ] \
  || stop "มีไฟล์ที่ยังไม่ commit — ของที่ขึ้นไปจะไม่ตรงกับ commit ที่ฝัง ตั้ง ALLOW_DIRTY=1 ถ้าตั้งใจ"

if [ "$TARGET" = "production" ]; then
  [ "$BRANCH" = "main" ] || [ -n "${ALLOW_BRANCH:-}" ] \
    || stop "อยู่บน '$BRANCH' ไม่ใช่ main — production มาจาก main เท่านั้น ตั้ง ALLOW_BRANCH=1 ถ้าตั้งใจ"

  say "ดึงของใหม่จาก origin"
  git fetch -q origin

  BEHIND="$(git rev-list --count HEAD..origin/main)"
  if [ "$BEHIND" -ne 0 ]; then
    printf '\n  origin/main มี %s commit ที่ตัวนี้ไม่มี:\n\n' "$BEHIND" >&2
    git log --oneline "HEAD..origin/main" | sed 's/^/    /' >&2
    stop "deploy ตอนนี้จะทับของที่ merge เข้า main ไปแล้ว — merge ก่อน"
  fi
  echo "  HEAD ไม่ตามหลัง origin/main"
fi

# ─────────────────────────────────────────────────────────────────────────
# 2 · ไมเกรชันต้องลงก่อน ไม่ใช่ลงทีหลัง
#
# 21 ก.ย. `get_workspace_context` พังทั้งตัวบน deployment ทดสอบด้วย
# `no such column: scope_set_by` — ไมเกรชัน `0003` กับ `0004` ไม่เคยถูกรันบน D1 ของ poc
# ทั้งที่โค้ดที่อ่านคอลัมน์นั้นขึ้นไปแล้ว · ทีมอื่นเจอก่อนเรา
#
# กฎข้อนี้เขียนอยู่ใน `CLAUDE.md` ตั้งแต่ก่อนหน้านั้น และสคริปต์นี้ก็กันครบทุกอย่าง —
# **แต่ไม่มีด่านไหนอยู่ตรงที่มันพังจริง** ซึ่งเป็นรูปเดียวกับ fix ที่หายไปเมื่อ 20 ก.ย.
# ต่างกันแค่ว่ารอบนั้นหายทั้ง commit รอบนี้หายทั้งคอลัมน์
#
# ตรวจด้วยการ **ถามฐานข้อมูลปลายทาง** ไม่ใช่กาในทะเบียนที่คนต้องจำมาอัปเดต
# ─────────────────────────────────────────────────────────────────────────
say "ไมเกรชัน"
./scripts/check-migrations.sh ${1:-} || stop "ไมเกรชันยังไม่ครบบนปลายทาง — รันตามคำสั่งข้างบนก่อน"

# ─────────────────────────────────────────────────────────────────────────
# 3 · ด่านชุดเดียวกับ CI
#
# `.github/workflows/ci.yml` รัน typecheck → test → build · ถ้าเส้นทางที่ใช้มือทำ
# น้อยกว่านั้น มันก็คือเส้นทางที่เลี่ยง CI ได้ ซึ่งเป็นสิ่งที่เกิดขึ้นจริงมาสี่วัน
# ─────────────────────────────────────────────────────────────────────────
say "typecheck"; npm run typecheck --silent
say "test";      npm test --silent 2>&1 | tail -4
say "build";     npx wrangler deploy $CONFIG --dry-run --outdir /tmp/deploy-dry-run >/dev/null && echo "  bundle ผ่าน"

# ─────────────────────────────────────────────────────────────────────────
# 4 · ฝังเลข commit ไปกับ deployment
#
# ไม่ฝากไว้กับคนที่ต้องจำใส่ `--var` เอง เพราะกติกาที่ต้องอาศัยความจำคือกติกาที่จะ
# ถูกละเมิดโดยไม่มีใครรู้ตัว — หน้าอ่านจะขึ้นว่า `ไม่ทราบ` ถ้ามีคน deploy ข้ามสคริปต์นี้
# ─────────────────────────────────────────────────────────────────────────
SHA="$(git rev-parse --short HEAD)"
[ -z "$(git status --porcelain)" ] || SHA="$SHA-dirty"

say "deploy $TARGET จาก $BRANCH ที่ $SHA"
npx wrangler deploy $CONFIG --var "COMMIT_SHA:$SHA" 2>&1 | tail -4

say "เรียบร้อย"
echo "  $TARGET รัน $SHA · ยืนยันได้ที่แถบบนของหน้า /view"
