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
   * โทเค็นหลายใบที่ผูกชื่อไว้กับแต่ละใบ รูปแบบ `token=ชื่อ` คั่นด้วย comma
   *
   * มีเพราะเส้น static bearer เดิมรองรับโทเค็นเดียวและชื่อเดียว ทุก client ที่เข้ามา
   * ทางนั้นโดยไม่ส่ง `X-Client-Name` จึงได้ป้ายเดียวกันหมด — เจอจริงตอน Codex ต่อเข้ามา
   * แล้วถูกบันทึกเป็น `Claude Code` ของ deployment นี้
   *
   * ชื่อจากโทเค็นชนะชื่อจาก header เพราะผู้ถือโทเค็นเลือกชื่อเองไม่ได้ แต่ยัง **ไม่ใช่
   * การพิสูจน์ตัวตน** — โทเค็นส่งต่อกันได้ ใครถือใบของ Codex ก็เป็น Codex ทันที
   * ระดับที่พิสูจน์ได้จริงมีทางเดียวคือ OAuth ซึ่งตัวตนมาจาก props ที่ client แก้ไม่ได้
   */
  MCP_AUTH_TOKENS?: string;
  /**
   * แก้ชื่อที่แสดง เมื่อชื่อที่ค่ายส่งมาตอน DCR ไม่ตรงกับชื่อที่คนเรียกกัน
   * รูปแบบ `ชื่อที่ส่งมา=ชื่อที่จะแสดง` คั่นด้วย comma เช่น `Google=Gemini`
   */
  CLIENT_NAME_ALIASES?: string;
  /**
   * รหัสที่พิสูจน์ว่าคนอยู่ตรงนั้นจริงตอนปิด decision
   *
   * แยกจาก `MCP_AUTH_TOKEN` โดยตั้งใจ และ **ห้ามใส่ในเครื่องมือของ client ตัวไหน**
   * — ค่านี้มีความหมายก็ต่อเมื่อมีแต่คนเท่านั้นที่รู้ ถ้าไม่ตั้งไว้ ทุกการปิดจะถูก
   * บันทึกเป็น `relayed` ซึ่งใช้งานได้ปกติ เพียงแต่ยืนยันไม่ได้
   */
  APPROVAL_SECRET?: string;
  /** hostname ที่ยอมให้ browser เรียก /mcp ได้ */
  ALLOWED_ORIGIN_HOSTNAMES?: string;
  /**
   * รหัสของหน้าอ่านอย่างเดียวที่ `/view`
   *
   * แยกจาก `MCP_AUTH_TOKEN` โดยตั้งใจ เพราะรหัสของ MCP เขียนลงโต๊ะได้ ส่วนรหัสนี้
   * อ่านได้อย่างเดียว ลิงก์ที่หลุดไปจึงเสียหายคนละระดับ ไม่ตั้งค่า = ไม่มีหน้านั้น
   */
  VIEW_TOKEN?: string;
}

/** PoC ใช้ workspace เดียว แต่ schema รองรับหลายอันแล้ว */
export const DEFAULT_WORKSPACE = "ws-001";
