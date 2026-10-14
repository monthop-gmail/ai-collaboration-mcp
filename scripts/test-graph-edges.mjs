#!/usr/bin/env node
/**
 * ด่านกันสำเนาของตาราง `EDGES`/`MISSING` เพี้ยนจากกัน
 *
 *   node scripts/test-graph-edges.mjs
 *
 * `src/graph.ts` เป็นนิยามที่หน้าเว็บใช้ · `scripts/context-graph.mjs` เป็น node script
 * ที่เรียก `wrangler` จึง import ไฟล์ TS ไม่ได้ และยังถือสำเนาของตัวเองอยู่
 *
 * **สำเนาที่ไม่มีใครเทียบคือสำเนาที่จะต่างกันเมื่อไรก็ได้** — คนที่เพิ่มเส้นใหม่ลงที่เดียว
 * ไม่ได้ทำผิดอะไรเลย แล้วหน้าเว็บกับสคริปต์จะตอบคนละอย่างโดยไม่มีอะไรฟ้อง · เป็นรูป
 * เดียวกับที่ `CLAUDE.md` เขียนไว้ว่าของที่ผ่านทุกด่านเพราะไม่มีด่านไหนอยู่ตรงที่มันพัง
 *
 * วิธีเทียบ: ตัดช่องว่างทั้งไฟล์ แล้วดึงรูปแบบของข้อมูลออกมาด้วย regex · การตัดช่องว่าง
 * ทำกับทั้งสองไฟล์เหมือนกัน ความต่างที่เหลือจึงเป็นความต่างของเนื้อจริง ไม่ใช่ของการจัดรูป
 *
 * **ยืนยันว่าอ่านได้มากกว่าศูนย์แถวก่อนเทียบ** — ตัวเทียบที่ดึงอะไรไม่ได้เลยจะรายงานว่า
 * "เท่ากัน" ทุกครั้ง ซึ่งผ่านโดยไม่ได้ตรวจอะไร
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const squash = (p) => readFileSync(root + p, "utf8").replace(/\s+/g, "");

const EDGE_RE = /from:"([^"]*)",field:"([^"]*)",to:"([^"]*)",tool:"([^"]*)",kind:"([^"]*)"/g;
const MISSING_RE = /\["([^"]*)","([^"]*)"\]/g;

function edges(text) {
  return [...text.matchAll(EDGE_RE)].map((m) => m.slice(1, 6).join("|")).sort();
}
function missing(text) {
  return [...text.matchAll(MISSING_RE)].map((m) => m[1]).sort();
}

const ts = squash("src/graph.ts");
const mjs = squash("scripts/context-graph.mjs");

let failed = 0;
const check = (label, cond, detail = "") => {
  if (cond) return;
  failed++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
};

const tsEdges = edges(ts);
const mjsEdges = edges(mjs);
const tsMissing = missing(ts);
const mjsMissing = missing(mjs);

// กรณีบวกก่อนเทียบ — ถ้าดึงไม่ได้เลย การเทียบจะผ่านฟรี
check("อ่าน EDGES จาก src/graph.ts ได้", tsEdges.length > 0);
check("อ่าน EDGES จาก context-graph.mjs ได้", mjsEdges.length > 0);
check("อ่าน MISSING จาก src/graph.ts ได้", tsMissing.length > 0);
check("อ่าน MISSING จาก context-graph.mjs ได้", mjsMissing.length > 0);

check(
  "EDGES ตรงกันทั้งสองไฟล์",
  JSON.stringify(tsEdges) === JSON.stringify(mjsEdges),
  `graph.ts: ${tsEdges.length} แถว\n      context-graph.mjs: ${mjsEdges.length} แถว\n      ` +
    `เฉพาะใน graph.ts: ${tsEdges.filter((e) => !mjsEdges.includes(e)).join(" ") || "ไม่มี"}\n      ` +
    `เฉพาะใน mjs: ${mjsEdges.filter((e) => !tsEdges.includes(e)).join(" ") || "ไม่มี"}`,
);

check(
  "MISSING ตรงกันทั้งสองไฟล์",
  JSON.stringify(tsMissing) === JSON.stringify(mjsMissing),
  `เฉพาะใน graph.ts: ${tsMissing.filter((e) => !mjsMissing.includes(e)).join(" · ") || "ไม่มี"}\n      ` +
    `เฉพาะใน mjs: ${mjsMissing.filter((e) => !tsMissing.includes(e)).join(" · ") || "ไม่มี"}`,
);

if (failed > 0) {
  console.error(`\n  graph-edges: ${failed} ข้อไม่ผ่าน\n`);
  process.exit(1);
}
console.log(
  `  graph-edges: ${tsEdges.length} เส้น · ${tsMissing.length} เส้นที่ยังไม่มี · ตรงกันทั้งสองไฟล์`,
);
