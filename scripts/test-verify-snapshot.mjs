#!/usr/bin/env node
/**
 * ด่านของ `verify-snapshot.mjs` — ซึ่งไฟล์นั้นไม่มีเลยตั้งแต่เขียน
 *
 *   node scripts/test-verify-snapshot.mjs
 *
 * **ทำไมต้องเป็นสคริปต์แยก ไม่ใช่เทสต์ใน `test/`** — `npm test` รัน vitest ด้วย
 * `@cloudflare/vitest-pool-workers` ซึ่งรันในรันไทม์ของ Workers จริง ที่นั่น
 * **ไม่มี filesystem** จึง `import("node:fs")` ไม่ได้ และสคริปต์นี้ทำงานกับไฟล์จริง
 * ทั้งตัว · เทสต์ที่ mock filesystem จะไม่เห็นข้อที่ตัวจริงพัง ซึ่งเป็นกติกาเดียวกับ
 * ที่ `CLAUDE.md` เขียนไว้เรื่องการ mock ฐานข้อมูล
 *
 * `package.json` จึงเรียกไฟล์นี้ต่อจาก vitest ใน `npm test` — แปลว่า **ทั้ง CI
 * และ `scripts/deploy.sh` ได้ด่านนี้โดยไม่ต้องมีใครจำว่าต้องรันเพิ่ม** และ
 * `deploy.sh` ตั้ง `pipefail` ไว้แล้ว ดังนั้นการที่มันไพป์ผ่าน `tail` ไม่กินรหัสออก
 *
 * **ทุกฉากที่ `fail` ได้ ต้องมีฉากที่ `pass` คู่กัน** — ตัวตรวจที่ตอบว่าไม่ตรง
 * กับทุกอย่างจะผ่านฉากลบทั้งหมดโดยไม่มีประโยชน์อะไรเลย เป็นกติกาที่
 * `ai-tools-mcp` ยก ADR-0007 ไว้ และ `CLAUDE.md` ของรีโปนี้เขียนไว้ก่อนแล้ว
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, renameSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./verify-snapshot.mjs", import.meta.url));

let failed = 0;
let passed = 0;

function run(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function check(label, cond, detail = "") {
  if (cond) {
    passed++;
    return;
  }
  failed++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail.replace(/\n/g, "\n      ")}` : ""}`);
}

function scenario(label, fn) {
  const root = mkdtempSync(join(tmpdir(), "snapshot-test-"));
  const dir = join(root, "snap");
  const manifest = join(root, "manifest.json");
  mkdirSync(dir);
  try {
    fn({ root, dir, manifest, label });
  } catch (err) {
    // ตัวตรวจที่ตายกลางทางรายงานไม่ครบ — ฉากที่พังต้องนับเป็นไม่ผ่าน แล้วเดินต่อ
    failed++;
    console.error(`  ✗ ${label} · ฉากนี้โยน exception\n      ${String(err).split("\n")[0]}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function seed(dir) {
  writeFileSync(join(dir, "a.txt"), "aaa\n");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "b.txt"), "bbb\n");
}

/* ── กรณีบวก — ตัวตรวจต้องพูดว่า "ผ่าน" เป็น ───────────────────────────── */

scenario("ไม่แตะอะไรเลย ต้องผ่าน", ({ dir, manifest, label }) => {
  seed(dir);
  check(`${label} · write`, run("write", dir, manifest).code === 0);
  const r = run("check", dir, manifest);
  check(`${label} · check`, r.code === 0, r.out);
});

scenario("symlink ที่ยังอยู่และยังชี้ที่เดิม ต้องผ่าน", ({ dir, manifest, label }) => {
  seed(dir);
  symlinkSync("a.txt", join(dir, "link.txt"));
  run("write", dir, manifest);
  const r = run("check", dir, manifest);
  check(label, r.code === 0, r.out);
});

