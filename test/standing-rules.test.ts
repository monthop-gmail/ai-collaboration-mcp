/**
 * กติกาของโต๊ะที่หาเจอจากการเรียกครั้งเดียว
 *
 * ที่มา: ใบอนุมัติแล้ว 16 ใบในโต๊ะจริง ไม่มีใบไหนถูกแทนเลยสักใบ และในกองนั้นมีของ
 * สองชนิดปนกันซึ่งเครื่องแยกไม่ออก คือกติกาที่บังคับทุกคนราวห้าใบ กับการอนุมัติ
 * เรื่องเดียวของโปรเจกต์เดียวอีกสิบเอ็ดใบ · `get_workspace_context` เดิมโผล่เรื่อง
 * decision ช่องเดียวคือยอดใบที่ยัง `proposed` แปลว่าพอใบถูกอนุมัติมันหายจาก context
 * ทันที กติกาที่บังคับทุกคนจึงไม่ปรากฏที่ไหนเลย
 *
 * ของที่เทสต์ชุดนี้ต้องคุมให้ได้คือ **คุณสมบัติที่ผู้อ่านใช้ได้โดยไม่ต้องไล่ดูทีละแถว**
 * คือทุกใบในรายการกติกา มีคนที่ถือรหัสของเซิร์ฟเวอร์เป็นคนปัก ไม่มีทางอื่นเข้ามาได้
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";

const TOKEN = "rules-token-aaaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET = "approval-secret-not-a-real-one";
const TEAM = "owner/team-a";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: TOKEN,
  APPROVAL_SECRET: SECRET,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

/** เซิร์ฟเวอร์ที่ยังไม่ได้ตั้งรหัสเลย — ต้องปฏิเสธ ไม่ใช่ปล่อยผ่าน */
const noSecretEnv = { ...testEnv, APPROVAL_SECRET: undefined } as typeof testEnv;

let id = 0;

