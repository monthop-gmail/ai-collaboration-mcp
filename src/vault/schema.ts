/**
 * Knowledge Vault schema v0.1 — สัญญาของ **read model** ไม่ใช่ของ source of truth
 *
 * `ai-collaboration-mcp` ยังเป็นเจ้าของความจริง · vault เป็นของที่ถูกสร้างจากมัน
 * ทางเดียว ห้ามเขียนกลับ · ทุกโน้ตจึงต้องตอบสามคำถามได้จากตัวมันเอง
 *
 *   1. ของนี้มาจากไหน            → `source` + `canonical`
 *   2. เป็นคำต่อคำ หรือถูกเรียบเรียง → `derivation`
 *   3. ตอนนี้ยังตรงกับต้นทางไหม    → `source.updated_at` เทียบกับของสด
 *
 * ข้อ 2 เป็นข้อที่เพิ่มเข้ามาเพราะ `Cursor` ขอไว้ที่ `dis-97cd37f1` seq 2 ว่า
 * AI-generated summary ต้องติดป้ายให้ชัดว่าเป็น summary ไม่ใช่ decision · **ทำเป็น
 * ป้ายในร้อยแก้วไม่พอ** เพราะป้ายที่ไม่มีใครตรวจคือป้ายที่จะหลุดโดยไม่มีอะไรฟ้อง
 * จึงเป็นฟิลด์บังคับที่มีค่าได้สองค่า และมีเทสต์บังคับว่าโน้ตที่ถือเนื้อคำต่อคำ
 * ต้องไม่ประกาศว่า distilled และกลับกัน
 */

/** เลขสัญญาของ vault เอง — คนละเลขกับ `contract` ของ MCP และขยับคนละจังหวะ */
export const VAULT_SCHEMA_VERSION = "0.1";

export const VAULT_EXPORTER = "ai-collaboration-mcp/vault-exporter";

export const NOTE_TYPES = [
  "project",
  "decision",
  "standing-rule",
  "discussion",
  "repository",
  "architecture",
] as const;

export type NoteType = (typeof NOTE_TYPES)[number];

/**
 * โน้ตถือเนื้อของต้นทางแบบคำต่อคำ หรือถูกประกอบขึ้นใหม่
 *
 * `verbatim` — เนื้อในโน้ตคัดมาจากฟิลด์ของระเบียนต้นทางตรง ๆ ไม่มีใครเขียนใหม่
 * `distilled` — โน้ตถูกประกอบจากหลายระเบียน หรือจัดรูปใหม่ · **ยังไม่มี LLM ในเส้นนี้**
 *
 * v0.1 ตั้งใจไม่มีการสรุปด้วยโมเดลเลยสักที่ · การสรุปที่ไม่มีใครตรวจคือคำกล่าวอ้าง
 * ที่ดูน่าเชื่อ ซึ่งเป็นรูปเดียวกับที่โต๊ะนี้ไล่ปิดกันทั้งสัปดาห์ · ถ้าจะเพิ่มภายหลัง
 * ต้องมาพร้อมวิธีตรวจว่าสรุปตรงกับต้นทาง ไม่ใช่มาพร้อมป้ายว่าเป็นสรุป
 */
export const DERIVATIONS = ["verbatim", "distilled"] as const;
export type Derivation = (typeof DERIVATIONS)[number];

/**
 * สิทธิ์การอ่านของ *สำเนาที่แจกจ่ายได้* แยกจาก *ที่อยู่ของความจริง*
 *
 * `ChatGPT` ขอไว้ที่ `dis-97cd37f1` seq 4 ให้เผื่อที่ไว้บันทึกสองอย่างนี้แยกกัน
 *
 * **exporter จะไม่เขียน `confirmed` เลย** — ผู้สร้างสำเนายืนยันสิทธิ์การอ่านของผู้อื่น
 * ไม่ได้โดยนิยาม มีแต่ผู้อ่านที่ยืนยันได้ · ค่าที่ประกาศได้แต่ตรวจไม่ได้ จะไม่ตรง
 * โดยไม่มีอะไรฟ้อง ซึ่งเป็นรูปเดียวกับ `decided_by_kind: "ai"` ที่ประกาศไว้ในสัญญา
 * มาเป็นสัปดาห์โดยไม่มีโค้ดเส้นไหนเขียนค่านั้นเลย
 *
 * ข้อนี้อยู่ใน frontmatter ของ vault เท่านั้น **ไม่ใช่การเสนอให้เพิ่มฟิลด์ใน contract 2**
 */
