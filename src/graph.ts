/**
 * ความสัมพันธ์ที่ Contract 2 มีอยู่จริง — **นิยามเดียวของทั้งโปรเจกต์**
 *
 * ตารางนี้ย้ายมาจาก `scripts/context-graph.mjs` ซึ่งเป็นที่ที่มันเกิด · สคริปต์นั้น
 * เป็น node script ที่เรียก `wrangler` จึง import ไฟล์นี้ไม่ได้ และยังถือสำเนาของตัวเองอยู่
 * **`test/graph.test.ts` จึงอ่านสองไฟล์มาเทียบกัน แล้วแดงถ้าเพี้ยนจากกัน** — สำเนา
 * ที่ไม่มีใครเทียบคือสำเนาที่จะต่างกันเมื่อไรก็ได้ และนั่นคือรูปที่ `CLAUDE.md` ไล่ปิด
 *
 * ## ทุกเส้นมาจากฟิลด์ที่สัญญาเปิดให้ผู้บริโภคอ่าน
 *
 * `tool` ระบุว่าฟิลด์นั้นคืนจาก tool ตัวไหน ตรวจสวนได้ว่าไม่มีเส้นไหนมาจากคอลัมน์ภายใน
 * ที่ผู้บริโภคมองไม่เห็น · **กราฟที่เดินบนคอลัมน์ที่ไม่มีใครอ่านได้ คือกราฟที่ทีมอื่น
 * ทำซ้ำไม่ได้**
 *
 * `kind: "field"` คือความสัมพันธ์ที่มีฟิลด์รองรับจริง — เดินได้
 * `kind: "text"`  คือที่ต้องแกะจากข้อความอิสระ — **พิสูจน์ไม่ได้ว่าถูก**
 */
export interface GraphEdge {
  from: string;
  field: string;
  to: string;
  tool: string;
  kind: "field" | "text";
}

export const EDGES: readonly GraphEdge[] = [
  { from: "task", field: "discussion_id", to: "discussion", tool: "get_tasks", kind: "field" },
  {
    from: "decision",
    field: "discussion_id",
    to: "discussion",
    tool: "get_decisions",
    kind: "field",
  },
  {
    from: "decision",
    field: "superseded_by",
    to: "decision",
    tool: "get_decisions",
    kind: "field",
  },
  { from: "plan", field: "discussion_id", to: "discussion", tool: "get_plans", kind: "field" },
  { from: "plan", field: "decision_id", to: "decision", tool: "get_plans", kind: "field" },
  { from: "plan", field: "supersedes", to: "plan", tool: "get_plans", kind: "field" },
  { from: "handoff", field: "task_id", to: "task", tool: "get_handoffs", kind: "field" },
  { from: "task", field: "result_ref", to: "*", tool: "get_tasks", kind: "text" },
] as const;

/**
 * ความสัมพันธ์ที่ทีมพูดถึงกันบนโต๊ะ แต่ **ไม่มีฟิลด์รองรับ**
 *
 * ทุกข้อในนี้วันนี้อยู่ในร้อยแก้วเท่านั้น · กราฟจึงเดินข้ามไม่ได้ และการเดาเส้นพวกนี้
 * จากข้อความคือการสร้างความสัมพันธ์ที่หลักฐานพิสูจน์ไม่ได้
 *
 * **หน้ากราฟต้องวาดข้อพวกนี้ให้เห็นว่าไม่มี ไม่ใช่ละไว้** — กราฟที่วาดแต่เส้นที่มี
 * จะอ่านเหมือนว่าความสัมพันธ์ทั้งหมดที่โต๊ะต้องการมีครบแล้ว ซึ่งไม่จริง และเป็นข้อ
 * เดียวกับกฎ `absent ≠ empty` ที่ใช้กับผลของ tool ทุกตัว
 */
export const MISSING: readonly (readonly [string, string])[] = [
  ["decision → task", "ใบที่ตัดสินแล้วสั่งให้เกิดงาน ไม่มีเส้นไปหางานนั้น"],
  ["plan → task", "แผนไม่มีเส้นไปหางานที่แผนสั่ง"],
  ["task → task", "ไม่มีทั้ง dependency และ supersedes — โซ่ของตัวขวางมองไม่เห็น"],
  ["task → decision", "งานที่ทำตามใบตัดสิน ไม่มีเส้นย้อนกลับ"],
  ["evidence", "ไม่ใช่ entity — มีแต่ result_ref ซึ่งเป็นข้อความอิสระ"],
] as const;
