/**
 * Knowledge Vault POC — วัดผ่าน route จริง ไม่ใช่ป้อน fixture ที่เราแต่งเอง
 *
 * `ecosystem-intelligence` เล่าไว้ที่ `dis-b492ed20` seq 8 ว่ารอบแรกเขาเขียน payload
 * ด้วยมือแล้วมันตกสองข้อทันทีเมื่อเจอของจริง — **ใบที่เขียนเองพิสูจน์ได้แค่ว่าเราเขียนใบเป็น**
 *
 * เทสต์ชุดนี้จึงสร้างข้อมูลผ่าน write tool จริง อ่านกลับผ่าน read tool จริง แล้วค่อย
 * ป้อนเข้า `buildVault` · ถ้าสัญญาเปลี่ยนจนผู้บริโภคข้างนอกพัง ตัวนี้จะพังด้วย
 */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { resetDatabase } from "./apply-schema";
import { buildVault, type VaultInput } from "../src/vault/build";
import { ACCESS_STATUSES, NOTE_TYPES } from "../src/vault/schema";

const TOKEN = "vault-token-aaaaaaaaaaaaaaaaaaaaaaaa";
const TEAM = "owner/team-a";
const APPROVAL = "deadbeefdeadbeefdeadbeefdeadbeef";
/**
 * ผู้ร่วมที่ชื่อ **ไม่ใช่** `owner/repository` จึงไม่มีโน้ตของตัวเองใน vault
 *
 * ต้องมีอยู่ใน fixture ไม่งั้นเทสต์ลิงก์ค้างจะเขียวโดยไม่มีอะไรให้จับ — ลองแล้วจริง
 * มิวแทนต์ที่ลิงก์ทุกชื่อรอดทั้งที่ควรแดง เพราะโต๊ะจำลองมีชื่อเดียวซึ่งมีโน้ตอยู่แล้ว
 * **มิวแทนต์ที่รอด บางทีแปลว่าข้อมูลทดสอบเล็กกว่าของจริง ไม่ใช่ว่าตัวตรวจอ่อน**
 */
const PLAIN = "PlainClientName";
const PLAIN_TOKEN = "vault-plain-bbbbbbbbbbbbbbbbbbbbbb";

/** เนื้อที่ต้อง **ไม่** ออกมาจากต้นทาง — ข้อความในกระทู้ */
const TALK = "ZZเนื้อข้อความในกระทู้ZZ";
/** เนื้อที่ต้องออกมาคำต่อคำ — ใบตัดสินเป็นระเบียนที่มีคนตั้งใจเขียนเป็นหลักฐาน */
const RECORD = "ZZเนื้อของใบตัดสินZZ";

const testEnv = {
  ...env,
  MCP_AUTH_TOKEN: TOKEN,
  MCP_AUTH_TOKENS: `${PLAIN_TOKEN}=${PLAIN}`,
  APPROVAL_SECRET: APPROVAL,
  ALLOWED_ORIGIN_HOSTNAMES: "*",
} as unknown as Parameters<typeof worker.fetch>[1];

let id = 0;

