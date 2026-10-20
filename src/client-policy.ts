/**
 * นโยบายจำกัดสิทธิ์ราย client — ด่านฝั่ง server ที่ผูกกับ OAuth `client_id`
 *
 * อนุมัติโดย `dec-f213c339` (approved + human 20 ต.ค. 2026) ตามข้อเสนอที่
 * `dis-683004a2` #20–#21 และข้อแก้ข้อเท็จจริงที่ #24 · ลูกค้ารายแรกคือ
 * `Orchestrator Bot` ซึ่งต้องเดินงานแทน session ที่มีคนนั่ง โดยไม่ได้สิทธิ์เต็มชุด ·
 * โหมด live (เขียน task/handoff ได้เฉพาะของตัวเอง) อนุมัติโดย `dec-020d7bb3`
 * (`dis-683004a2#75`)
 *
 * ## ทำไมนโยบายอยู่ในซอร์ส ไม่ใช่ใน D1
 *
 * `workspace` ไม่ใช่ขอบเขตความปลอดภัย และไม่มี ACL ระดับแถว ⇒ ใครถือโทเคนก็แก้
 * แถวใน D1 ได้ · ถ้านโยบายอยู่ใน D1 **บอตที่ถูกจำกัดจะแก้ใบอนุญาตของตัวเองได้**
 * ซึ่งทำให้ด่านไม่ใช่ด่าน · ไฟล์นี้เปลี่ยนได้ด้วย deploy เท่านั้น เป็นรูปเดียวกับที่
 * `ecosystem-brief` ใช้กับ `.github/class-a-pilot.json` ที่ห้ามอยู่ใน allowlist ของตัวเอง
 *
 * ## opt-in ไม่ใช่ deny ทั้งระบบ
 *
 * **client ที่ไม่อยู่ในรายการนี้ใช้งานได้เหมือนวันนี้ทุกอย่าง** · deny-by-default มีผล
 * เฉพาะภายในรายของ client ที่ถูกระบุ · ถ้าทำกลับกัน `* Bot` ห้าตัว · ChatGPT · Grok ·
 * Cursor จะหยุดพร้อมกันทันทีที่ deploy — เทสต์ `ไม่อยู่ในนโยบายได้ทุก tool` มีไว้
 * กันข้อนี้โดยเฉพาะ และเป็นกรณีบวกที่ห้ามหายไปจากชุดเทสต์
 *
 * ## ชื่อใช้จับคลาส ไม่ใช่ใช้ยืนยันตัวตน
 *
 * `client_id` ออกใหม่ทุกครั้งที่ลงทะเบียน DCR ใหม่ (ChatGPT เคยมี 6 ใบ · Grok 4 ·
 * Cursor 2) — **ไม่ใช่ทุกครั้งที่ refresh และไม่ใช่ตอน consent ซ้ำด้วย client เดิม**
 * (แก้ข้อเท็จจริงที่ `dis-683004a2#24`) · ถ้าผูกด้วย id อย่างเดียว วันที่บอตลงทะเบียน
 * ใหม่มันจะหลุดออกจากนโยบายแล้วได้สิทธิ์เต็ม **โดยไม่มีอะไรฟ้อง** ซึ่งอันตรายกว่าหยุด
 *
 * จึงจับด้วยชื่อร่วมด้วย: ชื่อตรงคลาสที่ถูกจำกัดแต่ id ไม่อยู่ในรายการ → **ปฏิเสธ**
 * ทิศของการพลาดถูกต้อง — ลงทะเบียนใหม่แล้วบอตหยุดและมีคนต้องมาเติม id ดังและแก้ได้
 * ส่วนชื่อนั้น `client` ประกาศเองตอน DCR และฮับบันทึกดิบ (`dis-5278734d#12`) จึง
 * **ไม่ใช่การพิสูจน์ตัวตน** ใช้เป็นตัวจับว่าใบนี้อยู่ในคลาสที่ต้องถูกจำกัดเท่านั้น
 */

