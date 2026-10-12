#!/usr/bin/env node
/**
 * พิสูจน์ว่าของที่กู้คืนมา ตรงกับของที่สำรองไป — ไบต์ต่อไบต์
 *
 *   node scripts/verify-snapshot.mjs write <dir> <manifest.json>
 *   node scripts/verify-snapshot.mjs check <dir> <manifest.json>
 *
 * `<manifest.json>` ต้องอยู่ **นอก** `<dir>` · ถ้าวางไว้ข้างในจะปฏิเสธด้วย exit 2
 * เพราะ manifest จะกลายเป็นของที่ตัวเองต้องตรวจ แล้วรายงานว่า "เกิน 1" ทุกครั้ง
 * ซึ่งอ่านเหมือน snapshot เสีย
 *
 * **ไม่รู้จักและไม่สนใจว่าของข้างในเป็นอะไร** — ทำงานกับไดเรกทอรีอะไรก็ได้ จึงใช้ได้
 * กับ export ของ Knowledge Vault, ของ ChatGPT Library, หรือของใครก็ตาม โดยไม่ต้อง
 * ตกลงรูปแบบกันก่อน · นี่คือเหตุที่มันเป็นครึ่งที่ทำได้โดยไม่ต้องเข้าถึงต้นทาง
 *
 * **สิ่งที่พิสูจน์:** ไฟล์ในไดเรกทอรีตรงกับที่ manifest บันทึกไว้ ทั้งรายชื่อและเนื้อ
 * รวมถึงโฟลเดอร์ว่างและรายการที่ไม่ใช่ไฟล์ธรรมดา ซึ่งเคยถูกข้ามไปเงียบ ๆ
 *
 * **สิ่งที่พิสูจน์ไม่ได้ และต้องบอกให้ชัด:** manifest บอกไม่ได้ว่า export นั้น
 * **ครบ** เทียบกับต้นทาง · ถ้าตอน export ตกไฟล์ไป manifest จะบันทึกว่าตกไว้ด้วย
 * แล้ว check จะผ่าน · ความครบต้องวัดจากฝั่งที่อ่านต้นทางได้ ซึ่งไม่ใช่ที่นี่
 *
 * ไม่พิมพ์เนื้อไฟล์ออกมาเลย · พิมพ์แต่เส้นทาง ขนาด และแฮช
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ที่มาของสามข้อที่เพิ่มเมื่อ 12 ต.ค. 2026 — `monthop-gmail/trueforge` (Grok)
 * โคลนรีโปนี้แล้วรันสคริปต์นี้เองบน fixture ของตัวเอง รายงานไว้ที่
 * `dis-69c89635` seq 4 เมื่อ 9 ต.ค. · ทั้งสามข้อยืนยันซ้ำได้ด้วย
 * `scripts/test-verify-snapshot.mjs` ซึ่งเป็นด่านที่ไฟล์นี้ไม่เคยมี
 *
 * **เหตุที่สามข้อนั้นรอดมาได้ ไม่ใช่เพราะมองข้าม** — สคริปต์นี้ไม่มีเทสต์อัตโนมัติ
 * เลยตั้งแต่เขียน · หกฉากที่รายงานไว้ใน `task-ee6a4029` รันด้วยมือครั้งเดียว
 * `npm test` รัน vitest ซึ่งอยู่ใน Workers runtime แตะ filesystem ไม่ได้ จึงไม่มีทาง
 * ครอบไฟล์นี้ · ด่านที่เพิ่มรอบนี้จึงเป็นสคริปต์แยกที่ `npm test` เรียกต่อ แปลว่า
 * **ทั้ง CI และ `deploy.sh` ได้ด่านนี้ไปด้วยโดยไม่ต้องจำ**
 * ─────────────────────────────────────────────────────────────────────────
 */
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

/** ชื่อที่ไม่นับเป็นเนื้อของ snapshot — ข้ามทั้งต้นทางและปลายทางเหมือนกัน */
const SKIP = new Set([".git", "node_modules", ".DS_Store"]);