async function callTool(
  name: string,
  args: Record<string, unknown>,
  useEnv: typeof testEnv = testEnv,
): Promise<Record<string, unknown>> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${TOKEN}`,
        "x-client-name": TEAM,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (id += 1),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
    useEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  const text = await response.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const frame = JSON.parse(line ? line.slice(5) : text) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  const payload = frame.result?.content?.[0]?.text;
  if (frame.result?.isError) throw new Error(payload ?? "tool error");
  return JSON.parse(payload ?? "{}") as Record<string, unknown>;
}

interface Rule {
  id: string;
  title: string;
  decided_by_kind: string | null;
  decided_at: string | null;
}

async function rules(): Promise<Rule[]> {
  const context = await callTool("get_workspace_context", { limit: 1 });
  return context.standing_rules as Rule[];
}

/** ใบที่ปิดแล้ว โดยเลือกได้ว่ายืนยันด้วยรหัสหรือปิดแบบ relayed */
async function decided(
  title: string,
  verdict: "approved" | "rejected" = "approved",
  withCode = false,
): Promise<string> {
  const decision = await callTool("record_decision", { title, detail: "รายละเอียดของใบ" });
  const decisionId = decision.decision_id as string;
  await callTool("resolve_decision", {
    decision_id: decisionId,
    verdict,
    reason: "เหตุผลของการปิด",
    ...(withCode ? { approval_code: SECRET } : {}),
  });
  return decisionId;
}

beforeEach(async () => {
  await resetDatabase();
});

describe("ค่าเริ่มต้นไม่ทำให้ใบไหนกลายเป็นกติกา", () => {
  it("โต๊ะเปล่า คืนรายการว่าง ไม่ใช่หายไปจากผลลัพธ์", async () => {
    expect(await rules()).toEqual([]);
  });

  it("ใบที่อนุมัติแล้วแต่ไม่มีใครปัก ยังไม่ใช่กติกา", async () => {
    await decided("อนุมัติเรื่องเดียวของโปรเจกต์เดียว");

    expect(await rules()).toEqual([]);
  });
});

describe("ปักได้เฉพาะเมื่อมีคนถือรหัส", () => {
  it("รหัสถูก ใบขึ้นเป็นกติกา และติดหลักฐานว่าใบนั้นถูกปิดมาอย่างไร", async () => {
    const decisionId = await decided("กติกาการทำงานของโต๊ะ");

    const result = await callTool("set_decision_scope", {
      decision_id: decisionId,
      scope: "workspace",
      approval_code: SECRET,
    });

    expect(result).toMatchObject({ scope: "workspace", standing_rule: true });

    const listed = await rules();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: decisionId,
      title: "กติกาการทำงานของโต๊ะ",
      // ใบนี้ปิดแบบ relayed แต่ถูกปักโดยคนที่ถือรหัส — สองอย่างนี้คนละเวลาคนละหลักฐาน
      decided_by_kind: "relayed",
    });
  });

  it("รหัสผิด ปฏิเสธ และไม่เปลี่ยนอะไรเลย", async () => {
    const decisionId = await decided("ใบที่จะลองปักด้วยรหัสผิด");

    await expect(
      callTool("set_decision_scope", {
        decision_id: decisionId,
        scope: "workspace",
        approval_code: "รหัสมั่ว",
      }),
    ).rejects.toThrow(/approval_code/);

    expect(await rules()).toEqual([]);
  });

  /**
   * เซิร์ฟเวอร์ที่ไม่ได้ตั้งรหัสต้องปฏิเสธ ไม่ใช่ปล่อยผ่านเพราะ "ไม่มีอะไรให้เทียบ"
   * ซึ่งเป็นรูปที่ทำให้ด่านความปลอดภัยหายไปเงียบ ๆ ตอน deploy ที่ตั้งค่าไม่ครบ
   */
  it("เซิร์ฟเวอร์ที่ยังไม่ได้ตั้งรหัส ปักไม่ได้เลย", async () => {
    const decisionId = await decided("ใบบนเซิร์ฟเวอร์ที่ไม่มีรหัส");

    await expect(
      callTool(
        "set_decision_scope",
        { decision_id: decisionId, scope: "workspace", approval_code: "อะไรก็ได้" },
        noSecretEnv,
      ),
    ).rejects.toThrow(/APPROVAL_SECRET/);
  });
});

describe("ใบที่ยังไม่ผ่าน หรือตกไปแล้ว เป็นกติกาไม่ได้", () => {
  it("ใบที่ยัง proposed ปักไม่ได้ แม้รหัสถูก", async () => {
    const decision = await callTool("record_decision", {
      title: "ข้อเสนอที่ยังไม่มีใครตัดสิน",
      detail: "รายละเอียด",
    });

    await expect(
      callTool("set_decision_scope", {
        decision_id: decision.decision_id as string,
        scope: "workspace",
        approval_code: SECRET,
      }),
    ).rejects.toThrow(/proposed/);
  });

  it("ใบที่ถูกปฏิเสธ ปักไม่ได้ แม้รหัสถูก", async () => {
    const decisionId = await decided("ใบที่ตกไปแล้ว", "rejected");

    await expect(
      callTool("set_decision_scope", {
        decision_id: decisionId,
        scope: "workspace",
        approval_code: SECRET,
      }),
    ).rejects.toThrow(/rejected/);
  });
});

describe("ถอดออกได้ และของที่ถูกแทนแล้วไม่ค้างอยู่", () => {
  it("ปักแล้วถอดกลับเป็น project ได้ หายจากรายการ", async () => {
    const decisionId = await decided("กติกาที่จะถอดทีหลัง");
    await callTool("set_decision_scope", {
      decision_id: decisionId,
      scope: "workspace",
      approval_code: SECRET,
    });
    expect(await rules()).toHaveLength(1);

    await callTool("set_decision_scope", {
      decision_id: decisionId,
      scope: "project",
      approval_code: SECRET,
    });

    expect(await rules()).toEqual([]);
  });

  /**
   * ใช้เกณฑ์เดียวกับ `plans_current` — ของที่ถูกแทนแล้วต้องไม่ค้างอยู่ในรายการ
   * ไม่งั้นคนอ่านจะเห็นกติกาสองใบที่ขัดกันโดยไม่รู้ว่าใบไหนยังใช้อยู่
   */
  it("กติกาที่ถูกแทนแล้วไม่ขึ้น เหลือแต่ตัวที่ยังยืนอยู่", async () => {
    const replacement = await decided("กติกาฉบับใหม่");
    await callTool("set_decision_scope", {
      decision_id: replacement,
      scope: "workspace",
      approval_code: SECRET,
    });

    const old = await callTool("record_decision", {
      title: "กติกาฉบับเก่า",
      detail: "รายละเอียด",
    });
    const oldId = old.decision_id as string;
    await callTool("resolve_decision", {
      decision_id: oldId,
      verdict: "approved",
      reason: "อนุมัติไว้ก่อน แล้วค่อยถูกแทน",
    });
    await callTool("set_decision_scope", {
      decision_id: oldId,
      scope: "workspace",
      approval_code: SECRET,
    });
    expect(await rules()).toHaveLength(2);

    // ทำให้ใบเก่าถูกแทน — ทาง tool ทำได้เฉพาะตอนปฏิเสธ จึงตั้งที่ระดับ DB
    await env.DB.prepare("UPDATE decisions SET superseded_by = ?1 WHERE id = ?2")
      .bind(replacement, oldId)
      .run();

    const listed = await rules();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(replacement);
  });
});

describe("รายการกติกาถูกโดยไม่ต้องอ่านเนื้อใบ", () => {
  it("คืนแค่ตัวชี้กับหัวเรื่อง ไม่พาเนื้อใบเข้ามาใน context", async () => {
    const decisionId = await decided("กติกาที่มีรายละเอียดยาว");
    await callTool("set_decision_scope", {
      decision_id: decisionId,
      scope: "workspace",
      approval_code: SECRET,
    });

    const [rule] = await rules();

    expect(Object.keys(rule).sort()).toEqual(["decided_at", "decided_by_kind", "id", "title"]);
    expect(JSON.stringify(rule)).not.toContain("รายละเอียดของใบ");
  });

  it("กติกาหลายใบเรียงตามเวลาที่ถูกตัดสิน ไม่ใช่ตามเวลาที่ถูกปัก", async () => {
    const first = await decided("กติกาที่ตัดสินก่อน");
    const second = await decided("กติกาที่ตัดสินทีหลัง");

    // ปักกลับลำดับโดยตั้งใจ ถ้าเรียงตามเวลาปัก ลำดับจะสลับ
    await callTool("set_decision_scope", {
      decision_id: second,
      scope: "workspace",
      approval_code: SECRET,
    });
    await callTool("set_decision_scope", {
      decision_id: first,
      scope: "workspace",
      approval_code: SECRET,
    });

    expect((await rules()).map((r) => r.id)).toEqual([first, second]);
  });
});