/** ชื่อ tool ที่นโยบายหนึ่งใบอนุญาต พร้อมข้อจำกัดระดับ argument ถ้ามี */
export interface ClientPolicy {
  /** `client_id` ที่ออกให้ตอนลงทะเบียน DCR — ตัวที่นโยบายนี้ใช้กับมัน */
  readonly client_id: string;
  /**
   * `client_id` ใบอื่นของ client เชิงตรรกะเดียวกัน (เช่นหลังลงทะเบียน DCR ใหม่)
   *
   * `resolvePolicy` และการตรวจเจ้าของ task ใช้ **เซตเดียวกัน** คือ `client_id ∪ also_ids`
   * (`policyIds()`) — ใบใหม่จึงแก้ task ที่สร้างด้วยใบเก่าได้ · ต้องเป็น list เสมอ
   * แม้ว่าง (`dec-020d7bb3` ข้อ 1)
   */
  readonly also_ids: readonly string[];
  /**
   * ชื่อที่ client ประกาศตอน DCR — ใช้จับคลาส ไม่ใช่ยืนยันตัวตน
   *
   * ชื่อนี้ตรงแต่ `client_id` ไม่ตรง = ปฏิเสธ ไม่ใช่ปล่อยผ่าน · และ **ไม่มี fallback**
   * จากชื่อหรือ header ไปหานโยบาย — ชื่อทำได้อย่างเดียวคือทำให้ถูกปฏิเสธ
   */
  readonly client_name: string;
  /** tool ที่เรียกได้ · ที่ไม่อยู่ในนี้ถูก disable และปฏิเสธเมื่อเรียกตรง */
  readonly tools: readonly string[];
  /**
   * allowlist ของกระทู้ — คงที่ต่อ deploy
   *
   * ใช้กับ `post_message` (ปลายทาง) · `create_task` (`discussion_id`) · และเป็น
   * allowlist *ปัจจุบัน* ที่ `create_handoff`/`update_task` ใช้ตรวจกระทู้ของ task ที่จะแตะ —
   * task ที่สร้างไว้ตอนกระทู้ยังอยู่ในรายการ แต่วันนี้ถูกถอดออกแล้ว **แตะไม่ได้**
   *
   * ว่าง = ทำอะไรไม่ได้เลย ไม่ใช่ทำได้ทุกกระทู้
   */
  readonly discussions: readonly string[];
  /** ชื่อ worker ที่ `create_task.assigned_to` และ `create_handoff.to` ชี้ไปได้ */
  readonly workers: readonly string[];
  /** workspace เดียวที่ `create_task` เขียนลงได้ — ละได้ (ค่าตั้งต้นคือค่านี้พอดี) แต่ระบุอื่นไม่ได้ */
  readonly workspace: string;
}

/**
 * รายการนโยบายทั้งหมด — เพิ่มได้เฉพาะที่มีใบตัดสินรองรับ
 *
 * ของแรกและของเดียววันนี้: `Orchestrator Bot` · ห้า tool อ่านตาม `dec-f213c339` ข้อ 5
 * (Codex ระบุเองที่ `dis-683004a2#23`) · สี่ tool เขียนตาม `dec-020d7bb3` ข้อ 2 ซึ่ง
 * ทุกตัวถูกคุมด้วยตาราง `ARGUMENT_RULES` ข้างล่าง ไม่ใช่เปิดเปล่า ๆ
 *
 * ไม่มี `create_discussion` · `accept_handoff` · กลุ่ม decision/plan — จำกัดด้วย
 * argument ไม่ได้ หรือไม่อยู่ในใบตัดสิน
 */
export const CLIENT_POLICIES: readonly ClientPolicy[] = [
  {
    client_id: "WL3lHS7PwXbT3a6N",
    also_ids: [],
    client_name: "Orchestrator Bot",
    tools: [
      "get_tasks",
      "get_handoffs",
      "get_discussion",
      "get_decisions",
      "get_workspace_context",
      "post_message",
      "create_task",
      "create_handoff",
      "update_task",
    ],
    discussions: [
      "dis-763ed26c-0f27-4d95-ba9f-939d4c41ebb3", // notify
      "dis-70b78bd9-5bd5-44af-8fd6-81a8ff2fd610", // s1
      "dis-a56d8e9e-cee9-485d-8749-3ca227c96920", // s2
    ],
    workers: ["Claude Code Bot"],
    workspace: "ws-001",
  },
];

