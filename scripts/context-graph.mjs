#!/usr/bin/env node
/**
 * Fast POC — ฉายความสัมพันธ์ที่ Contract 2 มีอยู่แล้วเป็นกราฟ แล้วกู้บริบทจากมัน
 *
 *   node scripts/context-graph.mjs --edges     # เส้นเชื่อมที่มีจริง + ถูกใช้จริงแค่ไหน
 *   node scripts/context-graph.mjs <id>        # recover_context จากจุดใดก็ได้
 *
 * **อ่านอย่างเดียว · ไม่สร้างตาราง ไม่ย้าย schema ไม่มี graph DB** · ระเบียนต้นทาง
 * ยังเป็นความจริง กราฟเป็นเพียง projection ที่คำนวณสดทุกครั้ง
 *
 * ## ทุกเส้นมาจากฟิลด์ที่สัญญาเปิดให้ผู้บริโภคอ่าน
 *
 * ตาราง `EDGES` ระบุ tool ที่คืนฟิลด์นั้นไว้ทุกแถว ตรวจสวนได้ว่าไม่มีเส้นไหน
 * มาจากคอลัมน์ภายในที่ผู้บริโภคมองไม่เห็น
 *
 * ## สิ่งที่จงใจไม่ทำ
 *
 * **ไม่คำนวณ `state` ของ handoff** แม้ทำได้ เพราะกติกานั้นอยู่ใน `handoffState()`
 * ที่ `src/db-work.ts` แล้ว · เขียนซ้ำที่นี่คือนิยามที่สองที่จะเพี้ยนจากตัวจริงเมื่อไรก็ได้
 * จึงคืนข้อเท็จจริงสองข้อที่ใช้ตัดสินแทน แล้วให้ผู้อ่านใช้กติกาเอง
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const WS = process.env.COLLAB_WORKSPACE ?? "ws-001";
const DB = process.env.COLLAB_DB ?? "ai-collab";

/**
 * เส้นเชื่อมทั้งหมดที่ Contract 2 มีให้ — ไม่มีมากกว่านี้
 *
 * `kind: "field"` คือความสัมพันธ์ที่มีฟิลด์รองรับจริง
 * `kind: "text"`  คือที่ต้องแกะจากข้อความอิสระ จึงพิสูจน์ไม่ได้ว่าถูก
 */
const EDGES = [
  { from: "task", field: "discussion_id", to: "discussion", tool: "get_tasks", kind: "field" },
  { from: "decision", field: "discussion_id", to: "discussion", tool: "get_decisions", kind: "field" },
  { from: "decision", field: "superseded_by", to: "decision", tool: "get_decisions", kind: "field" },
  { from: "plan", field: "discussion_id", to: "discussion", tool: "get_plans", kind: "field" },
  { from: "plan", field: "decision_id", to: "decision", tool: "get_plans", kind: "field" },
  { from: "plan", field: "supersedes", to: "plan", tool: "get_plans", kind: "field" },
  { from: "handoff", field: "task_id", to: "task", tool: "get_handoffs", kind: "field" },
  { from: "task", field: "result_ref", to: "*", tool: "get_tasks", kind: "text" },
];

/**
 * ความสัมพันธ์ที่ทีมพูดถึงกันบนโต๊ะ แต่ **ไม่มีฟิลด์รองรับ**
 *
 * ทุกข้อในนี้วันนี้อยู่ในร้อยแก้วเท่านั้น · กราฟจึงเดินข้ามไม่ได้ และการเดาเส้นพวกนี้
 * จากข้อความคือการสร้างความสัมพันธ์ที่หลักฐานพิสูจน์ไม่ได้ ซึ่งใบงานห้ามไว้
 */
const MISSING = [
  ["decision → task", "ใบที่ตัดสินแล้วสั่งให้เกิดงาน ไม่มีเส้นไปหางานนั้น"],
  ["plan → task", "แผนไม่มีเส้นไปหางานที่แผนสั่ง"],
  ["task → task", "ไม่มีทั้ง dependency และ supersedes — โซ่ของตัวขวางมองไม่เห็น"],
  ["task → decision", "งานที่ทำตามใบตัดสิน ไม่มีเส้นย้อนกลับ"],
  ["evidence", "ไม่ใช่ entity — มีแต่ result_ref ซึ่งเป็นข้อความอิสระ"],
];

