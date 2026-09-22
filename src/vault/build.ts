/**
 * สร้าง vault จาก **ผลลัพธ์ของ read tool** ไม่ใช่จากฐานข้อมูล
 *
 * ตั้งใจให้ exporter เป็น *ผู้บริโภคสัญญา* เหมือนทีมอื่น ไม่ใช่คนวงในที่อ่านตารางตรง ๆ
 * ถ้าวันหนึ่ง contract เปลี่ยนจนผู้บริโภคพัง ตัวนี้จะพังด้วย ซึ่งเป็นสิ่งที่ต้องการ —
 * exporter ที่อ่าน D1 ตรงจะยังเขียว vault ต่อไปได้ทั้งที่ client ทุกตัวข้างนอกพังหมด
 *
 * ฟังก์ชันนี้บริสุทธิ์ — ไม่มี I/O ไม่มีเวลา ไม่มีสุ่ม · `exported_at` ส่งเข้ามา
 * เพราะเวลาใน Workers ไม่ขยับระหว่างโค้ดที่รันติดกันอยู่แล้ว และเพราะ vault ที่
 * สร้างจากข้อมูลชุดเดิมต้องได้ไฟล์ชุดเดิมทุกไบต์ ไม่งั้นเทียบสองรอบไม่ได้
 */
import {
  VAULT_EXPORTER,
  VAULT_SCHEMA_VERSION,
  canonicalUri,
  isArchitecture,
  isDurableDecision,
  isRepositoryName,
  isStandingRule,
  type Derivation,
  type NoteFrontmatter,
  type NoteType,
} from "./schema";

export interface VaultDecision {
  id: string;
  title: string;
  detail: string;
  status: string;
  discussion_id: string | null;
  proposed_by: string;
  created_at: string;
  decided_by: string | null;
  decided_by_kind: string | null;
  decided_reason: string | null;
  decided_at: string | null;
  superseded_by: string | null;
  scope?: string;
  scope_set_by?: string | null;
  scope_set_at?: string | null;
}

export interface VaultPlan {
  id: string;
  title: string;
  body: string;
  discussion_id: string | null;
  decision_id: string | null;
  supersedes: string | null;
  created_by: string;
  created_at: string;
}

export interface VaultDiscussion {
  id: string;
  title: string;
  created_by: string;
  created_at: string;
  message_count: number;
  latest_seq: number;
  last_activity: string;
  last_author?: string;
  participants: string[];
}

/** ดัชนีข้อความ — **ไม่มีเนื้อ** มีแต่ของที่ชี้ตำแหน่งได้ */
export interface VaultMessageIndex {
  seq: number;
  kind: string;
  author_name: string;
  created_at: string;
  in_reply_to: number | null;
  /** ความยาวเป็นตัวอักษร ใช้ดูว่าโพสต์ไหนยาวพอจะมีเนื้อสำคัญ ไม่ใช่ตัวเนื้อ */
  length: number;
}

export interface VaultTask {
  id: string;
  title: string;
  status: string;
  assigned_to: string | null;
  discussion_id: string | null;
  created_by: string;
  updated_by?: string | null;
  updated_at?: string | null;
}

export interface VaultInput {
  contract: number;
  workspace: { id: string; name: string };
  decisions: VaultDecision[];
  plans: VaultPlan[];
  discussions: VaultDiscussion[];
  /** discussion_id → ดัชนีข้อความ · กระทู้ที่ไม่ได้ดึงมาจะไม่มีคีย์ ซึ่งต่างจากมีแต่ว่าง */
  message_index: Record<string, VaultMessageIndex[]>;
  tasks: VaultTask[];
  /** ชื่อที่เคยพูดหรือเคยลงมือ — มาจาก get_participants */
  participants: string[];
  /** โครงการที่อยู่ในขอบเขตรอบนี้ ชื่อเดียวกับที่ใช้ส่งงาน */
  projects: string[];
  exported_at: string;
}