export const ACCESS_STATUSES = ["embedded", "confirmed", "unknown", "blocked"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export interface NoteSource {
  system: "ai-collaboration-mcp";
  workspace: string;
  /** ชนิดของระเบียนต้นทาง ไม่ใช่ชนิดของโน้ต — โน้ตหนึ่งใบประกอบจากหลายระเบียนได้ */
  kind: string;
  id: string | null;
  /** ระเบียนต้นทางขยับล่าสุดเมื่อไร — ใช้ตอบว่า vault เก่าไปหรือยัง */
  updated_at: string | null;
}

export interface NoteProvenance {
  exported_at: string;
  exporter: string;
  vault_schema: string;
  /** เลข contract ของ MCP ที่ผลลัพธ์ชุดนี้มาจาก — ถ้าเลขขยับ vault ต้องสร้างใหม่ */
  contract: number;
  derivation: Derivation;
  /** ระเบียนทุกใบที่ถูกใช้ประกอบโน้ตนี้ — ว่างได้เฉพาะโน้ต verbatim ที่มี source.id */
  built_from: string[];
}

export interface NoteFrontmatter {
  type: NoteType;
  title: string;
  source: NoteSource;
  /** ที่อยู่ของความจริง อ่านได้เฉพาะผู้ที่ต่อ MCP ได้ */
  canonical: string;
  /** สำเนาที่ผู้รับเปิดได้จริง — วันนี้ยังไม่มีที่เก็บกลาง จึงเป็น null เสมอ */
  accessible: string | null;
  access_status: AccessStatus;
  provenance: NoteProvenance;
  /** เขียนไว้ในทุกใบ เพราะกฎที่อยู่คนละที่กับของที่มันคุม คือกฎที่จะถูกอ่านข้าม */
  writeback: "forbidden";
}

export function canonicalUri(workspace: string, id: string | null): string {
  return id ? `mcp://${workspace}/${id}` : `mcp://${workspace}`;
}

/**
 * กฎว่าอะไรคือ "ความรู้ที่คงทน" — เขียนเป็นโค้ดเพื่อให้ตัดสินซ้ำได้เหมือนเดิมทุกครั้ง
 *
 * เส้นแบ่งของ v0.1 คือ **ระเบียนที่มีคนตั้งใจเขียนเป็นหลักฐาน** กับ **บทสนทนา**
 *
 *   เข้า vault คำต่อคำ   decision.detail · plan.body — มีผู้เขียน มีเวลา ตั้งใจให้อ้างอิง
 *   เข้าเป็นดัชนีเท่านั้น  ข้อความในกระทู้ · ใบงาน — เป็นสถานะสด ไม่ใช่ข้อสรุป
 *
 * เหตุผลที่ข้อความไม่เข้าแม้แต่บรรทัดแรก: กระทู้ของโต๊ะนี้พาดถึงงานที่มีข้อมูลสุขภาพ
 * (`pstack-thudong`) และเราไม่มีตัวตัดที่พิสูจน์ได้ว่าตัดครบ · **การไม่เอาเนื้อเลย
 * พิสูจน์ได้ ส่วนการตัดให้หมดพิสูจน์ไม่ได้** จึงเลือกอย่างแรกในรอบแรก
 *
 * ผลคือดัชนียังบอกได้ว่าต้องไปเปิด seq ไหน แต่ไม่มีเนื้อหลุดออกจากต้นทางเลย
 */

/** ใบตัดสินที่ยังไม่ถูกเคาะ ไม่ใช่ความรู้ที่คงทน — เป็นสถานะสดที่ยังอยู่ระหว่างตัดสิน */
export function isDurableDecision(d: { status: string; decided_at: string | null }): boolean {
  return d.decided_at !== null && d.status !== "proposed";
}

/** กติกาของทั้งโต๊ะ — ใบเดียวกับ decision แต่ผูกทั้ง workspace จึงแยกชนิดออกมา */
export function isStandingRule(d: { scope?: string; decided_at: string | null }): boolean {
  return d.scope === "workspace" && d.decided_at !== null;
}

/** กระทู้ที่ถือการออกแบบ แยกโฟลเดอร์เพื่อให้คนเข้าใหม่หาเจอโดยไม่ต้องรู้ชื่อกระทู้ */
export function isArchitecture(title: string): boolean {
  return /^\s*\[(ARCHITECTURE|SCAFFOLD|OPERATING MODEL)\]/i.test(title);
}

/** ชื่อทีมที่เป็น `owner/repository` ตาม dec-bcb9854f — ชื่ออื่นเป็นป้ายของ client */
export function isRepositoryName(name: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name);
}