/** เซต id ของ client เชิงตรรกะ — ใช้ทั้งตอนหานโยบายและตอนตรวจเจ้าของ task */
export function policyIds(policy: ClientPolicy): readonly string[] {
  return [policy.client_id, ...policy.also_ids];
}

/**
 * ผลของการหานโยบาย — สามค่า ไม่ใช่สอง
 *
 * `"unrestricted"` กับ `"denied"` ต่างกันคนละขั้ว และ **ห้ามยุบเป็น "ไม่มีนโยบาย"
 * ค่าเดียว** · ถ้ายุบ กรณีชื่อตรงแต่ id ไม่ตรงจะกลายเป็น "ไม่อยู่ในรายการ" ซึ่งแปลว่า
 * ได้สิทธิ์เต็ม — ตรงข้ามกับที่ใบตัดสินสั่งไว้
 */
export type PolicyDecision =
  | { readonly kind: "unrestricted" }
  | { readonly kind: "restricted"; readonly policy: ClientPolicy }
  | { readonly kind: "denied"; readonly reason: string };

/**
 * นโยบายของผู้เรียกรายนี้
 *
 * ลำดับสำคัญ — เทียบ `client_id ∪ also_ids` ก่อน ถ้าตรงใช้นโยบายนั้นเลยโดยไม่ดูชื่อ
 * เพราะ `client_id` คือตัวตนที่ผนึกมาในโทเคนและ client แก้ไม่ได้ ส่วนชื่อเป็นคำประกาศ
 *
 * @param clientId   `client_id` จาก props ที่ผนึกไว้ในโทเคน (OAuth เท่านั้น)
 * @param clientName ชื่อที่ประกาศตอน DCR
 */
export function resolvePolicy(
  clientId: string | undefined,
  clientName: string | undefined,
  policies: readonly ClientPolicy[] = CLIENT_POLICIES,
): PolicyDecision {
  // เส้นที่ไม่ใช่ OAuth ไม่มี client_id ที่ผนึกมา จึงไม่เคยอยู่ในนโยบาย —
  // นโยบายนี้ผูกกับ OAuth โดยเจตนา ตาม dec-f213c339 ข้อ 4
  if (clientId) {
    const byId = policies.find((entry) => policyIds(entry).includes(clientId));
    if (byId) return { kind: "restricted", policy: byId };
  }

  // ชื่อตรงคลาสที่ถูกจำกัด แต่ id ไม่อยู่ในรายการ = fail-closed
  //
  // เกิดเมื่อ client ลงทะเบียน DCR ใหม่แล้วได้ id ใหม่ · ปล่อยผ่านคือข้อจำกัดหลุด
  // เงียบ ๆ ซึ่งอันตรายกว่าบอตหยุด
  if (clientName) {
    const byName = policies.find((entry) => entry.client_name === clientName);
    if (byName) {
      return {
        kind: "denied",
        reason:
          `ชื่อ '${clientName}' อยู่ในคลาสที่มีนโยบายจำกัดสิทธิ์ แต่ client_id ที่ใช้เรียก` +
          "ไม่อยู่ในนโยบาย — ปฏิเสธไว้ก่อน (fail-closed) · เกิดเมื่อลงทะเบียน DCR ใหม่" +
          "แล้วได้ client_id ใหม่ · ผู้ดูแลต้องเติม client_id ใหม่เข้า also_ids ของนโยบายใน " +
          "src/client-policy.ts แล้ว deploy ก่อนใช้งานต่อ",
      };
    }
  }

  return { kind: "unrestricted" };
}

