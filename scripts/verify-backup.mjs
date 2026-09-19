/**
 * ตรวจว่าไฟล์ dump **กู้กลับได้จริง** ไม่ใช่แค่ดาวน์โหลดสำเร็จ
 *
 * ไฟล์ที่ยังไม่เคยถูกกู้ ไม่ใช่ backup — มันเป็นไฟล์ที่เราหวังว่าจะเป็น backup
 * เหตุผลเดียวกับที่ repo นี้ไม่ยอมรับ "เทสต์เขียว" เป็นหลักฐานว่าของต่อสายแล้ว
 *
 * รับยอดแถวสดสองชุดทาง stdin — ก่อนและหลัง export — แล้วตรวจว่ายอดใน dump อยู่
 * ระหว่างนั้น **ไม่ใช่เท่ากันเป๊ะ** เพราะโต๊ะมีคนเขียนตลอดเวลา การบังคับให้เท่ากัน
 * จะทำให้ backup ที่ถูกต้องสอบตกเมื่อมีใครโพสต์ระหว่างที่ export กำลังวิ่ง
 *
 * ช่วงนี้ใช้ได้เพราะระบบนี้ **ไม่มี tool ลบอะไรเลย** ยอดจึงขึ้นทางเดียว ถ้าวันหนึ่ง
 * มีการลบเกิดขึ้นได้ เกณฑ์นี้ต้องเปลี่ยน และมันจะสอบตกให้เห็นก่อน ไม่ใช่เงียบ
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const [dumpPath, beforeJson, afterJson] = process.argv.slice(2);
if (!dumpPath || !beforeJson || !afterJson) {
  console.error("ใช้: node verify-backup.mjs <dump.sql> <ยอดก่อน json> <ยอดหลัง json>");
  process.exit(2);
}

const before = JSON.parse(readFileSync(beforeJson, "utf8"));
const after = JSON.parse(readFileSync(afterJson, "utf8"));

/**
 * ปิดการบังคับ foreign key ตอนโหลด — ไม่ใช่การยอมให้ข้อมูลพัง
 *
 * `d1 export` เรียงคำสั่ง `INSERT` โดยไม่สนลำดับการอ้างอิง ลูกจึงมาก่อนแม่ได้
 * โหลดโดยเปิด FK ไว้จะล้มด้วย `FOREIGN KEY constraint failed` ทั้งที่ข้อมูลถูกครบ
 * (`d1 import` ของ Cloudflare เองก็ทำแบบเดียวกัน)
 *
 * **ความถูกต้องของการอ้างอิงถูกตรวจทีหลังด้วย `foreign_key_check`** ซึ่งเป็นการตรวจ
 * ผลลัพธ์สุดท้าย ไม่ใช่ตรวจลำดับระหว่างทาง
 */
const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
db.exec(readFileSync(dumpPath, "utf8"));

const problems = [];

for (const table of Object.keys(before)) {
  const n = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  const lo = before[table];
  const hi = after[table];
  const ok = n >= lo && n <= hi;
  console.log(
    `${table.padEnd(12)} dump ${String(n).padStart(5)}` +
      `   ช่วงที่ยอมรับ ${lo}–${hi}   ${ok ? "ผ่าน" : "ไม่ผ่าน"}`,
  );
  if (!ok) problems.push(`${table}: dump ${n} อยู่นอกช่วง ${lo}–${hi}`);
}

const broken = db.prepare("PRAGMA foreign_key_check").all();
if (broken.length > 0) problems.push(`อ้างอิงพัง ${broken.length} แถว`);
console.log(`foreign_key_check   ${broken.length === 0 ? "ผ่าน" : `ไม่ผ่าน (${broken.length})`}`);

const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
if (integrity !== "ok") problems.push(`integrity_check: ${integrity}`);
console.log(`integrity_check     ${integrity === "ok" ? "ผ่าน" : integrity}`);

// ตารางหายทั้งตารางจะไม่ถูกจับด้วยยอดแถว เพราะ query จะ error ไปก่อน — ตรวจชื่อด้วย
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map((r) => r.name);
const missing = Object.keys(before).filter((t) => !tables.includes(t));
if (missing.length > 0) problems.push(`ตารางหาย: ${missing.join(", ")}`);
console.log(`ตารางครบ            ${missing.length === 0 ? `ผ่าน (${tables.length})` : missing.join(", ")}`);

if (problems.length > 0) {
  console.error("\nกู้กลับไม่ผ่าน:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log("\nกู้กลับได้ครบ ไฟล์นี้ใช้เป็น backup ได้");