scenario("โฟลเดอร์ว่างที่ยังอยู่ ต้องผ่าน", ({ dir, manifest, label }) => {
  seed(dir);
  mkdirSync(join(dir, "emptydir"));
  run("write", dir, manifest);
  const r = run("check", dir, manifest);
  check(label, r.code === 0, r.out);
});

/* ── manifest ต้องบันทึกของที่มีอยู่จริง ไม่ใช่แค่ไฟล์ ──────────────────── */

scenario("manifest บันทึก symlink กับโฟลเดอร์ว่างไว้จริง", ({ dir, manifest, label }) => {
  seed(dir);
  symlinkSync("a.txt", join(dir, "link.txt"));
  mkdirSync(join(dir, "emptydir"));
  const r = run("write", dir, manifest);
  const m = JSON.parse(readFileSync(manifest, "utf8"));

  check(`${label} · file_count ไม่นับ symlink`, m.file_count === 2, `ได้ ${m.file_count}`);
  check(`${label} · skipped_entries 1 รายการ`, (m.skipped_entries ?? []).length === 1);
  check(`${label} · kind เป็น symlink`, m.skipped_entries[0]?.kind === "symlink");
  check(`${label} · เก็บปลายทางไว้`, m.skipped_entries[0]?.target === "a.txt");
  check(`${label} · empty_dirs มี emptydir`, (m.empty_dirs ?? []).includes("emptydir"));
  // บั๊กเดิมคือ "ข้ามเงียบ ๆ" — ไม่พอที่จะบันทึก ต้องพิมพ์ให้คนที่รันเห็นด้วย
  check(`${label} · พิมพ์ให้คนที่รันเห็น`, r.out.includes("symlink: link.txt"), r.out);
});

scenario("คีย์นับของต้องมีเสมอ แม้ไม่มีของพวกนั้นเลย", ({ dir, manifest, label }) => {
  seed(dir);
  run("write", dir, manifest);
  const m = JSON.parse(readFileSync(manifest, "utf8"));
  check(`${label} · empty_dir_count`, m.empty_dir_count === 0);
  check(`${label} · skipped_entry_count`, m.skipped_entry_count === 0);
  check(`${label} · empty_dirs เป็น []`, Array.isArray(m.empty_dirs) && m.empty_dirs.length === 0);
  check(
    `${label} · skipped_entries เป็น []`,
    Array.isArray(m.skipped_entries) && m.skipped_entries.length === 0,
  );
});

/* ── กรณีลบ — ของที่เปลี่ยนต้องดัง ──────────────────────────────────────── */

scenario("เนื้อเปลี่ยนโดยขนาดเท่าเดิม ต้องจับได้", ({ dir, manifest, label }) => {
  seed(dir);
  run("write", dir, manifest);
  writeFileSync(join(dir, "a.txt"), "aab\n");
  const r = run("check", dir, manifest);
  check(label, r.code === 1 && r.out.includes("เนื้อไม่ตรง"), r.out);
});

scenario("ไฟล์หาย ต้องจับได้", ({ dir, manifest, label }) => {
  seed(dir);
  run("write", dir, manifest);
  rmSync(join(dir, "sub", "b.txt"));
  const r = run("check", dir, manifest);
  check(label, r.code === 1 && r.out.includes("หาย"), r.out);
});

scenario("ไฟล์เกิน ต้องจับได้", ({ dir, manifest, label }) => {
  seed(dir);
  run("write", dir, manifest);
  writeFileSync(join(dir, "c.txt"), "ccc\n");
  const r = run("check", dir, manifest);
  check(label, r.code === 1 && r.out.includes("เกิน"), r.out);
});

scenario("symlink หาย ต้องจับได้ (เดิมเงียบ)", ({ dir, manifest, label }) => {
  seed(dir);
  symlinkSync("a.txt", join(dir, "link.txt"));
  run("write", dir, manifest);
  rmSync(join(dir, "link.txt"));
  const r = run("check", dir, manifest);
  check(label, r.code === 1 && r.out.includes("รายการที่ไม่ใช่ไฟล์"), r.out);
});

