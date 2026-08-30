import { env } from "cloudflare:test";
import schemaSql from "../schema.sql?raw";

/**
 * สร้างตารางให้ D1 ของ test แต่ละไฟล์
 *
 * ใช้ `schema.sql` ตัวจริงแทนการเขียน DDL ซ้ำใน test เพื่อไม่ให้ทั้งสองที่เพี้ยน
 * จากกันได้ — ถ้า schema เปลี่ยนแล้วลืมแก้ test จะพังทันที แทนที่จะผ่านทั้งที่
 * ทดสอบคนละโครงสร้างกับของจริง
 *
 * ฝังเนื้อไฟล์ตอน build ด้วย `?raw` เพราะ test รันในตัว runtime ของ Workers
 * ซึ่งอ่าน filesystem ไม่ได้
 */
export async function applySchema(): Promise<void> {
  const statements = schemaSql
    .split(";")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
}

/**
 * ล้างข้อมูลก่อนทุก test
 *
 * storage ไม่ได้ถูกล้างให้อัตโนมัติระหว่าง test ในไฟล์เดียวกัน — เจอตอนที่ test
 * นับกระทู้ได้ 17 แทนที่จะเป็น 4 เพราะของจาก test ก่อนหน้าค้างอยู่ ถ้าไม่ล้างเอง
 * ผลของ test จะขึ้นกับลำดับการรัน ซึ่งพังเงียบเมื่อมีคนเพิ่ม test ใหม่แทรกกลาง
 *
 * **ลำดับสำคัญ** ต้องลบจากตารางที่อ้างถึงคนอื่น ไปหาตารางที่ถูกอ้าง ไม่งั้นติด
 * foreign key — เจอมาแล้วตอนเพิ่มตารางของ Phase 2 ซึ่งทำให้ test เดิมพังทั้งไฟล์
 * ถ้าเพิ่มตารางใหม่ที่มี REFERENCES ต้องเติมไว้ **ก่อน** ตารางที่มันอ้างถึง
 */
const TABLES_CHILD_FIRST = [
  "handoffs",   // → tasks
  "plans",      // → workspaces, discussions, decisions, plans
  "tasks",      // → workspaces, discussions
  "decisions",  // → workspaces, discussions
  "messages",   // → discussions
  "discussions",// → workspaces
  "workspaces",
] as const;

export async function resetDatabase(): Promise<void> {
  await applySchema();
  for (const table of TABLES_CHILD_FIRST) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await applySchema();
}
