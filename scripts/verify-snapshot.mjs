#!/usr/bin/env node
/**
 * พิสูจน์ว่าของที่กู้คืนมา ตรงกับของที่สำรองไป — ไบต์ต่อไบต์
 *
 *   node scripts/verify-snapshot.mjs write <dir> <manifest.json>
 *   node scripts/verify-snapshot.mjs check <dir> <manifest.json>
 *
 * **ไม่รู้จักและไม่สนใจว่าของข้างในเป็นอะไร** — ทำงานกับไดเรกทอรีอะไรก็ได้ จึงใช้ได้
 * กับ export ของ Knowledge Vault, ของ ChatGPT Library, หรือของใครก็ตาม โดยไม่ต้อง
 * ตกลงรูปแบบกันก่อน · นี่คือเหตุที่มันเป็นครึ่งที่ทำได้โดยไม่ต้องเข้าถึงต้นทาง
 *
 * **สิ่งที่พิสูจน์:** ไฟล์ในไดเรกทอรีตรงกับที่ manifest บันทึกไว้ ทั้งรายชื่อและเนื้อ
 *
 * **สิ่งที่พิสูจน์ไม่ได้ และต้องบอกให้ชัด:** manifest บอกไม่ได้ว่า export นั้น
 * **ครบ** เทียบกับต้นทาง · ถ้าตอน export ตกไฟล์ไป manifest จะบันทึกว่าตกไว้ด้วย
 * แล้ว check จะผ่าน · ความครบต้องวัดจากฝั่งที่อ่านต้นทางได้ ซึ่งไม่ใช่ที่นี่
 *
 * ไม่พิมพ์เนื้อไฟล์ออกมาเลย · พิมพ์แต่เส้นทาง ขนาด และแฮช
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** ชื่อที่ไม่นับเป็นเนื้อของ snapshot — ข้ามทั้งต้นทางและปลายทางเหมือนกัน */
const SKIP = new Set([".git", "node_modules", ".DS_Store"]);

async function walk(root, dir = root, out = []) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(root, full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function inventory(root) {
  const files = await walk(root);
  const rows = [];
  for (const full of files) {
    const buf = await readFile(full);
    rows.push({
      // เก็บเป็น `/` เสมอ เพื่อให้ manifest ที่ทำบนเครื่องหนึ่งใช้ตรวจบนอีกเครื่องได้
      path: relative(root, full).split(sep).join("/"),
      bytes: (await stat(full)).size,
      sha256: createHash("sha256").update(buf).digest("hex"),
    });
  }
  return rows.sort((a, b) => (a.path < b.path ? -1 : 1));
}

function compare(expected, actual) {
  const want = new Map(expected.map((r) => [r.path, r]));
  const have = new Map(actual.map((r) => [r.path, r]));
  const missing = expected.filter((r) => !have.has(r.path)).map((r) => r.path);
  const added = actual.filter((r) => !want.has(r.path)).map((r) => r.path);
  // เทียบแฮช ไม่เทียบขนาดอย่างเดียว — ไฟล์ที่ถูกแก้โดยขนาดเท่าเดิมมีจริง
  const changed = actual
    .filter((r) => want.has(r.path) && want.get(r.path).sha256 !== r.sha256)
    .map((r) => r.path);
  return { missing, added, changed };
}

const [mode, dir, manifestPath] = process.argv.slice(2);
if (!["write", "check"].includes(mode) || !dir || !manifestPath) {
  console.error("ใช้: verify-snapshot.mjs write|check <dir> <manifest.json>");
  process.exit(2);
}

const rows = await inventory(dir);

if (mode === "write") {
  const manifest = {
    // ไม่มี `source` เพราะสคริปต์นี้ไม่รู้ว่าของมาจากไหน · ผู้สร้างต้องเขียนเอง
    created_at: new Date().toISOString(),
    algorithm: "sha256",
    skipped_names: [...SKIP],
    file_count: rows.length,
    total_bytes: rows.reduce((n, r) => n + r.bytes, 0),
    files: rows,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`  เขียน manifest: ${rows.length} ไฟล์ · ${manifest.total_bytes} ไบต์`);
  console.log(`  ${manifestPath}`);
  process.exit(0);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.algorithm !== "sha256") {
  console.error(`  ปฏิเสธ: manifest ใช้ ${manifest.algorithm} ซึ่งตัวนี้ตรวจไม่ได้`);
  process.exit(2);
}
const { missing, added, changed } = compare(manifest.files ?? [], rows);

console.log(`  เทียบ ${rows.length} ไฟล์ กับ manifest ${manifest.files?.length ?? 0} ไฟล์`);
for (const [label, list] of [
  ["หาย", missing],
  ["เกิน", added],
  ["เนื้อไม่ตรง", changed],
]) {
  if (list.length) console.log(`  ${label} ${list.length}: ${list.slice(0, 20).join(", ")}`);
}

if (missing.length || added.length || changed.length) {
  console.error("\n  ไม่ตรง — ของที่กู้คืนมาไม่เท่ากับของที่สำรองไป\n");
  process.exit(1);
}
console.log("\n  ตรงทุกไฟล์\n");