const esc = (s: string) => s.replace(/"/g, '\\"');

/**
 * คำนำหน้ากับกลุ่มแรกของ uuid — `dec-68445ad0` · `plan-931f80d1` · `dis-42921b7f`
 *
 * **ห้ามตัดที่จำนวนตัวอักษรตายตัว** เพราะคำนำหน้ายาวไม่เท่ากัน (`dec-` สี่ตัว `plan-`
 * ห้าตัว) การตัดที่ 12 ทำให้รหัสของแผนขาดไปหนึ่งหลัก กลายเป็นตัวชี้ที่ชี้ไม่ถึงอะไรเลย
 * และหน้าตาเหมือนตัวชี้ที่ใช้ได้ทุกประการ — เจอตอนดูตัวอย่างจริงชุดแรก
 */
const shortId = (id: string) => id.split("-").slice(0, 2).join("-");

/** ตัดอักขระที่ทำให้ตั้งชื่อไฟล์ไม่ได้ · ไม่แตะภาษาไทยและช่องว่าง Obsidian รับได้ */
function safeName(title: string): string {
  return title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const noteName = (id: string, title: string) => `${shortId(id)} ${safeName(title)}`;

const link = (target: string) => `[[${target}]]`;

function frontmatter(fm: NoteFrontmatter): string {
  const lines = [
    "---",
    `type: ${fm.type}`,
    `title: "${esc(fm.title)}"`,
    "source:",
    `  system: ${fm.source.system}`,
    `  workspace: ${fm.source.workspace}`,
    `  kind: ${fm.source.kind}`,
    `  id: ${fm.source.id ?? "null"}`,
    `  updated_at: ${fm.source.updated_at ?? "null"}`,
    `canonical: ${fm.canonical}`,
    `accessible: ${fm.accessible ?? "null"}`,
    `access_status: ${fm.access_status}`,
    "provenance:",
    `  exported_at: ${fm.provenance.exported_at}`,
    `  exporter: ${fm.provenance.exporter}`,
    `  vault_schema: "${fm.provenance.vault_schema}"`,
    `  contract: ${fm.provenance.contract}`,
    `  derivation: ${fm.provenance.derivation}`,
    "  built_from:",
    ...fm.provenance.built_from.map((id) => `    - ${id}`),
    `writeback: ${fm.writeback}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

function makeFrontmatter(
  input: VaultInput,
  type: NoteType,
  title: string,
  kind: string,
  id: string | null,
  updatedAt: string | null,
  derivation: Derivation,
  builtFrom: string[],
): NoteFrontmatter {
  return {
    type,
    title,
    source: {
      system: "ai-collaboration-mcp",
      workspace: input.workspace.id,
      kind,
      id,
      updated_at: updatedAt,
    },
    canonical: canonicalUri(input.workspace.id, id),
    // ยังไม่มีที่เก็บกลางที่ผู้รับเปิดได้จริง จึงเป็น null และสถานะเป็น unknown
    // **ไม่เขียน confirmed เด็ดขาด** — ผู้สร้างสำเนายืนยันสิทธิ์ของผู้อ่านไม่ได้
    accessible: null,
    access_status: "unknown",
    provenance: {
      exported_at: input.exported_at,
      exporter: `${VAULT_EXPORTER}@${VAULT_SCHEMA_VERSION}`,
      vault_schema: VAULT_SCHEMA_VERSION,
      contract: input.contract,
      derivation,
      built_from: builtFrom,
    },
    writeback: "forbidden",
  };
}

function decisionNote(input: VaultInput, d: VaultDecision): [string, string] {
  const standing = isStandingRule(d);
  const type: NoteType = standing ? "standing-rule" : "decision";
  const folder = standing ? "Standing Rules" : "Decisions";
  const name = noteName(d.id, d.title);

  const fm = makeFrontmatter(
    input,
    type,
    d.title,
    "decision",
    d.id,
    d.decided_at,
    // เนื้อของโน้ตนี้คือ `detail` ของต้นทางคำต่อคำ ไม่มีใครเขียนใหม่
    "verbatim",
    [d.id],
  );

  const rows: string[] = [
    `# ${d.title}`,
    "",
    `> ${standing ? "**กติกาของทั้งโต๊ะ**" : "ใบตัดสิน"} · \`${d.id}\``,
    "",
    "| | |",
    "| --- | --- |",
    `| สถานะ | \`${d.status}\` |`,
    `| ผู้เสนอ | ${d.proposed_by} |`,
    `| ผู้เคาะ | ${d.decided_by ?? "—"} |`,
    `| ชนิดของผู้เคาะ | ${d.decided_by_kind ?? "—"} |`,
    `| เคาะเมื่อ | ${d.decided_at ?? "—"} |`,
  ];
  if (standing) rows.push(`| ปักโดย | ${d.scope_set_by ?? "ไม่มีบันทึก"} |`);
  if (d.superseded_by) rows.push(`| ถูกแทนที่ด้วย | ${link(shortId(d.superseded_by))} |`);

  const body = [
    ...rows,
    "",
    "## เนื้อของใบ",
    "",
    d.detail || "_ไม่มีเนื้อ_",
  ];

  if (d.decided_reason) body.push("", "## เหตุผลที่เคาะ", "", d.decided_reason);

  const plans = input.plans.filter((p) => p.decision_id === d.id);
  if (plans.length) {
    body.push("", "## แผนที่ผูกกับใบนี้", "");
    for (const p of plans) body.push(`- ${link(noteName(p.id, p.title))}`);
  }

  if (d.discussion_id) {
    const dis = input.discussions.find((x) => x.id === d.discussion_id);
    body.push("", "## มาจากกระทู้", "", `- ${dis ? link(noteName(dis.id, dis.title)) : d.discussion_id}`);
  }

  body.push("", "---", "", `ความจริงอยู่ที่ \`${canonicalUri(input.workspace.id, d.id)}\` · โน้ตนี้เป็นสำเนาอ่านอย่างเดียว`);

  return [`${folder}/${name}.md`, frontmatter(fm) + body.join("\n") + "\n"];
}

function planNote(input: VaultInput, p: VaultPlan): [string, string] {
  const fm = makeFrontmatter(input, "decision", p.title, "plan", p.id, p.created_at, "verbatim", [p.id]);
  const body = [
    `# ${p.title}`,
    "",
    `> แผน · \`${p.id}\``,
    "",
    "| | |",
    "| --- | --- |",
    `| ผู้บันทึก | ${p.created_by} |`,
    `| เมื่อ | ${p.created_at} |`,
    `| แทนที่ | ${p.supersedes ? link(shortId(p.supersedes)) : "—"} |`,
    "",
    "## เนื้อของแผน",
    "",
    p.body || "_ไม่มีเนื้อ_",
    "",
    "---",
    "",
    `ความจริงอยู่ที่ \`${canonicalUri(input.workspace.id, p.id)}\``,
  ];
  return [`Plans/${noteName(p.id, p.title)}.md`, frontmatter(fm) + body.join("\n") + "\n"];
}

/** ชื่อนี้จะมีโน้ตของตัวเองในรอบนี้ไหม — กติกาเดียวกับตอนสร้างใน `buildVault` */
function hasNote(input: VaultInput, name: string): boolean {
  return input.projects.includes(name) || (isRepositoryName(name) && input.participants.includes(name));
}

function discussionNote(input: VaultInput, dis: VaultDiscussion): [string, string] {
  const arch = isArchitecture(dis.title);
  const index = input.message_index[dis.id];
  const decisions = input.decisions.filter((d) => d.discussion_id === dis.id && isDurableDecision(d));
  const tasks = input.tasks.filter((t) => t.discussion_id === dis.id);
  const plans = input.plans.filter((p) => p.discussion_id === dis.id);

  const fm = makeFrontmatter(
    input,
    arch ? "architecture" : "discussion",
    dis.title,
    "discussion",
    dis.id,
    dis.last_activity,
    // ประกอบจากหลายระเบียน และไม่ได้ถือเนื้อข้อความ จึงเป็น distilled เสมอ
    "distilled",
    [dis.id, ...decisions.map((d) => d.id), ...plans.map((p) => p.id), ...tasks.map((t) => t.id)],
  );

  const body: string[] = [
    `# ${dis.title}`,
    "",
    `> ${arch ? "กระทู้ออกแบบ" : "กระทู้"} · \`${dis.id}\``,
    "",
    "| | |",
    "| --- | --- |",
    `| เปิดโดย | ${dis.created_by} · ${dis.created_at} |`,
    `| ล่าสุด | ${dis.last_author ?? "—"} · ${dis.last_activity} |`,
    `| จำนวนข้อความ | ${dis.message_count} (seq ล่าสุด ${dis.latest_seq}) |`,
    // ลิงก์เฉพาะชื่อที่มีโน้ตจริง — ชื่ออย่าง `ChatGPT` ไม่ใช่ `owner/repo` จึงไม่มีโน้ต
    // ลิงก์ค้างใน Obsidian ดูเหมือนลิงก์ที่ใช้ได้ทุกประการจนกว่าจะกด ซึ่งเป็นรูปเดียว
    // กับของที่โต๊ะนี้ไล่ปิด — ของที่ดูเหมือนทำงานแต่ไม่เคยพาไปถึงไหน
    `| ผู้ร่วม | ${dis.participants
      .map((p) => (hasNote(input, p) ? link(safeName(p)) : p))
      .join(" · ")} |`,
    "",
    "> [!warning] โน้ตนี้ไม่มีเนื้อข้อความ",
    "> เก็บเฉพาะดัชนีที่ชี้ได้ว่าต้องไปเปิด `seq` ไหน · เนื้อทั้งหมดอยู่ที่ต้นทางเท่านั้น",
    "> เพราะกระทู้ของโต๊ะนี้พาดถึงงานที่มีข้อมูลสุขภาพ และการไม่เอาเนื้อเลยพิสูจน์ได้",
    "> ส่วนการตัดให้หมดพิสูจน์ไม่ได้",
  ];

  if (decisions.length) {
    body.push("", "## ใบตัดสินที่ออกจากกระทู้นี้", "");
    for (const d of decisions) body.push(`- ${link(noteName(d.id, d.title))}`);
  }
  if (plans.length) {
    body.push("", "## แผน", "");
    for (const p of plans) body.push(`- ${link(noteName(p.id, p.title))}`);
  }
  if (tasks.length) {
    body.push("", "## ใบงานที่ผูกกับกระทู้นี้", "", "| ใบ | สถานะ | เจ้าของ |", "| --- | --- | --- |");
    for (const t of tasks) {
      body.push(`| \`${shortId(t.id)}\` ${safeName(t.title)} | \`${t.status}\` | ${t.assigned_to ?? "—"} |`);
    }
  }

  if (index) {
    body.push("", `## ดัชนีข้อความ · ${index.length} รายการ`, "", "| seq | ชนิด | ผู้เขียน | เมื่อ | ตอบ | ยาว |", "| --- | --- | --- | --- | --- | --- |");
    for (const m of index) {
      body.push(`| ${m.seq} | ${m.kind} | ${m.author_name} | ${m.created_at} | ${m.in_reply_to ?? "—"} | ${m.length} |`);
    }
  } else {
    body.push("", "## ดัชนีข้อความ", "", "_ไม่ได้ดึงมาในรอบนี้_ — ต่างจาก *ดึงมาแล้วไม่มีข้อความ*");
  }

  body.push("", "---", "", `อ่านของสดที่ \`get_discussion(discussion_id: "${dis.id}")\``);

  return [`${arch ? "Architecture" : "Discussions"}/${noteName(dis.id, dis.title)}.md`, frontmatter(fm) + body.join("\n") + "\n"];
}

function hubNote(
  input: VaultInput,
  type: "project" | "repository",
  name: string,
): [string, string] {
  const tasks = input.tasks.filter((t) => t.assigned_to === name);
  const discussions = input.discussions.filter((d) => d.participants.includes(name));
  const decisions = input.decisions.filter(
    (d) => isDurableDecision(d) && (d.proposed_by === name || d.decided_by === name),
  );

  const fm = makeFrontmatter(
    input,
    type,
    name,
    "participant",
    null,
    null,
    // ไม่มีระเบียน "โครงการ" ในต้นทาง โน้ตนี้ถูกประกอบขึ้นจากสิ่งที่ชื่อนี้ไปแตะไว้
    "distilled",
    [...tasks.map((t) => t.id), ...discussions.map((d) => d.id), ...decisions.map((d) => d.id)],
  );

  const body: string[] = [
    `# ${name}`,
    "",
    `> ${type === "project" ? "โครงการ" : "รีโป"} · **ไม่ใช่ระเบียนในต้นทาง** — ประกอบจากสิ่งที่ชื่อนี้ไปแตะไว้`,
    "",
    "> [!info] ชื่อไม่ใช่ตัวตน",
    "> ป้ายชื่อหนึ่งป้ายมาจากกุญแจได้หลายใบ และกุญแจใบเดียวทำงานหลายบทบาทได้",
    "> อ่าน `get_participants` เพื่อดูว่าชื่อนี้เข้ามาด้วยกุญแจกี่ใบ",
  ];

  if (decisions.length) {
    body.push("", "## ใบตัดสินที่เกี่ยวข้อง", "");
    for (const d of decisions) body.push(`- ${link(noteName(d.id, d.title))}`);
  }
  if (discussions.length) {
    body.push("", "## กระทู้ที่ร่วมอยู่", "");
    for (const d of discussions) body.push(`- ${link(noteName(d.id, d.title))}`);
  }
  if (tasks.length) {
    body.push("", "## ใบงานที่ถืออยู่", "", "| ใบ | สถานะ |", "| --- | --- |");
    for (const t of tasks) body.push(`| \`${shortId(t.id)}\` ${safeName(t.title)} | \`${t.status}\` |`);
  }
  if (!decisions.length && !discussions.length && !tasks.length) {
    body.push("", "_ยังไม่พบระเบียนที่ผูกกับชื่อนี้ในข้อมูลที่ดึงมารอบนี้_");
  }

  return [`${type === "project" ? "Projects" : "Repositories"}/${safeName(name)}.md`, frontmatter(fm) + body.join("\n") + "\n"];
}

/**
 * หน้าที่ตอบว่า vault ชุดนี้เก่าไปหรือยัง
 *
 * read model ที่บอกไม่ได้ว่าตัวเองเก่าแค่ไหน จะถูกอ่านเป็นของสดเสมอ ซึ่งเป็นรูปเดียว
 * กับที่โต๊ะนี้เจอมาทั้งสัปดาห์ — ของที่ดูเหมือนกำลังทำงานทุกประการแต่ไม่เคยขยับ
 *
 * ไม่ได้แก้ปัญหาให้หมด แต่ทำให้ **ถามได้** ด้วยข้อมูลที่อยู่ในไฟล์เอง
 */
function statusNote(input: VaultInput, files: Map<string, string>): [string, string] {
  const byType = new Map<string, number>();
  for (const content of files.values()) {
    const m = /^type: (\S+)$/m.exec(content);
    if (m) byType.set(m[1], (byType.get(m[1]) ?? 0) + 1);
  }

  const highWater = input.discussions
    .map((d) => `| \`${d.id}\` | ${d.latest_seq} | ${d.last_activity} |`)
    .sort();

  const body = [
    "# สถานะของ vault ชุดนี้",
    "",
    "> **นี่คือสำเนาอ่านอย่างเดียว ไม่ใช่ความจริง** · ความจริงอยู่ที่ `ai-collaboration-mcp`",
    "> ห้ามแก้ไฟล์ในนี้แล้วคาดว่าต้นทางจะเปลี่ยนตาม — ไม่มีทางเขียนกลับ และจะไม่มี",
    "",
    "| | |",
    "| --- | --- |",
    `| workspace | \`${input.workspace.id}\` · ${input.workspace.name} |`,
    `| contract ของ MCP | ${input.contract} |`,
    `| vault schema | ${VAULT_SCHEMA_VERSION} |`,
    `| สร้างเมื่อ | ${input.exported_at} |`,
    `| จำนวนไฟล์ | ${files.size + 1} |`,
    "",
    "## นับตามชนิด",
    "",
    "| ชนิด | จำนวน |",
    "| --- | --- |",
    ...[...byType.entries()].sort().map(([t, n]) => `| ${t} | ${n} |`),
    "",
    "## จะรู้ได้อย่างไรว่าชุดนี้เก่าไปแล้ว",
    "",
    "เทียบ `latest_seq` ข้างล่างกับของสดจาก `get_workspace_context` · ถ้าเลขของสดสูงกว่า",
    "แปลว่ามีข้อความที่ vault ชุดนี้ไม่เห็น · **เลขเท่ากันไม่ได้แปลว่าไม่มีอะไรเปลี่ยน**",
    "เพราะใบงานและใบตัดสินแก้ได้โดยไม่ขยับ `seq` ของกระทู้",
    "",
    "| กระทู้ | seq ล่าสุดตอนสร้าง | ขยับล่าสุด |",
    "| --- | --- | --- |",
    ...highWater,
    "",
    "## สิ่งที่ vault ชุดนี้ตั้งใจไม่มี",
    "",
    "- **เนื้อของข้อความในกระทู้** — มีแต่ดัชนีที่ชี้ `seq`",
    "- **เนื้อของใบงาน** — ใบงานเป็นสถานะสด เก็บแค่ชื่อกับสถานะ",
    "- **ใบตัดสินที่ยังไม่ถูกเคาะ** — ยังไม่ใช่ความรู้ที่คงทน ยังอยู่ระหว่างตัดสิน",
    "- **ข้อความสรุปที่โมเดลเขียน** — v0.1 ไม่มีการสรุปด้วยโมเดลเลยสักที่",
  ];

  return ["_vault/STATUS.md", body.join("\n") + "\n"];
}

export function buildVault(input: VaultInput): Map<string, string> {
  const files = new Map<string, string>();

  for (const d of input.decisions) {
    if (!isDurableDecision(d)) continue;
    const [path, content] = decisionNote(input, d);
    files.set(path, content);
  }
  for (const p of input.plans) {
    const [path, content] = planNote(input, p);
    files.set(path, content);
  }
  for (const dis of input.discussions) {
    const [path, content] = discussionNote(input, dis);
    files.set(path, content);
  }
  for (const name of input.projects) {
    const [path, content] = hubNote(input, "project", name);
    files.set(path, content);
  }
  for (const name of input.participants) {
    if (!isRepositoryName(name) || input.projects.includes(name)) continue;
    const [path, content] = hubNote(input, "repository", name);
    files.set(path, content);
  }

  const [statusPath, statusContent] = statusNote(input, files);
  files.set(statusPath, statusContent);

  return files;
}
