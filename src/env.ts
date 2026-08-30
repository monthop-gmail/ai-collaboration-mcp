/** binding และ secret ที่ Worker ตัวนี้ใช้ */
export interface Env {
  /** D1 ที่เก็บ workspace / discussion / message */
  DB: D1Database;
  /** KV ที่ OAuth provider ใช้เก็บ client ที่ลงทะเบียน grant และ token */
  OAUTH_KV: KVNamespace;
  /** bearer token สำหรับ client ที่ตั้ง header เองได้ และเป็นรหัสบนหน้า consent */
  MCP_AUTH_TOKEN?: string;
  /** ชื่อที่จะใช้เมื่อเข้ามาทางเส้น static bearer ซึ่งไม่มี identity จาก OAuth */
  STATIC_CLIENT_NAME?: string;
  /**
   * แก้ชื่อที่แสดง เมื่อชื่อที่ค่ายส่งมาตอน DCR ไม่ตรงกับชื่อที่คนเรียกกัน
   * รูปแบบ `ชื่อที่ส่งมา=ชื่อที่จะแสดง` คั่นด้วย comma เช่น `Google=Gemini`
   */
  CLIENT_NAME_ALIASES?: string;
  /** hostname ที่ยอมให้ browser เรียก /mcp ได้ */
  ALLOWED_ORIGIN_HOSTNAMES?: string;
}

/** PoC ใช้ workspace เดียว แต่ schema รองรับหลายอันแล้ว */
export const DEFAULT_WORKSPACE = "ws-001";