scenario("symlink เปลี่ยนปลายทาง ต้องจับได้", ({ dir, manifest, label }) => {
  seed(dir);
  symlinkSync("a.txt", join(dir, "link.txt"));
  run("write", dir, manifest);
  rmSync(join(dir, "link.txt"));
  symlinkSync("sub/b.txt", join(dir, "link.txt"));
  const r = run("check", dir, manifest);
  check(label, r.code === 1 && r.out.includes("เปลี่ยน"), r.out);
});

scenario("symlink โผล่มาใหม่ ต้องจับได้", ({ dir, manifest, label }) => {
  seed(dir);
  run("write", dir, manifest);
  symlinkSync("a.txt", join(dir, "link.txt"));
  const r = run("check", dir, manifest);
  check(label, r.code === 1, r.out);
});

scenario("โฟลเดอร์ว่างหาย ต้องจับได้ (เดิม exit 0)", ({ dir, manifest, label }) => {
  seed(dir);
  mkdirSync(join(dir, "emptydir"));
  run("write", dir, manifest);
  rmSync(join(dir, "emptydir"), { recursive: true });
  const r = run("check", dir, manifest);
  check(label, r.code === 1 && r.out.includes("โฟลเดอร์ว่าง"), r.out);
});

scenario("โฟลเดอร์ว่างโผล่มาใหม่ ต้องจับได้", ({ dir, manifest, label }) => {
  seed(dir);
  run("write", dir, manifest);
  mkdirSync(join(dir, "newempty"));
  const r = run("check", dir, manifest);
  check(label, r.code === 1, r.out);
});

/* ── รูป Unicode ของชื่อไฟล์ ─────────────────────────────────────────────── */

const NFD = "café.md"; // e + combining acute
const NFC = "café.md"; // é ตัวเดียว

scenario("ชื่อที่ต่างกันแค่รูป Unicode ต้องไม่ตรง และต้องบอกว่าทำไม", ({
  dir,
  manifest,
  label,
}) => {
  writeFileSync(join(dir, NFD), "x\n");
  run("write", dir, manifest);
  renameSync(join(dir, NFD), join(dir, NFC));
  const r = run("check", dir, manifest);

  check(`${label} · ยังนับว่าไม่ตรง`, r.code === 1, r.out);
  // ข้อที่สำคัญกว่ารหัสออก — สองชื่อพิมพ์ออกมาเหมือนกันทุกตัวอักษร
  // ถ้าไม่บอกรูป ผู้อ่านเห็น "หาย café.md / เกิน café.md" แล้วไม่มีทางรู้ว่าต่างที่ไหน
  check(`${label} · อธิบายว่าเป็นเรื่องรูป Unicode`, r.out.includes("รูป Unicode"), r.out);
  check(`${label} · ระบุรูป NFD`, r.out.includes("[NFD]"), r.out);
  check(`${label} · ระบุรูป NFC`, r.out.includes("[NFC]"), r.out);
});

scenario("ชื่อไทยไม่เข้าเงื่อนไขนี้ — NFC เท่ากับ NFD", ({ dir, manifest, label }) => {
  // ข้อที่ `dis-69c89635` seq 4 ยกตัวอย่างไว้ผิด · สระและวรรณยุกต์ไทยเป็นจุดรหัส
  // แยกอยู่แล้ว ไม่มีรูปประกอบให้แยก จึง rename ไปอีกรูปไม่ได้เลย
  for (const name of ["สัญญา.md", "ข้อตกลง.md", "นาฬิกา.md"]) {
    check(
      `${label} · ${name}`,
      name.normalize("NFC") === name.normalize("NFD"),
      "ถ้าข้อนี้แดงวันหนึ่ง แปลว่าสมมติฐานเรื่องภาษาไทยเปลี่ยน ต้องอ่านใหม่ทั้งข้อ",
    );
  }
  writeFileSync(join(dir, "สัญญา.md"), "x\n");
  run("write", dir, manifest);
  const r = run("check", dir, manifest);
  check(`${label} · ยังตรวจผ่านปกติ`, r.code === 0, r.out);
});