/**
 * รายชื่อ tool ที่ต้องเปิดไว้สำหรับผู้เรียกรายนี้ หรือ `undefined` ถ้าไม่ต้องกรอง
 *
 * `denied` คืนรายการว่าง ไม่ใช่ `undefined` — ว่างแปลว่าปิดทุกตัว ส่วน `undefined`
 * แปลว่าไม่กรองเลย สองค่านี้ตรงข้ามกันและเคยสลับกันแล้วไม่มีอะไรฟ้อง
 */
export function allowedToolsFor(decision: PolicyDecision): readonly string[] | undefined {
  switch (decision.kind) {
    case "restricted":
      return decision.policy.tools;
    case "denied":
      return [];
    case "unrestricted":
      return undefined;
  }
}

/**
 * allowlist ที่มีผลจริง เมื่อผู้เรียกอยู่บนเส้นที่มีรายการของตัวเองด้วย
 *
 * ใช้ **ส่วนร่วม** ของสองรายการ ไม่ใช่ของนโยบายอย่างเดียว — ถ้าเอาของนโยบายทับ
 * ไปเลย client ที่ถูกจำกัดและเข้าทางเส้น read-only จะได้ tool เขียนคืนมา ซึ่งเป็น
 * การเปิดสิทธิ์โดยไม่มีใครสั่ง
 *
 * วันนี้กรณีนี้เกิดไม่ได้ เพราะนโยบายผูกกับ OAuth และเส้น read-only ไม่ผูกกับ OAuth
 * provider · แยกเป็นฟังก์ชันบริสุทธิ์เพื่อให้ **ทดสอบได้ตรง ๆ** ตามที่ mentor ขอไว้ที่
 * `dis-683004a2#49` ข้อ F2 — ของที่ทดสอบไม่ได้คือของที่ไม่มีใครรู้ว่าพังเมื่อไหร่
 *
 * @param readOnlyTools รายการของเส้นที่ผู้เรียกอยู่ · `undefined` = ไม่ได้อยู่บนเส้นนั้น
 */
export function effectiveAllowlist(
  decision: PolicyDecision,
  readOnlyTools?: readonly string[],
): readonly string[] | undefined {
  const allow = allowedToolsFor(decision);
  if (!allow || !readOnlyTools) return allow;
  return allow.filter((name) => readOnlyTools.includes(name));
}

/** คำปฏิเสธ (string) หรือผ่าน (`undefined`) */
type Refusal = string | undefined;
type Rule = (policy: ClientPolicy, args: Record<string, unknown>, db: D1Database) => Promise<Refusal>;

/**
 * คิวรีเดียวที่ด่านนี้ยิงเพิ่ม — export เพื่อให้เทสต์ยืนยันได้ว่า **ไม่ถูกยิง**
 * สำหรับ client ที่ไม่ถูกจำกัด (`dec-020d7bb3` ข้อ 8: ต้นทุนศูนย์สำหรับคนที่ไม่เกี่ยว)
 */
export const OWNERSHIP_SQL =
  "SELECT created_by_client, discussion_id FROM tasks WHERE id = ?1 /* client-policy ownership */";

/**
 * ข้อความเดียวสำหรับ "ไม่มี task นี้" และ "มีแต่ไม่ใช่ของ client นี้" (ข้อ 6) —
 * ถ้าแยกข้อความ client ที่ถูกจำกัดจะใช้มันไล่สแกนว่า task id ไหนมีจริงได้
 */
function notOwnedRefusal(taskId: string): string {
  return (
    `task '${taskId}' ไม่พบ หรือไม่ได้สร้างโดย client นี้ — client นี้แก้หรือส่งต่อได้` +
    "เฉพาะ task ที่ตัวเองสร้าง (ตรวจจาก created_by_client)"
  );
}

/**
 * ด่านระดับแถว — task ต้องสร้างโดย id ในเซตของ client นี้ **และ** อยู่ในกระทู้ที่อยู่ใน
 * allowlist *ปัจจุบัน*
 *
 * อ่าน D1 หนึ่งครั้ง · ถ้าอ่านไม่ได้ (D1 โยน error) → ปฏิเสธ ไม่ใช่ปล่อย (ข้อ 7) —
 * ด่านที่ล้มแล้วเปิด ไม่ใช่ด่าน
 */
