/**
 * ตัวช่วยที่ tool ทุกตัวใช้ร่วมกัน
 *
 * แยกออกมาเพื่อให้ tool ของ Phase 1 กับ Phase 2 ใช้กติกาเดียวกันจริง ๆ ไม่ใช่
 * เขียนคล้ายกันแล้วค่อย ๆ เพี้ยนออกจากกัน — โดยเฉพาะเพดานการอ่านและวิธีรายงาน
 * ความล้มเหลว
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { DEFAULT_WORKSPACE } from "./env";
import { RequestError } from "./db";

/**
 * เลข contract ของรูปผลลัพธ์ที่ tool คืน — จำนวนเต็ม ไม่ใช่ semver
 *
 * ตามกติกาที่ agent-platform ร่างไว้ใน ADR-0028 หลังเราชนปัญหาว่า server ตัวนี้เป็น
 * stateless จึงส่ง `notifications/tools/list_changed` ไม่ได้ ทางที่เหลือคือห้ามลบคีย์
 * ภายใน contract เดียวกัน แล้วให้เลขนี้เป็นเครื่องมือวินิจฉัย ไม่ใช่กลไกกันพัง
 *
 * ปรากฏสองที่ที่ถูก cache คนละแบบ — บรรทัดแรกของ description ทุก tool ซึ่งค้างอยู่ที่
 * client จนกว่ามันจะเชื่อมต่อใหม่ กับผลลัพธ์ของ `get_workspace_context` ซึ่งสร้างสด
 * ทุกครั้ง เลขสองที่ไม่ตรงกันเมื่อไหร่ แปลว่าผู้เรียกถือ schema เก่าอยู่และต้อง
 * reconnect ตรวจได้โดยไม่ต้องเชื่อคำกล่าวอ้างของใคร
 *
 * หน้าอ่านที่ `/view` แสดงเลขนี้ด้วยเพื่อให้คนเทียบกับที่ client ของตัวเองเห็นได้ แต่ไม่
 * นับเป็นที่ที่สาม เพราะสร้างสดจากค่านี้ตรง ๆ เหมือน `get_workspace_context` — ต้องอ่าน
 * จากตัวแปรนี้เสมอ เคยเขียนเป็นเลขตายตัวแล้วกลายเป็นสำเนาที่ขยับตามไม่ได้ ซึ่งจะโกหก
 * ใส่คนที่เปิดหน้ามาเพื่อไล่หาว่าเลขไม่ตรงกันตรงไหนพอดี
 *
 * 1 คือรูปก่อน 7 ก.ย. 2026 ที่ `waiting_for_you` มีคีย์ `handoffs` กับ `tasks`
 * 2 คือรูปปัจจุบันที่แยกเป็น `unaccepted` กับ `in_progress`
 *
 * ขยับเมื่อลบหรือเปลี่ยนความหมายของคีย์เดิมเท่านั้น การเพิ่มคีย์ใหม่ไม่ต้องขยับ
 */
export const CONTRACT_VERSION = 2;

/**
 * ลงทะเบียน tool พร้อมประกาศเลข contract ไว้บรรทัดแรกของ description
 *
 * ทำเป็น wrapper แทนการเขียนเลขไว้ในข้อความของแต่ละ tool เพราะ tool ตัวที่สิบหกที่
 * ใครจะเพิ่มทีหลังต้องได้เลขนี้โดยไม่ต้องจำ — กติกาที่ต้องอาศัยความจำคือกติกาที่จะถูก
 * ละเมิดโดยไม่มีใครรู้ตัว ซึ่งเป็นบทเรียนของสัปดาห์นี้ทั้งสัปดาห์
 *
 * ตำแหน่งตายตัวสำคัญกว่าถ้อยคำ — ผู้อ่านคือโมเดล การให้เทียบเลขสองตัวในตำแหน่งที่รู้
 * ล่วงหน้าแม่นกว่าการให้เทียบข้อความอิสระ
 */
export function registerTool<Schema extends z.ZodType>(
  server: McpServer,
  name: string,
  config: { description: string; inputSchema: Schema },
  handler: (args: z.infer<Schema>) => Promise<unknown>,
): void {
  const described = {
    ...config,
    description: `contract ${CONTRACT_VERSION}\n\n${config.description}`,
  };

  // cast จุดเดียวตรงนี้ เพราะ signature จริงของ registerTool เป็น generic ที่ infer
  // จาก schema — ห่อแล้ว TypeScript ตามต่อไม่ได้ ส่วน type ที่ผู้เรียกเห็นยังครบ
  // เพราะ `handler` ผูกกับ `Schema` ตัวเดียวกับ `inputSchema` ข้างบน
  (server.registerTool as (n: string, c: typeof described, h: typeof handler) => void)(
    name,
    described,
    handler,
  );
}

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

/**
 * เกณฑ์ความเงียบของกระทู้ — ไม่มีค่าเริ่มต้น เพราะ "เงียบ" ไม่เท่ากับ "จบแล้ว"
 *
 * การกรองต้องเป็นสิ่งที่ผู้เรียกขอ ไม่ใช่สิ่งที่ server ทำให้เงียบ ๆ ถ้า server กรอง
 * เองโดย default ค่า `discussions` เดิมจะเปลี่ยนความหมายจาก "ทั้งหมด" เป็น
 * "เฉพาะที่ยังเคลื่อนไหว" ซึ่งเป็นการเปลี่ยนความหมายของคีย์เดิม ไม่ใช่การเพิ่มคีย์
 * และจะลาก contract 3 มาโดยไม่ตั้งใจ — ตามที่ตกลงกันไว้ที่ dis-c6095786 seq 7 ข้อ D
 */
