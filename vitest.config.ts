import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

/**
 * test รันในตัว runtime ของ Workers จริง และได้ D1 จริง (แยก storage ต่อ test)
 *
 * การ mock D1 จะพิสูจน์อะไรไม่ได้เลย เพราะความถูกต้องทั้งหมดของโปรเจกต์นี้อยู่ใน
 * SQL — โดยเฉพาะการออกเลข seq แบบ atomic และ UNIQUE ที่กันสองตัวโพสต์ชนกัน
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