/**
 * เดินไดเรกทอรีแล้วแยกของออกเป็นสามกอง ไม่ใช่เก็บแต่ไฟล์
 *
 * เดิมเก็บเฉพาะ `entry.isFile()` ซึ่งทำให้ **symlink และโฟลเดอร์ว่างหายไปเงียบ ๆ** —
 * symlink ไม่เป็นทั้ง file และ dir จึงตกช่องว่างระหว่างสองเงื่อนไข ส่วนโฟลเดอร์ว่าง
 * ถูก recurse เข้าไปแล้วไม่ได้อะไรกลับมา
 *
 * **ฟังก์ชันที่มีหน้าที่พิสูจน์ว่าตรงทุกไบต์ ห้ามข้ามอะไรโดยไม่บอก** — ถ้าข้าม
 * ต้องบอกว่าข้ามอะไรไปกี่รายการ ไม่ใช่เงียบแล้วให้ตัวเลขดูสวย
 */
async function walk(root, dir = root, acc = { files: [], emptyDirs: [], skipped: [] }) {
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );

  if (entries.length === 0 && dir !== root) acc.emptyDirs.push(dir);

  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(root, full, acc);
    else if (entry.isFile()) acc.files.push(full);
    else acc.skipped.push(full);
  }
  return acc;
}

/** เส้นทางแบบที่ manifest เก็บ — `/` เสมอ เพื่อให้ manifest ข้ามเครื่องได้ */
function rel(root, full) {
  return relative(root, full).split(sep).join("/");
}

/**
 * ของที่ไม่ใช่ไฟล์ธรรมดา — บันทึกไว้ว่ามีอยู่ **แต่ไม่เดินตามมันไป**
 *
 * การเดินตาม symlink จะทำให้แฮชของที่อยู่นอกไดเรกทอรีที่กำลังสำรอง ซึ่งเป็นการ
 * ขยายขอบเขตของ snapshot โดยไม่มีใครสั่ง · เก็บค่าปลายทางเป็นสตริงพอ เพราะคำถาม
 * ที่ต้องตอบคือ "รายการนี้ยังอยู่และยังชี้ที่เดิมไหม" ไม่ใช่ "ปลายทางมีเนื้ออะไร"
 */
async function describeSkipped(root, full) {
  const info = await lstat(full);
  const kind = info.isSymbolicLink()
    ? "symlink"
    : info.isFIFO()
      ? "fifo"
      : info.isSocket()
        ? "socket"
        : info.isBlockDevice() || info.isCharacterDevice()
          ? "device"
          : "other";
  const row = { path: rel(root, full), kind };
  if (kind === "symlink") row.target = await readlink(full);
  return row;
}

async function inventory(root) {
  const { files, emptyDirs, skipped } = await walk(root);

  const rows = [];
  for (const full of files) {
    const buf = await readFile(full);
    rows.push({
      path: rel(root, full),
      bytes: (await stat(full)).size,
      sha256: createHash("sha256").update(buf).digest("hex"),
    });
  }

  const skippedRows = [];
  for (const full of skipped) skippedRows.push(await describeSkipped(root, full));

  const byPath = (a, b) => (a.path < b.path ? -1 : 1);
  return {
    files: rows.sort(byPath),
    empty_dirs: emptyDirs.map((d) => rel(root, d)).sort(),
    skipped_entries: skippedRows.sort(byPath),
  };
}