const TABLE = {
  discussion: "discussions",
  decision: "decisions",
  plan: "plans",
  task: "tasks",
  handoff: "handoffs",
};

const PREFIX = { dis: "discussion", dec: "decision", plan: "plan", task: "task", ho: "handoff" };

async function sql(query) {
  const { stdout } = await exec(
    "npx",
    ["wrangler", "d1", "execute", DB, "--remote", "--json", "--command", query],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  // wrangler พิมพ์บรรทัด log ก่อน JSON — จับจาก `[` ที่ขึ้นต้นบรรทัดเท่านั้น
  const start = stdout.search(/^\[/m);
  if (start < 0) throw new Error(`อ่านคำตอบของ wrangler ไม่ออก:\n${stdout.slice(0, 400)}`);
  return JSON.parse(stdout.slice(start))[0].results;
}

function typeOf(id) {
  return PREFIX[String(id).split("-")[0]];
}

/** id ของระเบียนอื่นที่โผล่ในข้อความอิสระ — เส้นที่ "แกะได้" ไม่ใช่เส้นที่ "มีอยู่" */
function idsInText(text) {
  if (!text) return [];
  const found = new Set();
  for (const m of String(text).matchAll(/\b(dis|dec|plan|task|ho)-[0-9a-f]{8}/g)) found.add(m[0]);
  return [...found];
}

async function edgeReport() {
  console.log(`\n  เส้นเชื่อมที่ Contract 2 มีให้ · ${WS}\n`);
  console.log(`  %s`.replace("%s", "—".repeat(72)));
  for (const e of EDGES) {
    if (e.kind === "text") continue;
    const [r] = await sql(
      `SELECT COUNT(*) a, SUM(CASE WHEN ${e.field} IS NOT NULL THEN 1 ELSE 0 END) b
         FROM ${TABLE[e.from]} ${e.from === "handoff" ? "" : `WHERE workspace_id='${WS}'`}`,
    );
    const pct = r.a ? Math.round((100 * r.b) / r.a) : 0;
    console.log(
      `  ${`${e.from} → ${e.to}`.padEnd(26)} ${String(r.b).padStart(5)}/${String(r.a).padEnd(5)} ${String(pct).padStart(3)}%  ${e.tool}.${e.field}`,
    );
  }
  const [t] = await sql(
    `SELECT COUNT(*) a, SUM(CASE WHEN result_ref IS NOT NULL THEN 1 ELSE 0 END) b
       FROM tasks WHERE workspace_id='${WS}'`,
  );
  console.log(
    `  ${"task.result_ref".padEnd(26)} ${String(t.b).padStart(5)}/${String(t.a).padEnd(5)} ${String(Math.round((100 * t.b) / t.a)).padStart(3)}%  ข้อความอิสระ · แกะได้ แต่พิสูจน์ไม่ได้`,
  );

  console.log(`\n  ความสัมพันธ์ที่ทีมพูดถึง แต่ไม่มีฟิลด์รองรับ\n`);
  for (const [name, why] of MISSING) console.log(`  ${name.padEnd(18)} ${why}`);
  console.log();
}

/**
 * โหลดทั้ง workspace ทีเดียว แล้วเดินกราฟในหน่วยความจำ
 *
 * รุ่นแรกยิงคิวรีรายเส้น · `npx wrangler` ใช้เวลาตั้งต้นราวสองถึงสามวินาทีต่อครั้ง
 * และ `discussion` เป็นจุดศูนย์ที่แตกเป็นหลายสิบเส้น BFS จึงไม่จบใน 120 วินาที
 *
 * **ข้อนี้เป็นผลของ POC เอง ไม่ใช่แค่เรื่องความเร็ว** — ผู้บริโภคที่อยากฉายกราฟ
 * ต้องดึงทั้งขอบเขตมาก่อน เพราะสัญญาไม่มี tool ที่ถามว่า *ใครชี้มาที่ระเบียนนี้*
 */
const CACHE = new Map();

async function loadAll() {
  if (CACHE.size) return CACHE;
  for (const [type, table] of Object.entries(TABLE)) {
    const scope =
      type === "handoff"
        ? `WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id='${WS}')`
        : `WHERE workspace_id='${WS}'`;
    CACHE.set(type, await sql(`SELECT * FROM ${table} ${scope}`));
  }
  return CACHE;
}

/**
 * หาระเบียนด้วยรหัสเต็มหรือรหัสย่อ
 *
 * ทั้งโต๊ะอ้างถึงกันด้วยรหัสย่อ (`task-5b8c1fa7`) จึงต้องรับ · แต่รหัสย่อที่ตรงหลายใบ
 * **ต้องปฏิเสธ ไม่ใช่หยิบใบแรก** — การหยิบใบแรกเงียบ ๆ คือรูปเดียวกับที่ทะเบียน
 * โทเคนทำกับรหัสซ้ำ แล้วไม่มีอะไรฟ้อง
 */
function find(type, id) {
  const hit = (CACHE.get(type) ?? []).filter((r) => r.id === id || r.id.startsWith(id));
  if (hit.length > 1) {
    console.error(`\n  ปฏิเสธ: รหัสย่อ '${id}' ตรงกับ ${hit.length} ใบ — ใส่ให้ยาวขึ้น\n`);
    process.exit(2);
  }
  return hit[0];
}

/** ข้อเท็จจริงที่ผู้อ่านต้องแยกให้ออก — ไม่สรุปแทน */
function annotate(type, row) {
  if (type === "decision") {
    const bits = [row.status];
    if (row.scope === "workspace" && row.status === "approved") bits.push("กติกาของโต๊ะ");
    if (row.decided_by_kind) bits.push(`ปิดโดย ${row.decided_by_kind}`);
    if (row.superseded_by) bits.push(`ถูกแทนด้วย ${row.superseded_by.slice(0, 12)}`);
    return bits.join(" · ");
  }
  if (type === "task") {
    const bits = [row.status];
    // `done` กับ `ผลถูกบันทึกแล้ว` เป็นคนละเรื่อง — นี่คือเหตุที่ result_ref มีอยู่
    if (row.status === "done") bits.push(row.result_ref ? "มีตัวชี้ผล" : "ไม่มีตัวชี้ผล");
    return bits.join(" · ");
  }
  if (type === "handoff") {
    // ไม่คำนวณ state · คืนสองข้อเท็จจริงที่ใช้ตัดสิน แล้วให้ผู้อ่านใช้กติกาเอง
    return `${row.status}${row.accepted_by ? ` · รับโดย ${row.accepted_by}` : ""}`;
  }
  if (type === "plan") return row.supersedes ? `แทน ${row.supersedes.slice(0, 12)}` : "ไม่ได้แทนแผนใด";
  return "";
}

function label(type, row) {
  return (row.title ?? row.id ?? "").slice(0, 64);
}

/** เพดานการแตกต่อโหนด — จุดศูนย์อย่าง `discussion` มีลูกหลายสิบใบ */
const FANOUT = Number(process.env.COLLAB_FANOUT ?? 8);

function neighbours(type, id, row) {
  const out = [];
  const truncated = [];

  for (const e of EDGES.filter((x) => x.from === type && x.kind === "field")) {
    if (row[e.field]) out.push({ to: row[e.field], via: `${e.from}.${e.field}`, kind: "field" });
  }

  // ย้อนทาง — ใครชี้มาที่เรา · สัญญาไม่มี tool ที่ถามข้อนี้ จึงต้องไล่จากของที่โหลดมา
  for (const e of EDGES.filter((x) => x.to === type && x.kind === "field")) {
    const all = (CACHE.get(e.from) ?? []).filter((r) => r[e.field] === id);
    for (const r of all.slice(0, FANOUT)) {
      out.push({ to: r.id, via: `${e.from}.${e.field} (ย้อนทาง)`, kind: "field" });
    }
    // **ตัดแล้วต้องบอก** — การตัดเงียบอ่านได้ว่า "มีเท่านี้"
    if (all.length > FANOUT) truncated.push(`${e.from}.${e.field}: ${all.length} ใบ แสดง ${FANOUT}`);
  }

  for (const found of idsInText(row.result_ref)) {
    out.push({ to: found, via: "task.result_ref", kind: "text" });
  }
  return { out, truncated };
}

async function recover(rootId, maxDepth = 3) {
  await loadAll();
  const rootType = typeOf(rootId);
  if (!rootType) {
    console.error(`\n  ปฏิเสธ: อ่านชนิดของ '${rootId}' ไม่ออก — รับ dis- dec- plan- task- ho-\n`);
    process.exit(2);
  }

  const seen = new Map();
  const edges = [];
  const cut = [];
  let frontier = [{ id: rootId, type: rootType, depth: 0 }];

  while (frontier.length) {
    const next = [];
    for (const node of frontier) {
      if (seen.has(node.id)) continue;
      const row = find(node.type, node.id);
      if (!row) {
        // ชี้ไปหาของที่ไม่มีอยู่ — ต้องรายงาน ไม่ใช่ข้ามเงียบ
        seen.set(node.id, { ...node, missing: true });
        continue;
      }
      // **กุญแจของ `seen` ต้องเป็นรหัสเต็มจากระเบียน ไม่ใช่รหัสย่อที่ผู้ใช้พิมพ์**
      //
      // รุ่นแรกใช้รหัสที่รับเข้ามาเป็นกุญแจ · ระเบียนเดียวกันจึงถูกเดินสองครั้ง
      // ครั้งแรกด้วยรหัสย่อของผู้ใช้ ครั้งที่สองด้วยรหัสเต็มที่เส้นย้อนทางชี้มา
      // ผลคือโหนดกับเส้นถูกนับซ้ำ และรายงาน "ตัดการแตก" โผล่สองครั้งสำหรับจุดเดียว
      // ซึ่งเป็นอาการที่ทำให้จับได้
      if (seen.has(row.id)) continue;
      seen.set(row.id, { ...node, row, id: row.id });
      if (node.depth >= maxDepth) continue;
      const { out, truncated } = neighbours(node.type, row.id, row);
      for (const t of truncated) cut.push(`${row.id.slice(0, 16)} · ${t}`);
      for (const n of out) {
        edges.push({ from: row.id, ...n });
        const t = typeOf(n.to);
        if (t && !seen.has(n.to)) next.push({ id: n.to, type: t, depth: node.depth + 1 });
      }
    }
    frontier = next;
  }

  console.log(`\n  recover_context('${rootId}') · ${WS}\n`);
  for (const [id, n] of seen) {
    if (n.missing) {
      console.log(`  ${"?".padEnd(12)} ${id}  ← ชี้ไปหาของที่อ่านไม่ได้จากขอบเขตนี้`);
      continue;
    }
    console.log(`  ${`d${n.depth}`.padEnd(4)}${n.type.padEnd(11)} ${id.slice(0, 20)}`);
    console.log(`       ${label(n.type, n.row)}`);
    const a = annotate(n.type, n.row);
    if (a) console.log(`       [${a}]`);
  }

  console.log(`\n  เส้นที่เดินจริง ${edges.length} เส้น\n`);
  for (const e of edges) {
    const mark = e.kind === "text" ? "แกะจากข้อความ" : "ฟิลด์";
    console.log(`  ${e.from.slice(0, 16)} → ${e.to.slice(0, 16)}   ${e.via}  (${mark})`);
  }
  if (cut.length) {
    console.log(`\n  ตัดการแตกที่จุดศูนย์ ${cut.length} จุด (COLLAB_FANOUT=${FANOUT})\n`);
    for (const c of cut) console.log(`  ${c}`);
  }
  console.log(`\n  โหนด ${seen.size} · เส้นจากฟิลด์ ${edges.filter((e) => e.kind === "field").length} · เส้นที่แกะจากข้อความ ${edges.filter((e) => e.kind === "text").length}\n`);
}

const arg = process.argv[2];
if (!arg) {
  console.error("ใช้: context-graph.mjs --edges | <id>");
  process.exit(2);
}
if (arg === "--edges") await edgeReport();
else await recover(arg);