scenario("สองชื่อที่ยุบเป็นชื่อเดียวกัน ต้องปฏิเสธตอน write", ({ dir, manifest, label }) => {
  writeFileSync(join(dir, NFD), "x\n");
  writeFileSync(join(dir, NFC), "y\n");
  const r = run("write", dir, manifest);
  // exit 2 = ใช้ผิด/ของมีปัญหาเชิงโครงสร้าง ไม่ใช่ 1 = ของไม่ตรง
  check(`${label} · exit 2`, r.code === 2, r.out);
  check(`${label} · บอกว่าชนกัน`, r.out.includes("ยุบเป็นชื่อเดียวกัน"), r.out);
  check(`${label} · เตือนเรื่อง macOS`, r.out.includes("macOS"), r.out);
});

/* ── การใช้ผิดวิธี ต้องแยกจาก "ของไม่ตรง" ──────────────────────────────── */

scenario("manifest อยู่ในไดเรกทอรีที่ตรวจ ต้องปฏิเสธ", ({ dir, label }) => {
  seed(dir);
  const inside = join(dir, "m.json");
  const w = run("write", dir, inside);
  check(`${label} · write exit 2`, w.code === 2, w.out);
  check(`${label} · บอกเหตุ`, w.out.includes("อยู่ใน <dir>"), w.out);
  const c = run("check", dir, inside);
  check(`${label} · check exit 2`, c.code === 2, c.out);
});

scenario("algorithm ที่ตรวจไม่ได้ ต้องปฏิเสธ", ({ dir, manifest, label }) => {
  seed(dir);
  run("write", dir, manifest);
  const m = JSON.parse(readFileSync(manifest, "utf8"));
  m.algorithm = "md5";
  writeFileSync(manifest, JSON.stringify(m));
  const r = run("check", dir, manifest);
  check(label, r.code === 2 && r.out.includes("md5"), r.out);
});

scenario("เรียกผิดวิธี ต้องได้ exit 2", ({ dir, label }) => {
  check(`${label} · ไม่มี mode`, run("nope", dir, "x.json").code === 2);
  check(`${label} · ไม่มีอาร์กิวเมนต์`, run("check").code === 2);
});

/* ── manifest รุ่นเก่า — absent ไม่เท่ากับ empty ─────────────────────────── */

scenario("manifest เก่าที่ไม่มีคีย์ใหม่ ต้องบอกว่าตรวจไม่ได้ ไม่ใช่ถือว่าไม่มี", ({
  dir,
  manifest,
  label,
}) => {
  seed(dir);
  mkdirSync(join(dir, "emptydir"));
  symlinkSync("a.txt", join(dir, "link.txt"));
  run("write", dir, manifest);

  // จำลอง manifest ที่เขียนด้วยสคริปต์รุ่นก่อน 12 ต.ค. 2026
  const m = JSON.parse(readFileSync(manifest, "utf8"));
  delete m.empty_dirs;
  delete m.skipped_entries;
  delete m.empty_dir_count;
  delete m.skipped_entry_count;
  writeFileSync(manifest, JSON.stringify(m));

  const r = run("check", dir, manifest);
  check(`${label} · ไม่ล้มเพราะคีย์หาย`, r.code === 0, r.out);
  check(`${label} · บอกว่าตรวจไม่ได้`, r.out.includes("ตรวจไม่ได้"), r.out);
  check(`${label} · บอกว่าบนดิสก์มีเท่าไร`, r.out.includes("บนดิสก์มี"), r.out);
});

/* ── ผลรวม ──────────────────────────────────────────────────────────────── */

if (failed > 0) {
  console.error(`\n  verify-snapshot: ${failed} ข้อไม่ผ่าน · ${passed} ข้อผ่าน\n`);
  process.exit(1);
}
console.log(`  verify-snapshot: ${passed} ข้อผ่าน`);
