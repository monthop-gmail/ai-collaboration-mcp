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

/**
 * เตือนว่าการตั้งผู้รับผิดชอบไม่ใช่การส่งต่องาน
 *
 * ทั้งสองอย่างชอบธรรมคนละแบบ — บางงานรู้เจ้าของตั้งแต่แรก แต่ปลายทางจะไม่เห็นงาน
 * ใน `get_handoffs` และไม่มีบริบทว่าต้องทำอะไรต่อ
 *
 * มีข้อความนี้เพราะเจอจริง: ChatGPT ถูกสั่งให้ "สร้าง task ส่งต่อให้ Gemini" แล้วมัน
 * ใส่ `assigned_to` ตอนสร้าง จากนั้นรายงานว่าส่งต่อแล้ว ทั้งที่ไม่มี handoff อยู่เลย
 * — ตรวจจาก `updated_by` ที่ยังเป็น null จึงรู้ว่า `create_handoff` ไม่เคยถูกเรียก
 *
 * server ห้ามไม่ได้ว่า agent จะทำอะไร แต่คืนความจริงให้มันอ่านได้ เพื่อไม่ให้เล่าสิ่งที่
 * ไม่ได้เกิดขึ้น — หลักการเดียวกับการอ่าน record กลับมาหลังเขียน
 */
export function handoffReminder(assignedTo: string | null | undefined): string | undefined {
  if (typeof assignedTo !== "string" || assignedTo.trim() === "") return undefined;

  return (
    `Assigned to '${assignedTo}', but no handoff was created. They will not see ` +
    "this task in get_handoffs and have no context about what is already done or " +
    "what is left. If you meant to hand work over, call create_handoff."
  );
}
