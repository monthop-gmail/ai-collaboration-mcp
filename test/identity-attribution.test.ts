/**
 * การระบุตัวผู้ลงมือ — วัดทุกทางที่ตั้งค่าผิดได้ ไม่ใช่เฉพาะทางที่ตั้งถูก
 *
 * เขียนเพื่อตอบ P0 ข้อ 2 ของ Multi-Agent Lab (`task-fbadfc1e`) ที่ถามว่า runner
 * ห้าตัวควรมี principal อย่างไร · `ai-tools-mcp` อ้างถึงรูปที่ตกลงกันไว้ที่
 * `dis-a84b7a8e` seq 13–14 ว่า *ใบเดียวอนุญาตหลายชื่อ แล้ว `X-Client-Name` เลือก*
 * และเตือนว่าถ้าไม่ส่งชื่อ **ต้องปฏิเสธ ไม่ใช่เลือกชื่อแรกเงียบ ๆ**
 *
 * ไฟล์นี้วัดว่าของจริงทำอะไร — **ไม่ใช่ว่ามันควรทำอะไร**
 *
 * ข้อที่ต้องรู้ก่อนอ่าน: `MCP_AUTH_TOKENS` ผูก **หนึ่งใบต่อหนึ่งชื่อ** และชื่อจาก
 * โทเคนทับ `X-Client-Name` เสมอ · รูป *ใบเดียวหลายชื่อ* ที่ seq 13–14 คุยกันไว้
 * **ไม่เคยถูกสร้างขึ้นในโค้ด** — เป็นข้อตกลงที่ยังไม่มีของรองรับ ซึ่งเป็นรูปเดียวกับ
 * `decided_by_kind: "ai"` ที่อยู่ในสัญญามาเป็นสัปดาห์โดยไม่มีโค้ดเส้นไหนเขียน
 *
 * ทุกกรณีที่ตั้งค่าผิดในไฟล์นี้ **ไม่มีกรณีไหนถูกปฏิเสธ** ทุกกรณีได้ชื่อที่ดูสมเหตุสมผล
 * กลับไป ซึ่งคือสิ่งที่ benchmark ต้องกันเอง เพราะระบบจะไม่กันให้
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";

const SHARED = "attr-shared-aaaaaaaaaaaaaaaaaaaaaaaa";
const BOUND_A = "attr-bound-a-bbbbbbbbbbbbbbbbbbbbbb";
const BOUND_B = "attr-bound-b-cccccccccccccccccccccc";
const DUP = "attr-dup-dddddddddddddddddddddddddd";

let id = 0;

/** ยิงจริงผ่าน route พร้อมเลือกได้ว่าจะส่ง header ชื่อหรือไม่ */
async function whoAmI(
  token: string,
  clientName: string | undefined,
  extra: Record<string, string> = {},
): Promise<string> {
  const ctx = createExecutionContext();
  const testEnv = {
    ...env,
    MCP_AUTH_TOKEN: SHARED,
    ALLOWED_ORIGIN_HOSTNAMES: "*",
    ...extra,
  } as unknown as Parameters<typeof worker.fetch>[1];

  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        ...(clientName === undefined ? {} : { "x-client-name": clientName }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (id += 1),
        method: "tools/call",
        params: { name: "get_workspace_context", arguments: { limit: 1 } },
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
  return (JSON.parse(payload || "{}") as { you_are?: string }).you_are ?? "";
}

beforeEach(async () => {
  await resetDatabase();
});

/**
 * ทางที่ให้ attribution แยกกันได้จริง — **หนึ่งใบต่อหนึ่ง runner**
 */
describe("โทเคนผูกชื่อ — ทางเดียวที่ปลอมชื่อไม่ได้", () => {
  const TOKENS = `${BOUND_A}=lab-runner-a,${BOUND_B}=lab-runner-b`;

  it("แต่ละใบได้ชื่อของตัวเอง", async () => {
    expect(await whoAmI(BOUND_A, undefined, { MCP_AUTH_TOKENS: TOKENS })).toBe("lab-runner-a");
    expect(await whoAmI(BOUND_B, undefined, { MCP_AUTH_TOKENS: TOKENS })).toBe("lab-runner-b");
  });

  it("ส่ง header เป็นชื่อคนอื่น ก็ปลอมไม่ได้ — ชื่อจากโทเคนชนะเสมอ", async () => {
    const claimed = await whoAmI(BOUND_A, "lab-runner-b", { MCP_AUTH_TOKENS: TOKENS });

    expect(claimed).toBe("lab-runner-a");
  });
});

/**
 * ทางที่ตั้งค่าผิดแล้ว **ไม่มีอะไรฟ้อง** — สามแบบ และทั้งสามได้ชื่อที่ดูสมเหตุสมผล
 *
 * นี่คือคำตอบของคำถามที่ `ai-tools-mcp` ถามว่าระบบ *ปฏิเสธ* หรือ *เลือกชื่อแรก*
 * คำตอบคือ **ไม่ปฏิเสธสักทาง** และรูป *ใบเดียวหลายชื่อ* ก็ไม่มีอยู่ตั้งแต่แรก
 */
describe("ทางที่ยุบชื่อหลายตัวเป็นชื่อเดียวโดยไม่มีอะไรฟ้อง", () => {
  it("รหัสซ้ำในทะเบียนสองบรรทัด ได้ชื่อของบรรทัดแรกเงียบ ๆ", async () => {
    // ตั้งค่าผิดที่เกิดได้จริงตอนพิมพ์ทะเบียนใหม่ทั้งก้อน ซึ่งเป็นวิธีเดียวที่
    // Cloudflare ให้แก้ secret — ใบที่ตกหล่นหรือซ้ำจะไม่มีอะไรฟ้อง
    const tokens = `${DUP}=lab-runner-a,${DUP}=lab-runner-b`;

    expect(await whoAmI(DUP, undefined, { MCP_AUTH_TOKENS: tokens })).toBe("lab-runner-a");
  });

  it("ใช้โทเคนกลางร่วมกัน แล้วลืมส่งชื่อ — ทุกตัวกลายเป็นชื่อเดียวที่ผู้ดูแลตั้งไว้", async () => {
    const a = await whoAmI(SHARED, "lab-runner-a", { STATIC_CLIENT_NAME: "lab-shared" });
    const forgot = await whoAmI(SHARED, undefined, { STATIC_CLIENT_NAME: "lab-shared" });

    expect(a).toBe("lab-runner-a");
    expect(forgot).toBe("lab-shared");
    // ไม่ error ไม่เตือน — รอบนั้นถูกบันทึกเป็นอีกคนโดยที่ทุกอย่างดูสำเร็จปกติ
    expect(forgot).not.toBe(a);
  });

  it("ไม่มีทั้งชื่อในทะเบียน ทั้ง header ทั้งค่าที่ผู้ดูแลตั้ง — ยุบเป็นป้ายเดียว", async () => {
    expect(await whoAmI(SHARED, undefined)).toBe("Static bearer");
  });
});

/**
 * ข้อที่ benchmark ต้องเอาไปกันเอง
 *
 * B2 ของ lab เคาะว่า *หนึ่ง runner ต่อหนึ่ง principal · รอบที่ identity แยกไม่ได้
 * ให้ mark invalid* · ระบบไม่มีทางบอกได้ว่ารอบไหน identity แยกไม่ได้ เพราะทุกทาง
 * ที่ยุบชื่อ **สำเร็จเงียบ ๆ** · harness จึงต้องยืนยันเองทุกรอบว่าชื่อที่ได้กลับมา
 * ตรงกับชื่อที่ตั้งใจ
 */
describe("วิธีที่ harness ตรวจเองได้ ด้วยของที่มีอยู่แล้ว", () => {
  it("you_are คืนชื่อที่ถูกบันทึกจริง — ใช้เทียบกับชื่อที่ตั้งใจได้ก่อนเริ่มรอบ", async () => {
    const seen = await whoAmI(BOUND_A, undefined, {
      MCP_AUTH_TOKENS: `${BOUND_A}=lab-runner-a`,
    });

    // หนึ่งบรรทัดนี้คือด่านที่ถูกที่สุดที่ lab ทำได้ — เรียกครั้งเดียวก่อนรอบ
    // ถ้า you_are ไม่ตรงกับที่ตั้งใจ ให้หยุดรอบนั้น ไม่ใช่รันแล้วค่อยมาสงสัยทีหลัง
    expect(seen).toBe("lab-runner-a");
  });
});
