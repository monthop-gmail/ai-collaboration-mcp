/**
 * Vite แปลง `?raw` เป็นสตริง ทำให้ไฟล์ตั้งค่าถูกฝังตอน build แทนการอ่านไฟล์
 *
 * จำเป็นเพราะเทสต์รันในตัวรันไทม์ของ Workers ซึ่งอ่าน filesystem ไม่ได้ —
 * เหตุผลเดียวกับ `*.sql?raw` ที่ `apply-schema.ts` ใช้กับ `schema.sql`
 */
declare module "*.jsonc?raw" {
  const content: string;
  export default content;
}