async function ownedTaskRefusal(
  policy: ClientPolicy,
  taskId: unknown,
  db: D1Database,
): Promise<Refusal> {
  if (typeof taskId !== "string" || taskId === "") return notOwnedRefusal(String(taskId));

  let row: { created_by_client: string; discussion_id: string | null } | null;
  try {
    row = await db
      .prepare(OWNERSHIP_SQL)
      .bind(taskId)
      .first<{ created_by_client: string; discussion_id: string | null }>();
  } catch (error) {
    console.error("client-policy ownership read failed", error);
    return (
      `ตรวจเจ้าของ task '${taskId}' ไม่ได้เพราะฐานข้อมูลตอบผิดพลาด — ` +
      "ปฏิเสธไว้ก่อน (fail-closed) ลองใหม่ภายหลัง"
    );
  }

  if (!row || !policyIds(policy).includes(row.created_by_client)) return notOwnedRefusal(taskId);

  if (row.discussion_id === null || !policy.discussions.includes(row.discussion_id)) {
    return (
      `task '${taskId}' อยู่ในกระทู้ที่ไม่อยู่ใน allowlist ปัจจุบันของ client นี้ — ` +
      `แตะได้เฉพาะ task ในกระทู้ ${policy.discussions.join(", ") || "(ไม่มี)"}`
    );
  }
  return undefined;
}

function discussionRefusal(policy: ClientPolicy, tool: string, target: unknown): Refusal {
  if (typeof target === "string" && policy.discussions.includes(target)) return undefined;
  return (
    `${tool} ของ client นี้ถูกจำกัดไว้เฉพาะกระทู้ที่นโยบายระบุ — ต้องส่ง discussion_id และ` +
    `ใช้ได้เฉพาะ ${policy.discussions.join(", ") || "(ไม่มี)"}`
  );
}

function workerRefusal(policy: ClientPolicy, field: string, target: unknown): Refusal {
  if (typeof target === "string" && policy.workers.includes(target)) return undefined;
  return (
    `${field} ของ client นี้ต้องเป็น worker ในรายการเท่านั้น — ` +
    `${policy.workers.join(", ") || "(ไม่มี)"}`
  );
}

/** ฟิลด์ที่ `update_task` ของ client ที่ถูกจำกัดส่งได้ · `assigned_to` ไม่อยู่ในนี้ ทุกค่ารวม null */
const UPDATE_TASK_FIELDS: ReadonlySet<string> = new Set([
  "task_id",
  "status",
  "detail",
  "result_ref",
  "acting_context",
]);
const UPDATE_TASK_STATUSES: ReadonlySet<string> = new Set(["done", "blocked"]);

/**
 * กฎระดับ argument ราย tool — **ตารางตรงตัว ไม่ใช่กลไกทั่วไป** (`dec-020d7bb3` ข้อ 9)
 *
 * ตัวกรองที่ถูกครึ่งเดียวแย่กว่าไม่มีตัวกรอง เพราะผู้อ่านจะเชื่อว่ากรองแล้ว (บทเรียน
 * ไมเกรชัน 0007) · tool เขียนที่อยู่ใน `tools` แต่ไม่มีแถวในตารางนี้จึง **ถูกปฏิเสธ**
 * ไม่ใช่ปล่อยผ่าน — ดู `argumentRefusal`
 *
 * ลำดับในแต่ละแถว: ตรวจ argument ที่ไม่ต้องอ่าน D1 ก่อน แล้วค่อยอ่าน D1 ครั้งเดียว
 */
