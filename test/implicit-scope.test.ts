/**
 * ขอบเขตกับตัวตนที่ถูกเติมให้เงียบ ๆ — ทำให้มองเห็นได้จากผลลัพธ์
 *
 * สองแผลที่ยกไว้ใน `dis-c6095786` seq 37 และถูกถอนออกจากการเป็นกติกาของโต๊ะใน
 * seq 39 ด้วยเกณฑ์ (e) ของ ChatGPT ที่ว่า *ถ้ามี guardrail ที่อยู่ใกล้จุดพลาดกว่า
 * และแน่นกว่า อย่าใช้กติกา* — ทั้งสองข้อจึงกลายเป็นของที่โค้ดต้องบอกเอง
 *
 * หนึ่ง · `DEFAULT_WORKSPACE = "ws-001"` คือโต๊ะจริง · ลืมส่ง `workspace` แล้ว
 * **ไม่ error และไม่ได้เขียนลงที่ของตัวเอง — มันเขียนลงโต๊ะจริงโดยทุกอย่างดูสำเร็จปกติ**
 *
 * สอง · โทเคนที่ไม่ผูกชื่อทำให้ทุกทีมที่ใช้ใบเดียวกันถูกบันทึกเป็นชื่อเดียวกัน
 * **โดยไม่มีทางไหน error** และ `waiting_for_you` จะปนกันโดยมองไม่เห็นว่าปน
 *
 * ไม่เปลี่ยนค่าตั้งต้นและไม่ปฏิเสธคำขอ — เปลี่ยนแค่ว่าผลลัพธ์บอกความจริงออกมา
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";

const SHARED = "scope-shared-aaaaaaaaaaaaaaaaaaaaaa";
const BOUND = "scope-bound-bbbbbbbbbbbbbbbbbbbbbbbb";

let id = 0;

type Result = Record<string, unknown>;

/** ยิงจริงผ่าน route — ไม่เรียกฟังก์ชันตรง เพราะฟังก์ชันที่ถูกแต่ไม่ได้ต่อสายพิสูจน์อะไรไม่ได้ */
async function call(
  tool: string,
  args: Record<string, unknown>,
  opts: { token?: string; clientName?: string; tokens?: string } = {},
): Promise<Result> {
  const ctx = createExecutionContext();
  const testEnv = {
    ...env,
    MCP_AUTH_TOKEN: SHARED,
    ALLOWED_ORIGIN_HOSTNAMES: "*",
    ...(opts.tokens === undefined ? {} : { MCP_AUTH_TOKENS: opts.tokens }),
  } as unknown as Parameters<typeof worker.fetch>[1];

  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${opts.token ?? SHARED}`,
        ...(opts.clientName === undefined ? {} : { "x-client-name": opts.clientName }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (id += 1),
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  const text = await response.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const frame = JSON.parse(line ? line.slice(5) : text) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  const payload = frame.result?.content?.[0]?.text ?? "";
  if (frame.result?.isError) throw new Error(payload);
  return JSON.parse(payload || "{}") as Result;
}

beforeEach(async () => {
  await resetDatabase();
});

describe("ขอบเขตที่มาจากค่าตั้งต้น ต้องแยกออกจากขอบเขตที่ผู้เรียกระบุเอง", () => {
  /**
   * **กรณีที่ตัดสินไฟล์นี้**
   *
   * สองคำขอนี้เขียนลง `ws-001` เหมือนกันทุกประการ ต่างกันแค่ผู้เรียกส่งชื่อมาเองหรือไม่
   * ถ้าตัวบอกที่มาไปอ่านจากค่าที่ได้ แทนที่จะอ่านจากการที่ผู้เรียกส่งมา สองแถวนี้จะ
   * เหมือนกัน แล้วฟิลด์นั้นก็ไม่ได้บอกอะไรเลย
   */
  it("ส่ง ws-001 มาเอง กับ ลืมส่งแล้วได้ ws-001 ต้องแยกกันได้", async () => {
    const forgot = await call("create_task", { title: "ลืมส่งขอบเขต", detail: "" });
    const meant = await call("create_task", {
      title: "ตั้งใจส่ง ws-001",
      detail: "",
      workspace: "ws-001",
    });

    expect(forgot.workspace).toBe("ws-001");
    expect(meant.workspace).toBe("ws-001");

    expect(forgot.workspace_source).toBe("default");
    expect(meant.workspace_source).toBe("caller");
  });

  it("ทุก tool ที่เขียนและรับ workspace ต้องบอกที่มา", async () => {
    const dis = await call("create_discussion", { title: "กระทู้" });
    const dec = await call("record_decision", { title: "ใบ", detail: "x" });
    const plan = await call("record_plan", { title: "แผน", body: "x" });
    const task = await call("create_task", { title: "งาน", detail: "" });

    for (const r of [dis, dec, plan, task]) {
      expect(r.workspace).toBe("ws-001");
      expect(r.workspace_source).toBe("default");
    }
  });

  it("ค่าตั้งต้นไม่เปลี่ยน — ลืมส่งแล้วยังเขียนลง ws-001 เหมือนเดิม", async () => {
    const task = await call("create_task", { title: "ยังไปที่เดิม", detail: "" });
    const listed = (await call("get_tasks", { limit: 200 })).tasks as Array<{ id: string }>;

    expect(listed.some((t) => t.id === task.task_id)).toBe(true);
  });
});

describe("ผู้เรียกที่ไม่มีชื่อผูกกับตัวเอง ต้องรู้ตัว", () => {
  const TOKENS = `${BOUND}=named-team`;

  it("โทเคนที่ไม่ผูกชื่อ ได้คำเตือนติดมากับผลลัพธ์", async () => {
    const r = await call("create_task", { title: "ใครเขียน", detail: "" });

    expect(r.identity_note).toContain("ไม่มีชื่อผูกกับตัวเอง");
    expect(r.identity_note).toContain("waiting_for_you");
  });

  /**
   * กรณีบวก — มิวแทนต์พิสูจน์ได้แค่ว่าตัวตรวจพูดว่า "ไม่ผ่าน" เป็น
   * ต้องมีกรณีที่ **ต้องไม่เตือน** ด้วย ไม่งั้นตัวเตือนที่เตือนทุกครั้งก็ผ่านหมด
   */
  it("โทเคนที่ผูกชื่อไว้ ต้องไม่มีคำเตือน และต้องไม่มีคีย์เปล่า", async () => {
    const r = await call(
      "create_task",
      { title: "มีชื่อแล้ว", detail: "" },
      { token: BOUND, tokens: TOKENS },
    );

    expect(r.created_by).toBe("named-team");
    // ไม่ใช่ค่าว่าง แต่ต้องไม่มีคีย์เลย — คีย์ที่ว่างทุกครั้งจะถูกอ่านผ่าน
    expect("identity_note" in r).toBe(false);
  });

  it("ตั้ง X-Client-Name บนโทเคนกลาง ก็ยังถือว่ามีชื่อ", async () => {
    const r = await call(
      "create_task",
      { title: "ตั้งชื่อผ่าน header", detail: "" },
      { clientName: "header-team" },
    );

    expect(r.created_by).toBe("header-team");
    expect("identity_note" in r).toBe(false);
  });
});
