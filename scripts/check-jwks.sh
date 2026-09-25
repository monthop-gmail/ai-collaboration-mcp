#!/usr/bin/env bash
#
# เทียบกุญแจที่เรา pin ไว้ กับกุญแจที่ gateway เผยแพร่อยู่จริง
#
# **ทำไมต้องมี:** `test/deployment-config.test.ts` ตรวจว่าชนิดที่ประกาศตรงกับกุญแจที่
# วางไว้ และไม่มีกุญแจส่วนตัวหลุด — **แต่จับ "ถอดดอกเก่าทิ้ง" ไม่ได้** ซึ่งเป็นท่าที่
# อันตรายที่สุดของการหมุนกุญแจ · ถอดดอกที่ upstream ยังเซ็นอยู่ = ทุกคำขอได้ `401
# unknown_kid` ทันที และหน้าตาเหมือนตอนที่ระบบทำงานถูกต้องทุกประการ
#
# สคริปต์นี้**ไม่ได้อยู่ในเส้นทาง deploy โดยตั้งใจ** — `deploy.sh` ต้องไม่พึ่ง endpoint
# ของคนอื่น ไม่งั้น endpoint เขาล่มแปลว่าเรา deploy ไม่ได้ ซึ่งเป็นการผูกความพร้อมใช้งาน
# ที่เราเพิ่งปฏิเสธไปตอนคุยเรื่อง "ดึง JWKS สด" (`dis-514ae7a7` seq 65)
#
# ใช้ตอนจะหมุนกุญแจ — รันก่อนแก้ และรันอีกครั้งหลังแก้
#
#   ./scripts/check-jwks.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONFIG="wrangler.poc.jsonc"
URL="${GATEWAY_JWKS_URL:-https://internal-mcp-gateway-test.monthop-gmail.workers.dev/.well-known/jwks.json}"

if ! LIVE="$(curl -sS --max-time 20 "$URL")"; then
  printf '\n  ปฏิเสธ: ดึง JWKS จาก %s ไม่ได้ — ไม่สรุปว่าตรงกัน\n\n' "$URL" >&2
  exit 1
fi

printf '%s' "$LIVE" | CONFIG="$CONFIG" python3 -c '
import json, os, re, sys

live = json.load(sys.stdin)
raw = open(os.environ["CONFIG"]).read()
cfg = json.loads("\n".join(l for l in raw.split("\n") if not re.match(r"^\s*//", l)))
pinned = json.loads(cfg["vars"]["GATEWAY_JWKS"])

def by_kid(jwks):
    return {k.get("kid", ""): k for k in jwks.get("keys", [])}

L, P = by_kid(live), by_kid(pinned)

print(f"  ที่ gateway เผยแพร่ : {sorted(L)}")
print(f"  ที่เรา pin ไว้      : {sorted(P)}")
print()

fail = False

# ข้อที่อันตรายที่สุด — ดอกที่เขายังเผยแพร่อยู่ แต่เราไม่ยอมรับ
missing = sorted(set(L) - set(P))
if missing:
    fail = True
    print(f"  ปฏิเสธ: เรายังไม่ยอมรับ {missing} ซึ่ง gateway เผยแพร่อยู่")
    print("         ถ้าเขาสลับมาเซ็นด้วยดอกนั้น ทุกคำขอจะได้ 401 unknown_kid ทันที")

# ดอกที่เรายอมรับแต่เขาถอนไปแล้ว — ไม่อันตราย แต่ต้องเห็น
stale = sorted(set(P) - set(L))
if stale:
    print(f"  หมายเหตุ: เรายังยอมรับ {stale} ซึ่งถูกถอนจาก JWKS แล้ว")
    print("           ไม่ทำให้พัง แต่เป็นของค้างที่ควรเก็บกวาดหลังหมุนเสร็จ")

# สาระสำคัญของดอกที่ชื่อเดียวกัน ต้องตรงกัน ไม่งั้นเป็นคนละกุญแจที่ชื่อซ้ำ
for kid in sorted(set(L) & set(P)):
    if (L[kid].get("n"), L[kid].get("e")) != (P[kid].get("n"), P[kid].get("e")):
        fail = True
        print(f"  ปฏิเสธ: {kid} ชื่อเดียวกันแต่เป็นคนละกุญแจ")

PRIV = {"d", "p", "q", "dp", "dq", "qi"}
for kid, k in P.items():
    if PRIV & set(k):
        fail = True
        print(f"  ปฏิเสธ: {kid} ที่เรา pin มีช่องกุญแจส่วนตัว")

if fail:
    sys.exit(1)
print("  ยอมรับครบทุกดอกที่ gateway เผยแพร่ และไม่มีกุญแจส่วนตัวใน config")
'