async function call(
  name: string,
  args: Record<string, unknown> = {},
  as: "team" | "plain" = "team",
): Promise<Record<string, unknown>> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${as === "plain" ? PLAIN_TOKEN : TOKEN}`,
        ...(as === "plain" ? {} : { "x-client-name": TEAM }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (id += 1),
        method: "tools/call",
        params: { name, arguments: args },
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
  const payload = frame.result?.content?.[0]?.text;
  if (frame.result?.isError) throw new Error(payload ?? "tool error");
  return JSON.parse(payload ?? "{}") as Record<string, unknown>;
}

/** เก็บของจริงจาก read tool แล้วประกอบเป็น input — เหมือนที่ CLI ทำ */
async function collect(): Promise<VaultInput> {
  const context = (await call("get_workspace_context", { limit: 50 })) as Record<string, any>;
  const decisions = (await call("get_decisions", { limit: 50 })).decisions as any[];
  const plans = (await call("get_plans", { limit: 50 })).plans as any[];
  const tasks = (await call("get_tasks", { limit: 50 })).tasks as any[];
  const participants = ((await call("get_participants")).participants as any[]).map((p) => p.name);

  const message_index: VaultInput["message_index"] = {};
  for (const dis of context.discussions as any[]) {
    const thread = (await call("get_discussion", { discussion_id: dis.id, limit: 200 })) as any;
    message_index[dis.id] = (thread.messages as any[]).map((m) => ({
      seq: m.seq,
      kind: m.kind,
      author_name: m.author_name,
      created_at: m.created_at,
      in_reply_to: m.in_reply_to,
      // ความยาวเท่านั้น ไม่ใช่เนื้อ
      length: String(m.body ?? "").length,
    }));
  }

  return {
    contract: context.contract as number,
    workspace: { id: context.workspace.id, name: context.workspace.name },
    decisions: decisions as any,
    plans: plans as any,
    discussions: context.discussions as any,
    message_index,
    tasks: tasks as any,
    participants,
    projects: [TEAM],
    exported_at: "2026-09-22T00:00:00.000Z",
  };
}

/** โต๊ะจำลองที่มีของครบทุกชนิดที่ schema รองรับ */
async function seed(): Promise<{ approved: string; proposed: string }> {
  const dis = await call("create_discussion", {
    title: "[ARCHITECTURE] กระทู้ออกแบบ",
    body: `${TALK} บรรทัดแรกของกระทู้`,
  });
  const discussion_id = dis.discussion_id as string;

  await call("post_message", { discussion_id, body: `${TALK} ตอบกลับ`, kind: "review" });
  // ผู้ร่วมที่ไม่มีโน้ตของตัวเอง — ทำให้เทสต์ลิงก์ค้างมีของจริงให้จับ
  await call("post_message", { discussion_id, body: `${TALK} จากชื่อธรรมดา` }, "plain");

  const approved = await call("record_decision", {
    discussion_id,
    title: "ใบที่ถูกเคาะแล้ว",
    detail: `${RECORD} เหตุผลที่คงทน`,
  });
  await call("resolve_decision", {
    decision_id: approved.decision_id as string,
    verdict: "approved",
    reason: "เจ้าของงานอนุมัติ",
    approval_code: APPROVAL,
  });
  await call("set_decision_scope", {
    decision_id: approved.decision_id as string,
    scope: "workspace",
    approval_code: APPROVAL,
  });

  const proposed = await call("record_decision", {
    discussion_id,
    title: "ใบที่ยังไม่ถูกเคาะ",
    detail: `${RECORD} ข้อเสนอที่ยังไม่จบ`,
  });

  await call("record_plan", { discussion_id, title: "แผนรอบแรก", body: `${RECORD} ขั้นตอน` });
  await call("create_task", { discussion_id, title: "ใบงานหนึ่ง", detail: `${TALK} รายละเอียดใบงาน` });

  return { approved: approved.decision_id as string, proposed: proposed.decision_id as string };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("กฎว่าอะไรคือความรู้ที่คงทน", () => {
  it("ใบที่ยังไม่ถูกเคาะ ไม่เข้า vault · ใบที่เคาะแล้วเข้า", async () => {
    const { approved, proposed } = await seed();
    const files = buildVault(await collect());
    const all = [...files.keys()].join("\n");

    expect(all).toContain(approved.slice(0, 12));
    expect(all).not.toContain(proposed.slice(0, 12));
  });

  it("ใบที่ปักเป็นกติกาของโต๊ะ ไปอยู่คนละโฟลเดอร์กับใบตัดสินธรรมดา", async () => {
    const { approved } = await seed();
    const files = buildVault(await collect());

    const path = [...files.keys()].find((p) => p.includes(approved.slice(0, 12)));
    expect(path).toMatch(/^Standing Rules\//);
    expect(files.get(path!)).toContain("type: standing-rule");
  });

  it("กระทู้ที่ขึ้นต้นด้วย [ARCHITECTURE] ไปอยู่โฟลเดอร์ Architecture", async () => {
    await seed();
    const files = buildVault(await collect());

    expect([...files.keys()].some((p) => p.startsWith("Architecture/"))).toBe(true);
  });
});

/**
 * ข้อที่สำคัญที่สุดของ POC นี้ และเป็นเหตุผลที่เลือกไม่เอาเนื้อข้อความเลย
 *
 * กระทู้ของโต๊ะนี้พาดถึงงานที่มีข้อมูลสุขภาพ · **การไม่เอาเนื้อเลยพิสูจน์ได้ ส่วนการ
 * ตัดให้หมดพิสูจน์ไม่ได้** — ตัวตัดที่บอกว่า "ตัดครบแล้ว" ตรวจยากกว่ากติกาที่บอกว่า
 * "ไม่เคยหยิบมาตั้งแต่แรก"
 */
describe("เนื้อที่ห้ามออกจากต้นทาง", () => {
  it("ไม่มีเนื้อข้อความในกระทู้หลุดเข้า vault สักไฟล์เดียว", async () => {
    await seed();
    const files = buildVault(await collect());

    for (const [path, content] of files) {
      expect(content, `${path} มีเนื้อข้อความในกระทู้`).not.toContain(TALK);
    }
  });

  /**
   * กรณีบวก — พิสูจน์ว่าข้อบนไม่ได้ผ่านเพราะ vault ว่างหรือเพราะตัวตรวจมองไม่เห็นอะไร
   *
   * เมื่อวานเขียนตัวตรวจที่หา `{"result"` ในผลของ `JSON.stringify` ซึ่งไม่มีวันเจอ
   * เพราะ stringify แปลง `"` เป็น `\"` · สองข้อเขียวโดยไม่เคยแตะอะไรเลย และกรณีบวก
   * คือสิ่งเดียวที่จับได้
   */
  it("แต่เนื้อของใบตัดสินเข้าคำต่อคำ — ตัวตรวจไม่ได้บอดทั้งกระดาน", async () => {
    await seed();
    const files = buildVault(await collect());

    expect([...files.values()].join("\n")).toContain(RECORD);
  });

  /**
   * ดัชนีต้องครอบทุกข้อความ ไม่ใช่เท่าที่เราจำได้ว่าโพสต์ไป — บนโต๊ะนี้การบันทึก
   * ใบตัดสิน แผน และใบงาน ทำให้เกิดข้อความประกาศในกระทู้ด้วย · เทียบกับยอดที่
   * ต้นทางรายงานเอง จึงถูกกว่าเขียนตัวเลขที่เราเดาไว้
   */
  it("ดัชนีข้อความครอบทุก seq ที่ต้นทางรายงาน โดยไม่มีเนื้อ", async () => {
    await seed();
    const input = await collect();
    const files = buildVault(input);

    const [path, arch] = [...files.entries()].find(([p]) => p.startsWith("Architecture/"))!;
    const dis = input.discussions.find((d) => path.includes(d.id.slice(0, 12)))!;

    expect(dis.message_count).toBeGreaterThan(1);
    expect(arch).toContain(`ดัชนีข้อความ · ${dis.message_count} รายการ`);
    for (let seq = 1; seq <= dis.latest_seq; seq += 1) {
      expect(arch, `ดัชนีขาด seq ${seq}`).toContain(`| ${seq} |`);
    }
    expect(arch).not.toContain(TALK);
  });
});

