/**
 * นโยบายจำกัดสิทธิ์ราย client — ด่านฝั่ง server ที่ผูกกับ OAuth `client_id`
 *
 * อนุมัติโดย `dec-f213c339` (approved + human 20 ต.ค. 2026) ตามข้อเสนอที่
 * `dis-683004a2` #20–#21 และข้อแก้ข้อเท็จจริงที่ #24 · ลูกค้ารายแรกคือ
 * `Orchestrator Bot` ซึ่งต้องเดินงานแทน session ที่มีคนนั่ง โดยไม่ได้สิทธิ์เต็มชุด
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
   * ชื่อที่ client ประกาศตอน DCR — ใช้จับคลาส ไม่ใช่ยืนยันตัวตน
   *
   * ชื่อนี้ตรงแต่ `client_id` ไม่ตรง = ปฏิเสธ ไม่ใช่ปล่อยผ่าน
   */
  readonly client_name: string;
  /** tool ที่เรียกได้ · ที่ไม่อยู่ในนี้ถูก disable และปฏิเสธเมื่อเรียกตรง */
  readonly tools: readonly string[];
  /**
   * `discussion_id` ที่ `post_message` โพสต์ลงได้
   *
   * ว่าง = โพสต์ไม่ได้เลย ไม่ใช่โพสต์ได้ทุกกระทู้ · ถ้า `post_message` ไม่อยู่ใน
   * `tools` ค่านี้ไม่มีความหมาย เพราะ tool ถูกปิดไปก่อนแล้ว
   */
  readonly post_message_discussions: readonly string[];
}

/**
 * รายการนโยบายทั้งหมด — เพิ่มได้เฉพาะที่มีใบตัดสินรองรับ
 *
 * ของแรกและของเดียววันนี้: `Orchestrator Bot` ตาม `dec-f213c339` ข้อ 5 · รายชื่อ
 * ห้า tool มาจากที่ Codex ระบุเองว่าสเปกใช้จริงที่ `dis-683004a2#23` ไม่ใช่ที่ฮับเดา
 * (allowlist ของเส้น `/mcp-readonly` มีเจ็ดตัว ซึ่งไม่เท่ากัน และไม่ใช่รายการที่ใช้ตรงนี้)
 *
 * `post_message` จำกัดไว้ที่กระทู้ notify ของ shadow กระทู้เดียว ซึ่ง operator เปิดให้
 * และ runtime ไม่เปิดกระทู้เอง — จึงไม่ต้องมี `create_discussion` ที่จำกัดด้วย
 * argument ไม่ได้เลย
 *
 * **รายชื่อ tool สำหรับโหมด live ยังไม่อนุมัติ** ต้องมีใบแยกตาม `dec-f213c339` ข้อ 5
 */
export const CLIENT_POLICIES: readonly ClientPolicy[] = [
  {
    client_id: "WL3lHS7PwXbT3a6N",
    client_name: "Orchestrator Bot",
    tools: [
      "get_tasks",
      "get_handoffs",
      "get_discussion",
      "get_decisions",
      "get_workspace_context",
      "post_message",
    ],
    post_message_discussions: ["dis-763ed26c-0f27-4d95-ba9f-939d4c41ebb3"],
  },
];

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
 * ลำดับสำคัญ — เทียบ `client_id` ก่อน ถ้าตรงใช้นโยบายนั้นเลยโดยไม่ดูชื่อ เพราะ
 * `client_id` คือตัวตนที่ผนึกมาในโทเคนและ client แก้ไม่ได้ ส่วนชื่อเป็นคำประกาศ
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
    const byId = policies.find((entry) => entry.client_id === clientId);
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
          "แล้วได้ client_id ใหม่ · ผู้ดูแลต้องเติม client_id ใหม่เข้านโยบายใน " +
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
 * ด่านระดับ argument — เรียกจาก `registerTool()` จุดเดียว ก่อน handler ทำงาน
 *
 * คืนข้อความเมื่อ **ห้าม** และคืน `undefined` เมื่อผ่าน · ให้ผู้เรียกโยน error เอง
 * เพื่อให้โมดูลนี้ไม่ต้องรู้จักชนิด error ของชั้นบน
 *
 * ตรวจเฉพาะ tool ที่นโยบายมีข้อจำกัดระดับ argument จริง ๆ · เขียนเป็นรายชื่อ
 * ไม่ใช่กลไกทั่วไป เพราะตัวกรองที่ถูกครึ่งเดียวแย่กว่าไม่มีตัวกรอง — ผู้อ่านจะเชื่อว่า
 * กรองแล้ว (บทเรียนของไมเกรชัน 0007)
 */
export function argumentRefusal(
  decision: PolicyDecision,
  toolName: string,
  args: unknown,
): string | undefined {
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

  if (toolName === "post_message") {
    const target = (args as { discussion_id?: unknown } | null)?.discussion_id;
    if (typeof target !== "string" || !policy.post_message_discussions.includes(target)) {
      return (
        "post_message ของ client นี้ถูกจำกัดไว้เฉพาะกระทู้ที่นโยบายระบุ — " +
        `โพสต์ได้เฉพาะ ${policy.post_message_discussions.join(", ") || "(ไม่มี)"}`
      );
    }
  }

  return undefined;
}
