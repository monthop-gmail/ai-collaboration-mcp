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
 * ลบตามลำดับการอ้างอิง: message → discussion → workspace
 */
export async function resetDatabase(): Promise<void> {
  await applySchema();
  await env.DB.prepare("DELETE FROM messages").run();
  await env.DB.prepare("DELETE FROM discussions").run();
  await env.DB.prepare("DELETE FROM workspaces").run();
  await applySchema();
}