export const QuietForDays = z
  .number()
  .int()
  .min(1)
  .max(3650)
  .optional()
  .describe(
    "Optional. Hide discussions with no activity for this many days. " +
      "Omit to get every discussion, which is the default and the unchanged behaviour. " +
      "Whatever you pass, the result always reports how many were hidden.",
  );

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

/**
 * ข้อความที่ D1 คืนเมื่อยังไม่ได้สร้างตาราง
 *
 * เจอได้กับ deployment ใหม่ที่ขึ้น Worker แล้วแต่ยังไม่ได้รัน `schema.sql` เช่นตอน
 * `npm run db:remote` ล้มแล้วคนไม่ทันสังเกต ข้อความดิบของ D1 คือ `no such table: xxx`
 * ซึ่งบอกไม่ได้เลยว่าต้องทำอะไรต่อ คนที่เพิ่ง deploy ครั้งแรกจะนึกว่าโค้ดพัง
 *
 * แปลเป็นคำสั่งที่รันได้ตรง ๆ แทน ด้วยเหตุผลเดียวกับที่ `/mcp` บอกวิธีตั้ง
 * `MCP_AUTH_TOKEN` เมื่อยังไม่ได้ตั้ง — ล้มเหลวแบบมีเสียงและบอกทางออก
 */
const NO_TABLE = /no such table/i;

/** ยังไม่ได้สร้างตารางหรือไม่ — ดูจากข้อความของ D1 เพราะไม่มีรหัสข้อผิดพลาดให้จับ */
function schemaMissing(error: unknown): boolean {
  return error instanceof Error && NO_TABLE.test(error.message);
}

export async function run(fn: () => Promise<unknown>) {
  try {
    return formatResult(await fn());
  } catch (error) {
    if (error instanceof RequestError) return formatError(error);

    if (schemaMissing(error)) {
      console.error("schema not applied", error);
      return formatError(
        new Error(
          "ฐานข้อมูลยังไม่มีตาราง — Worker ขึ้นแล้วแต่ยังไม่ได้รัน schema " +
            "สั่ง `npm run db:remote` (เท่ากับ `wrangler d1 execute DB --remote --file schema.sql`) " +
            "แล้วเรียกใหม่ · คำสั่งนี้รันซ้ำได้ ไม่ลบข้อมูลเดิม",
        ),
      );
    }

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
/**
 * ใครลงมือ เทียบกับใครที่บันทึกระบุ
 *
 * โต๊ะนี้มีเคสจริงแล้วสี่ครั้งที่ผู้ลงมือไม่ใช่ผู้ที่ใบจ่าหน้าถึง — ใบที่ส่งถึงทีมหนึ่ง
 * แต่อีกทีมกดรับ ใบที่ส่งถึงทีมหนึ่งแต่อีกทีมส่งมอบของจริง และใบที่ส่งถึงคนแต่ทีมแก้
 * สถานะให้ตามคำสั่ง ทุกครั้งไม่มีอะไรผิด แต่บันทึกอ่านแล้วเหมือนผู้ที่ถูกระบุเป็นคนทำ
 *
 * **ไม่ห้าม** เพราะการรับแทนและส่งมอบแทนเป็นเรื่องปกติที่ต้องทำได้ ถ้าห้าม งานที่
 * เสร็จแล้วจะไม่มีใครปิดได้ และงานที่ไซต์จะไม่เดิน — รายงานอย่างเดียว
 *
 * **มีเสมอไม่ว่าจะตรงหรือไม่ตรง** ด้วยเหตุผลเดียวกับที่ `create_task` คืนฟิลด์
 * `handoff` เป็น null เสมอ คือผู้อ่านต้องมองผ่านค่าที่บอกว่าไม่มี ไม่ใช่สรุปจาก
 * การที่ไม่มีฟิลด์ · ฟิลด์ที่โผล่เฉพาะตอนผิดปกติ จะถูกมองข้ามตอนที่มันโผล่
 */
export function actedAs(
  addressedTo: string | null | undefined,
  actedBy: string | null | undefined,
): {
  addressed_to: string | null;
  acted_by: string | null;
  delegated: boolean;
  note?: string;
} {
  const addressed =
    typeof addressedTo === "string" && addressedTo.trim() !== "" ? addressedTo : null;
  const actor = typeof actedBy === "string" && actedBy.trim() !== "" ? actedBy : null;

  // ไม่มีผู้ถูกระบุ ก็ไม่มีอะไรให้เทียบ — ต่างจากกรณีที่มีแล้วตรงกัน และผู้อ่าน
  // แยกสองกรณีนี้ออกได้จาก `addressed_to` ที่อยู่ในผลลัพธ์เดียวกัน
  const delegated = addressed !== null && actor !== null && addressed !== actor;

  return {
    addressed_to: addressed,
    acted_by: actor,
    delegated,
    ...(delegated
      ? {
          note:
            `The record names '${addressed}' but '${actor}' did this. That is allowed — ` +
            "work is often picked up or finished by someone the ticket did not name. " +
            "It is reported so the record is not read as if the named party acted.",
        }
      : {}),
  };
}

export function handoffReminder(assignedTo: string | null | undefined): string | undefined {
  if (typeof assignedTo !== "string" || assignedTo.trim() === "") return undefined;

  return (
    `Assigned to '${assignedTo}', but no handoff was created. They will not see ` +
    "this task in get_handoffs and have no context about what is already done or " +
    "what is left. If you meant to hand work over, call create_handoff."
  );
}