const ARGUMENT_RULES: Readonly<Record<string, Rule>> = {
  post_message: async (policy, args) => discussionRefusal(policy, "post_message", args.discussion_id),

  create_task: async (policy, args) => {
    const byDiscussion = discussionRefusal(policy, "create_task", args.discussion_id);
    if (byDiscussion) return byDiscussion;
    const byWorker = workerRefusal(policy, "create_task.assigned_to", args.assigned_to);
    if (byWorker) return byWorker;
    // ละได้ (ค่าตั้งต้นของ server คือ ws-001 อยู่แล้ว) · ค่าอื่นทุกค่า รวม null และ ""
    // ปฏิเสธก่อนเขียน — ไม่ปล่อยให้ค่าว่างตกไปเป็นค่าตั้งต้นเงียบ ๆ
    if (args.workspace !== undefined && args.workspace !== policy.workspace) {
      return `create_task ของ client นี้เขียนได้เฉพาะ workspace '${policy.workspace}' — ละ workspace ไว้หรือระบุค่านี้เท่านั้น`;
    }
    return undefined;
  },

  create_handoff: async (policy, args, db) => {
    const byWorker = workerRefusal(policy, "create_handoff.to", args.to);
    if (byWorker) return byWorker;
    return ownedTaskRefusal(policy, args.task_id, db);
  },

  update_task: async (policy, args, db) => {
    // `assigned_to` ห้ามทุกค่า รวม null — ตรวจจากการ *มีคีย์* ไม่ใช่จากค่า
    const stray = Object.keys(args).filter((key) => !UPDATE_TASK_FIELDS.has(key));
    if (stray.length > 0) {
      return (
        `update_task ของ client นี้ส่งได้เฉพาะ ${[...UPDATE_TASK_FIELDS].join(", ")} — ` +
        `พบ ${stray.join(", ")} (assigned_to เปลี่ยนไม่ได้ทุกค่า รวม null · ส่งต่องานให้ใช้ create_handoff)`
      );
    }
    if (args.status !== undefined && !UPDATE_TASK_STATUSES.has(String(args.status))) {
      return `update_task ของ client นี้ตั้ง status ได้เฉพาะ ${[...UPDATE_TASK_STATUSES].join(", ")}`;
    }
    return ownedTaskRefusal(policy, args.task_id, db);
  },
};

/**
 * ด่านระดับ argument — เรียกจาก `registerTool()` จุดเดียว ก่อน handler ทำงาน
 *
 * คืนข้อความเมื่อ **ห้าม** และคืน `undefined` เมื่อผ่าน · ให้ผู้เรียกโยน error เอง
 * เพื่อให้โมดูลนี้ไม่ต้องรู้จักชนิด error ของชั้นบน
 *
 * `unrestricted` คืนทันทีโดยไม่แตะ `db` — ต้นทุนศูนย์สำหรับ client ที่ไม่เกี่ยว (ข้อ 8)
 */
export async function argumentRefusal(
  decision: PolicyDecision,
  toolName: string,
  args: unknown,
  db: D1Database,
): Promise<Refusal> {
  if (decision.kind === "denied") return decision.reason;
  if (decision.kind !== "restricted") return undefined;

  const { policy } = decision;

  // ชั้น tool ปิดไปแล้วตอน register แต่ตรวจซ้ำที่นี่โดยเจตนา — ชั้นนั้นทำงานตอน
  // ประกอบ server ส่วนชั้นนี้ทำงานตอนเรียก ถ้าวันหนึ่งมีเส้นทางใหม่ที่ประกอบ server
  // โดยไม่ผ่าน guard ด่านนี้ยังอยู่
  if (!policy.tools.includes(toolName)) {
    return (
      `tool '${toolName}' ไม่อยู่ในนโยบายของ client นี้ — ` +
      `เปิดได้เฉพาะ ${policy.tools.join(", ")}`
    );
  }

  const rule = ARGUMENT_RULES[toolName];
  // tool อ่านไม่มีกฎ argument · tool เขียนที่ไม่มีแถวในตารางต้องไม่หลุด — ปฏิเสธ
  if (!rule) {
    return toolName.startsWith("get_")
      ? undefined
      : `tool '${toolName}' เปิดในนโยบายแต่ไม่มีกฎ argument ในตาราง — ปฏิเสธไว้ก่อน (fail-closed)`;
  }

  const record = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  return rule(policy, record, db);
}
