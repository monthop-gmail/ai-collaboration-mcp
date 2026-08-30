/**
 * ตัวช่วยที่ tool ทุกตัวใช้ร่วมกัน
 *
 * แยกออกมาเพื่อให้ tool ของ Phase 1 กับ Phase 2 ใช้กติกาเดียวกันจริง ๆ ไม่ใช่
 * เขียนคล้ายกันแล้วค่อย ๆ เพี้ยนออกจากกัน — โดยเฉพาะเพดานการอ่านและวิธีรายงาน
 * ความล้มเหลว
 */

import { z } from "zod";
import { DEFAULT_WORKSPACE } from "./env";
import { RequestError } from "./db";

/**
 * เพดานเริ่มต้นตอนอ่าน
 *
 * กระทู้ที่ AI สามตัวคุยกันโตเร็วกว่าที่คิด การคืนทั้งหมดโดยไม่มีเพดานจะกิน
 * context ของผู้เรียกจนหมดก่อนที่จะมีใคร error
 */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export const Workspace = z
  .string()
  .default(DEFAULT_WORKSPACE)
  .describe(`Workspace id. Defaults to '${DEFAULT_WORKSPACE}'.`);

export const Limit = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT)
  .describe(`Maximum rows to return (1-${MAX_LIMIT}).`);

export function formatResult(result: unknown) {
  const text =
    typeof result === "string" ? result : JSON.stringify(result, null, 2) ?? String(result);
  return { content: [{ type: "text" as const, text }] };
}

/**
 * ส่งความล้มเหลวกลับเป็น tool error ไม่ใช่ transport error เพื่อให้ model อ่าน
 * ข้อความแล้วแก้เองได้ เช่นใส่ id ผิดหรืออ้าง seq ที่ไม่มี
 */
export function formatError(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
  };
}

export async function run(fn: () => Promise<unknown>) {
  try {
    return formatResult(await fn());
  } catch (error) {
    if (error instanceof RequestError) return formatError(error);
    // ข้อผิดพลาดที่ไม่ได้เกิดจากคำขอ ต้องเห็นใน log ไม่ใช่กลืนหาย
    console.error("tool failed", error);
    return formatError(error);
  }
}
