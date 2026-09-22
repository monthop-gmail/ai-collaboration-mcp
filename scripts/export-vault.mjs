#!/usr/bin/env node
/**
 * ดึงโต๊ะออกมาเป็น Obsidian vault — อ่านอย่างเดียว ทางเดียว
 *
 * **คุยผ่าน MCP เหมือนผู้บริโภคคนอื่น ไม่ได้อ่าน D1 ตรง** · ถ้าวันหนึ่งสัญญาเปลี่ยน
 * จนผู้บริโภคข้างนอกพัง ตัวนี้จะพังด้วย ซึ่งเป็นสิ่งที่ต้องการ — exporter ที่อ่านตาราง
 * ตรงจะยังทำงานต่อได้ทั้งที่ client ทุกตัวข้างนอกพังหมด แล้วเราจะไม่รู้
 *
 *   MCP_TOKEN=... node scripts/export-vault.mjs ~/collab-vault
 *   echo "$TOKEN" | node scripts/export-vault.mjs ~/collab-vault -
 *
 * ไม่พิมพ์โทเคนออกมาเลย · ไม่เขียนกลับเข้าโต๊ะเลย · ไม่มี tool ฝั่งเขียนถูกเรียกสักตัว
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const URL_BASE = process.env.COLLAB_URL ?? "https://ai-collaboration-mcp.monthop-gmail.workers.dev/mcp";
const WORKSPACE = process.env.COLLAB_WORKSPACE ?? "ws-001";
const PROJECTS = (process.env.COLLAB_PROJECTS ?? "monthop-gmail/ai-collaboration-mcp,willpower-institute/pstack-thudong")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const dest = process.argv[2];
if (!dest) {
  console.error("ใช้: MCP_TOKEN=... node scripts/export-vault.mjs <โฟลเดอร์ปลายทาง> [-]");
  process.exit(2);
}

// ปลายทางห้ามอยู่ในรีโป — กติกาเดียวกับ `backup.sh` และด้วยเหตุผลเดียวกัน
// vault ถือเนื้อของใบตัดสินทั้งโต๊ะ ซึ่งไม่ใช่ของที่ควรเข้า git โดยไม่มีใครตั้งใจ
const DEST = resolve(dest);
if (`${DEST}/`.startsWith(`${REPO}/`)) {
  console.error(`ปฏิเสธ: ${DEST} อยู่ในรีโป — vault ถือเนื้อของใบตัดสิน ห้ามเข้า git`);
  process.exit(2);
}

const token =
  process.argv[3] === "-"
    ? (await readFile(0, "utf8")).trim()
    : (process.env.MCP_TOKEN ?? "").trim();
if (!token) {
  console.error("ไม่มีโทเคน — ตั้ง MCP_TOKEN หรือส่งเข้าทาง stdin ด้วย -");
  process.exit(2);
}

let rpcId = 0;

async function callTool(name, args = {}) {
  const response = await fetch(URL_BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: (rpcId += 1),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    // ไม่สะท้อนเนื้อคำขอกลับออกมา เพราะ header มีโทเคนอยู่
    throw new Error(`${name} ตอบ HTTP ${response.status}`);
  }
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const frame = JSON.parse(line ? line.slice(5) : text);
  if (frame.error) throw new Error(`${name}: ${frame.error.message}`);
  const payload = frame.result?.content?.[0]?.text;
  if (frame.result?.isError) throw new Error(`${name}: ${payload}`);
  return JSON.parse(payload ?? "{}");
}

console.log(`อ่านโต๊ะ ${WORKSPACE} จาก ${new URL(URL_BASE).host}`);

const context = await callTool("get_workspace_context", { workspace: WORKSPACE, limit: 200 });
const { decisions } = await callTool("get_decisions", { workspace: WORKSPACE, limit: 200 });
const { plans } = await callTool("get_plans", { workspace: WORKSPACE, limit: 200 });
const { tasks } = await callTool("get_tasks", { workspace: WORKSPACE, limit: 200 });
const { participants } = await callTool("get_participants", { workspace: WORKSPACE });

const message_index = {};
for (const dis of context.discussions) {
  const thread = await callTool("get_discussion", { discussion_id: dis.id, limit: 200 });
  // **หยิบเฉพาะสิ่งที่ชี้ตำแหน่งได้ ทิ้ง body ตั้งแต่ตรงนี้** ไม่ได้ทิ้งทีหลัง
  // ของที่ไม่เคยถูกหยิบเข้ามา หลุดออกไปไม่ได้ ส่วนของที่หยิบแล้วค่อยตัด ต้องเชื่อตัวตัด
  message_index[dis.id] = thread.messages.map((m) => ({
    seq: m.seq,
    kind: m.kind,
    author_name: m.author_name,
    created_at: m.created_at,
    in_reply_to: m.in_reply_to,
    length: String(m.body ?? "").length,
  }));
  if (thread.has_more) {
    console.warn(`  เตือน: ${dis.id} มีข้อความเกิน 200 ดัชนีจะไม่ครบ`);
  }
}

// แปลง TS เป็น JS ตอนรัน แทนการเก็บไฟล์ที่ build ไว้ล่วงหน้า
//
// ไฟล์ build ที่ค้างอยู่จะเก่ากว่าโค้ดได้โดยไม่มีอะไรฟ้อง แล้ว vault จะถูกสร้างด้วย
// กติกาเวอร์ชันเก่าทั้งที่ทุกคนเชื่อว่าใช้ของใหม่ — รูปเดียวกับ fix ที่ merge เข้า
// main แล้วแต่ production ยังรันของเก่าอยู่สี่วัน
const esbuild = await import("esbuild");
const bundle = join(REPO, "dist", "vault-build.mjs");
await mkdir(dirname(bundle), { recursive: true });
await esbuild.build({
  entryPoints: [join(REPO, "src", "vault", "build.ts")],
  outfile: bundle,
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "warning",
});
const { buildVault } = await import(bundle);

const files = buildVault({
  contract: context.contract,
  workspace: { id: context.workspace.id, name: context.workspace.name },
  decisions,
  plans,
  discussions: context.discussions,
  message_index,
  tasks,
  participants: participants.map((p) => p.name),
  projects: PROJECTS,
  exported_at: new Date().toISOString(),
});

for (const [path, content] of files) {
  const target = join(DEST, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

console.log(`เขียน ${files.size} ไฟล์ลง ${DEST}`);
console.log("อ่านอย่างเดียว — ไม่มี tool ฝั่งเขียนถูกเรียกสักตัวในรอบนี้");