describe("provenance ที่ทุกโน้ตต้องมี", () => {
  it("ทุกไฟล์ยกเว้น STATUS มี frontmatter ครบ และค่าอยู่ในรายการที่ประกาศไว้", async () => {
    await seed();
    const files = buildVault(await collect());

    for (const [path, content] of files) {
      if (path === "_vault/STATUS.md") continue;
      const type = /^type: (\S+)$/m.exec(content)?.[1];
      const derivation = /^  derivation: (\S+)$/m.exec(content)?.[1];
      const access = /^access_status: (\S+)$/m.exec(content)?.[1];

      expect(NOTE_TYPES, `${path} ชนิดไม่อยู่ในรายการ`).toContain(type as never);
      expect(["verbatim", "distilled"], `${path} derivation ผิด`).toContain(derivation);
      expect(ACCESS_STATUSES, `${path} access_status ผิด`).toContain(access as never);
      expect(content, `${path} ไม่ได้ประกาศห้ามเขียนกลับ`).toContain("writeback: forbidden");
      expect(content, `${path} ไม่มีที่อยู่ของความจริง`).toMatch(/^canonical: mcp:\/\//m);
    }
  });

  /**
   * `confirmed` แปลว่า "ผู้รับเปิดได้จริง" ซึ่ง **ผู้สร้างสำเนายืนยันแทนไม่ได้โดยนิยาม**
   * ค่าที่ประกาศได้แต่ตรวจไม่ได้ จะไม่ตรงโดยไม่มีอะไรฟ้อง — รูปเดียวกับ
   * `decided_by_kind: "ai"` ที่อยู่ในสัญญามาเป็นสัปดาห์โดยไม่มีโค้ดไหนเขียน
   */
  it("exporter ไม่เขียน confirmed เลยสักไฟล์", async () => {
    await seed();
    const files = buildVault(await collect());

    for (const [path, content] of files) {
      expect(content, `${path} ประกาศ confirmed ทั้งที่ยืนยันแทนไม่ได้`).not.toContain(
        "access_status: confirmed",
      );
    }
  });

  it("โน้ตที่ถือเนื้อคำต่อคำประกาศ verbatim · โน้ตที่ประกอบขึ้นประกาศ distilled", async () => {
    const { approved } = await seed();
    const files = buildVault(await collect());

    const rule = files.get([...files.keys()].find((p) => p.includes(approved.slice(0, 12)))!)!;
    expect(rule).toContain("derivation: verbatim");

    const arch = [...files.entries()].find(([p]) => p.startsWith("Architecture/"))![1];
    expect(arch).toContain("derivation: distilled");

    const project = [...files.entries()].find(([p]) => p.startsWith("Projects/"))![1];
    expect(project).toContain("derivation: distilled");
  });
});

describe("vault ต้องเดินไปถึงกันได้ และบอกได้ว่าตัวเองเก่าแค่ไหน", () => {
  /**
   * ลิงก์ค้างใน Obsidian หน้าตาเหมือนลิงก์ที่ใช้ได้ทุกประการจนกว่าจะกด — ตระกูล
   * เดียวกับ gate ที่ `enforcement: active` แต่ไม่มี workflow มารัน
   */
  it("ไม่มีลิงก์ที่ชี้ไปโน้ตซึ่งไม่มีอยู่", async () => {
    await seed();
    const files = buildVault(await collect());

    const names = new Set([...files.keys()].map((p) => p.split("/").pop()!.replace(/\.md$/, "")));
    const dangling: string[] = [];

    // ยืนยันว่าโต๊ะจำลองมีชื่อที่ไม่มีโน้ตจริง ไม่งั้นข้อนี้เขียวโดยไม่มีอะไรให้จับ
    expect([...files.keys()].some((p) => p.includes(PLAIN))).toBe(false);

    for (const [path, content] of files) {
      for (const m of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
        if (!names.has(m[1])) dangling.push(`${path} → ${m[1]}`);
      }
    }

    expect(dangling).toEqual([]);
  });

  /**
   * ตัวชี้ที่ถูกตัดกลางรหัส หน้าตาเหมือนตัวชี้ที่ใช้ได้ทุกประการ · รอบแรกตัดที่ 12
   * ตัวตายตัว แล้ว `plan-931f80d1` กลายเป็น `plan-931f80d` ซึ่งหาอะไรไม่เจอ
   */
  it("รหัสย่อในชื่อไฟล์และในลิงก์ ยังเป็นคำนำหน้าบวกกลุ่มแรกครบ ไม่ถูกตัดกลาง", async () => {
    await seed();
    const input = await collect();
    const files = buildVault(input);

    const ids = [
      ...input.decisions.map((d) => d.id),
      ...input.plans.map((p) => p.id),
      ...input.discussions.map((d) => d.id),
    ];

    for (const path of files.keys()) {
      const head = path.split("/").pop()!.split(" ")[0];
      if (!/^[a-z]+-[0-9a-f]+$/.test(head)) continue;
      expect(
        ids.some((id) => id.startsWith(`${head}-`)),
        `${path} ขึ้นต้นด้วย ${head} ซึ่งไม่ตรงกับรหัสเต็มของระเบียนใด`,
      ).toBe(true);
    }
  });

  it("STATUS บอกเลข contract · seq ล่าสุด · และสิ่งที่ตั้งใจไม่มี", async () => {
    await seed();
    const input = await collect();
    const status = buildVault(input).get("_vault/STATUS.md")!;

    expect(status).toContain(`| contract ของ MCP | ${input.contract} |`);
    expect(status).toContain(input.discussions[0].id);
    expect(status).toContain("สิ่งที่ vault ชุดนี้ตั้งใจไม่มี");
    expect(status).toContain("ห้ามแก้ไฟล์ในนี้แล้วคาดว่าต้นทางจะเปลี่ยนตาม");
  });

  /**
   * ข้อมูลชุดเดิมต้องได้ไฟล์ชุดเดิมทุกไบต์ ไม่งั้นเทียบสองรอบไม่ได้ว่าอะไรเปลี่ยน
   * แล้วการ re-export จะกลายเป็น diff ที่อ่านไม่ได้ทั้งก้อน
   */
  it("สร้างสองรอบจาก input เดียวกัน ได้ผลเท่ากันทุกไบต์", async () => {
    await seed();
    const input = await collect();

    const a = buildVault(input);
    const b = buildVault(input);

    expect([...b.entries()]).toEqual([...a.entries()]);
  });
});