/**
 * ชื่อสองชื่อที่ต่างกันเป็นไบต์ แต่เป็นชื่อเดียวกันหลัง normalize
 *
 * **ไม่ normalize ให้เงียบ ๆ และนี่คือการตัดสินใจ ไม่ใช่ความขี้เกียจ** — บน Linux
 * ชื่อรูป NFC และ NFD อยู่ร่วมไดเรกทอรีเดียวกันได้ เป็นสองไฟล์จริงที่เนื้อต่างกันได้
 * ถ้า normalize ก่อนเทียบ สองไฟล์นั้นจะยุบเป็นหนึ่งและเราจะ **กลืนความต่างที่มีจริง
 * เพื่อปิดปัญหาการรายงาน** ซึ่งแลกผิดทาง
 *
 * ที่ทำคือวินิจฉัย — ถ้าชื่อที่ "หาย" กับชื่อที่ "เกิน" เป็นชื่อเดียวกันหลัง NFC
 * ให้บอกตรง ๆ ว่าเป็นเรื่องรูป Unicode ไม่ใช่ไฟล์หายจริง แล้วให้คนอ่านตัดสิน
 *
 * **เหตุที่ต้องบอก ไม่ใช่แค่ว่ามันช่วย** — สองชื่อนั้น `console.log` ออกมา
 * **เหมือนกันทุกตัวอักษร** ผู้อ่านจึงเห็น `หาย 1: café.md` กับ `เกิน 1: café.md`
 * แล้วไม่มีทางรู้เลยว่าต่างกันที่ไหน · ข้อนี้แรงกว่าที่ `seq 4` เขียนไว้
 *
 * **และตัวอย่างใน `seq 4` ไม่เข้าเงื่อนไข** — ชื่อไฟล์ภาษาไทยไม่ decompose
 * `สัญญา` `ข้อตกลง` `นาฬิกา` ได้ NFC เท่ากับ NFD ทุกตัว เพราะสระและวรรณยุกต์ไทย
 * เป็นจุดรหัสแยกอยู่แล้วตั้งแต่ต้น ไม่มีรูปประกอบให้แยก · คลาสนี้มีจริงกับ Latin
 * ที่มีเครื่องหมาย (`café`) และฮันกึล (`한국어`) ซึ่ง `macOS` เขียนเป็น NFD
 */
function normalizePairs(missing, added) {
  const addedByNfc = new Map(added.map((p) => [p.normalize("NFC"), p]));
  const pairs = [];
  for (const m of missing) {
    const hit = addedByNfc.get(m.normalize("NFC"));
    if (hit !== undefined && hit !== m) pairs.push({ in_manifest: m, on_disk: hit });
  }
  return pairs;
}

/** รูปของชื่อ เพื่อให้สองชื่อที่พิมพ์ออกมาเหมือนกัน อ่านออกว่าต่างกันที่ไหน */
function unicodeForm(name) {
  if (name === name.normalize("NFC") && name !== name.normalize("NFD")) return "NFC";
  if (name === name.normalize("NFD") && name !== name.normalize("NFC")) return "NFD";
  return "เหมือนกันทั้งสองรูป";
}

/**
 * ชื่อสองชื่อในชุดเดียวกันที่ยุบเป็นชื่อเดียวหลัง normalize
 *
 * อันตรายกว่าข้อข้างบน เพราะ snapshot นี้ **กู้คืนบน macOS ไม่ได้ครบ** — ระบบไฟล์
 * ที่ normalize ชื่อให้จะเห็นสองรายการนี้เป็นรายการเดียว แล้วไฟล์หนึ่งจะทับอีกไฟล์
 * โดยไม่มีอะไรฟ้อง · ตรวจตอน `write` เพราะเป็นตอนที่แก้ได้ ไม่ใช่ตอนที่พบว่าหาย
 */
