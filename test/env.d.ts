/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * binding ที่ `env` ของ `cloudflare:test` จะมีให้
 *
 * เขียนเองแทนการ generate ด้วย `wrangler types` เพราะไฟล์ที่ generate มามีหมื่น
 * กว่าบรรทัดซึ่งไม่มีใครรีวิว ส่วนที่นี่ต้องการจริง ๆ มีอันเดียว ถ้าเพิ่ม binding
 * ใน wrangler.jsonc แล้วลืมเติมตรงนี้ test จะฟ้องตอน typecheck
 */
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    OAUTH_KV: KVNamespace;
  }
}
