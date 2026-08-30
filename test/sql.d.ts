/** Vite แปลง `?raw` เป็นสตริง ทำให้ schema.sql ถูกฝังตอน build แทนการอ่านไฟล์ */
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