function normalizeCollisions(paths) {
  const seen = new Map();
  const clashes = [];
  for (const p of paths) {
    const key = p.normalize("NFC");
    const first = seen.get(key);
    if (first !== undefined) clashes.push([first, p]);
    else seen.set(key, p);
  }
  return clashes;
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

/** เทียบรายการที่ไม่ใช่ไฟล์ — ปลายทางของ symlink ที่เปลี่ยนก็นับว่าไม่ตรง */
function compareSkipped(expected, actual) {
  const want = new Map(expected.map((r) => [r.path, r]));
  const have = new Map(actual.map((r) => [r.path, r]));
  return {
    missing: expected.filter((r) => !have.has(r.path)).map((r) => r.path),
    added: actual.filter((r) => !want.has(r.path)).map((r) => r.path),
    changed: actual
      .filter(
        (r) =>
          want.has(r.path) &&
          (want.get(r.path).kind !== r.kind || want.get(r.path).target !== r.target),
      )
      .map((r) => r.path),
  };
}

const [mode, dir, manifestPath] = process.argv.slice(2);
if (!["write", "check"].includes(mode) || !dir || !manifestPath) {
  console.error("ใช้: verify-snapshot.mjs write|check <dir> <manifest.json>");
  process.exit(2);
}

/**
 * manifest ต้องอยู่นอกไดเรกทอรีที่ตรวจ
 *
 * เดิมไม่ปฏิเสธ ผลคือ `write` แล้ว `check` ติด ๆ กันได้ `เกิน 1: manifest.json`
 * **ซึ่งถูกตามตรรกะ แต่อ่านเหมือน snapshot เสีย** · ปฏิเสธด้วย exit 2 ที่แปลว่า
 * "ใช้ผิดวิธี" ไม่ใช่ exit 1 ที่แปลว่า "ของไม่ตรง" — สองความหมายนี้ต้องแยกออกจากกัน
 */
const dirAbs = resolve(dir);
const manifestAbs = resolve(manifestPath);
if (manifestAbs.startsWith(dirAbs + sep)) {
  console.error(`  ปฏิเสธ: manifest อยู่ใน <dir> ที่กำลังตรวจ (${rel(dirAbs, manifestAbs)})`);
  console.error("          ย้ายออกไปนอกไดเรกทอรีนั้น ไม่งั้นมันจะกลายเป็นของที่ตัวเองต้องตรวจ");
  process.exit(2);
}

const now = await inventory(dirAbs);

if (mode === "write") {
  const clashes = normalizeCollisions([
    ...now.files.map((r) => r.path),
    ...now.empty_dirs,
    ...now.skipped_entries.map((r) => r.path),
  ]);

  const manifest = {
    // ไม่มี `source` เพราะสคริปต์นี้ไม่รู้ว่าของมาจากไหน · ผู้สร้างต้องเขียนเอง
    created_at: new Date().toISOString(),
    algorithm: "sha256",
    skipped_names: [...SKIP],
    file_count: now.files.length,
    total_bytes: now.files.reduce((n, r) => n + r.bytes, 0),
    // สามคีย์นี้มีเสมอ แม้ว่าง — ผู้อ่านต้องแยก "ไม่มี" ออกจาก "ไม่ได้บันทึก" ได้
    empty_dir_count: now.empty_dirs.length,
    skipped_entry_count: now.skipped_entries.length,
    files: now.files,
    empty_dirs: now.empty_dirs,
    skipped_entries: now.skipped_entries,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`  เขียน manifest: ${now.files.length} ไฟล์ · ${manifest.total_bytes} ไบต์`);
  console.log(`  โฟลเดอร์ว่าง ${now.empty_dirs.length} · รายการที่ไม่ใช่ไฟล์ ${now.skipped_entries.length}`);
  for (const r of now.skipped_entries) {
    console.log(`    ${r.kind}: ${r.path}${r.target === undefined ? "" : ` → ${r.target}`}`);
  }
  if (clashes.length) {
    console.error(`\n  ปฏิเสธ: ${clashes.length} ชื่อที่ยุบเป็นชื่อเดียวกันเมื่อ normalize`);
    for (const [a, b] of clashes) {
      console.error(`    ${a} [${unicodeForm(a)}]  ชนกับ  ${b} [${unicodeForm(b)}]`);
    }
    console.error("          กู้คืนบนระบบไฟล์ที่ normalize ชื่อให้ (macOS) จะได้ไม่ครบ");
    console.error("          และจะไม่มีอะไรฟ้อง — แก้ชื่อที่ต้นทางก่อนสำรอง\n");
    process.exit(2);
  }
  console.log(`  ${manifestPath}`);
  process.exit(0);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.algorithm !== "sha256") {
  console.error(`  ปฏิเสธ: manifest ใช้ ${manifest.algorithm} ซึ่งตัวนี้ตรวจไม่ได้`);
  process.exit(2);
}

const files = compare(manifest.files ?? [], now.files);
console.log(`  เทียบ ${now.files.length} ไฟล์ กับ manifest ${manifest.files?.length ?? 0} ไฟล์`);

let bad = files.missing.length + files.added.length + files.changed.length > 0;

for (const [label, list] of [
  ["หาย", files.missing],
  ["เกิน", files.added],
  ["เนื้อไม่ตรง", files.changed],
]) {
  if (list.length) console.log(`  ${label} ${list.length}: ${list.slice(0, 20).join(", ")}`);
}

/**
 * คู่ที่ต่างกันแค่รูป Unicode — บอกว่าเป็นเรื่องรูปชื่อ **แต่ยังนับว่าไม่ตรง**
 *
 * ไม่ลดระดับให้เป็นคำเตือน เพราะ snapshot ที่กู้คืนมาแล้วชื่อไฟล์ไม่เหมือนเดิม
 * **คือของที่ไม่เท่ากับของที่สำรองไปจริง ๆ** · ที่เพิ่มคือเหตุผล ไม่ใช่การผ่อนผล
 */
const pairs = normalizePairs(files.missing, files.added);
if (pairs.length) {
  console.log(`\n  ${pairs.length} คู่ข้างบนต่างกันเฉพาะรูป Unicode ของชื่อ ไม่ใช่ไฟล์หายจริง:`);
  for (const p of pairs) {
    console.log(`    ใน manifest: ${p.in_manifest} [${unicodeForm(p.in_manifest)}]`);
    console.log(`    บนดิสก์:     ${p.on_disk} [${unicodeForm(p.on_disk)}]`);
  }
  console.log("    เนื้อไฟล์อาจเหมือนกันทุกไบต์ แต่ชื่อไม่เหมือน จึงยังนับว่าไม่ตรง");
}

/**
 * คีย์ที่ manifest รุ่นก่อน 12 ต.ค. 2026 ไม่มี — **ไม่ถือว่าเท่ากับ "ไม่มีของพวกนั้น"**
 *
 * `absent ≠ empty` · manifest เก่าที่ไม่มีคีย์นี้ไม่ได้บอกว่าไม่มีโฟลเดอร์ว่าง
 * มันบอกว่าตอนนั้นไม่มีใครดู · ถ้าตีว่าเป็นศูนย์ การตรวจจะผ่านโดยอ้างหลักฐานที่
 * ไม่มีอยู่ ซึ่งแย่กว่าบอกว่าตรวจข้อนี้ไม่ได้
 */
for (const [key, label, actual, cmp] of [
  ["empty_dirs", "โฟลเดอร์ว่าง", now.empty_dirs, null],
  ["skipped_entries", "รายการที่ไม่ใช่ไฟล์", now.skipped_entries, compareSkipped],
]) {
  if (manifest[key] === undefined) {
    console.log(
      `  ${label}: manifest นี้ไม่ได้บันทึกไว้ (รุ่นก่อน 12 ต.ค. 2026) — ข้อนี้ตรวจไม่ได้` +
        `${actual.length ? ` · บนดิสก์มี ${actual.length}` : ""}`,
    );
    continue;
  }
  const d =
    cmp === null
      ? {
          missing: manifest[key].filter((p) => !actual.includes(p)),
          added: actual.filter((p) => !manifest[key].includes(p)),
          changed: [],
        }
      : cmp(manifest[key], actual);
  const n = d.missing.length + d.added.length + d.changed.length;
  if (n === 0) continue;
  bad = true;
  console.log(
    `  ${label} ไม่ตรง — หาย ${d.missing.length} · เกิน ${d.added.length} · เปลี่ยน ${d.changed.length}`,
  );
  for (const [lbl, list] of [
    ["หาย", d.missing],
    ["เกิน", d.added],
    ["เปลี่ยน", d.changed],
  ]) {
    if (list.length) console.log(`    ${lbl}: ${list.slice(0, 20).join(", ")}`);
  }
}

if (bad) {
  console.error("\n  ไม่ตรง — ของที่กู้คืนมาไม่เท่ากับของที่สำรองไป\n");
  process.exit(1);
}
console.log("\n  ตรงทุกไฟล์ · โฟลเดอร์ว่างและรายการที่ไม่ใช่ไฟล์ตรงด้วย\n");
