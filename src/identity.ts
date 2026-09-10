/**
 * ใครกำลังพูดอยู่
 *
 * ทั้งโปรเจกต์นี้มีค่าก็ต่อเมื่อ "ใครพูดอะไร" เชื่อถือได้ ดังนั้น author จึงไม่เคย
 * มาจาก argument ที่ client ส่งมา — ถ้าให้ส่งเองได้ ใครก็ประกาศตัวเป็น Claude ได้
 * และ audit trail ทั้งหมดก็ไม่มีความหมาย
 *
 * ค่าที่ใช้มาจาก props ที่ฝัง (เข้ารหัส) ไว้ใน access token ตอนผู้ใช้กดอนุญาตบน
 * หน้า consent ซึ่ง client แก้ไม่ได้
 */

import { getMcpAuthContext } from "agents/mcp/server";
import { secretsMatch } from "./http";

/**
 * ชื่อของผู้ที่เข้ามาทางเส้น static bearer ซึ่งไม่มี identity จาก OAuth
 *
 * `source` สำคัญกว่าที่เห็น เพราะสามค่านี้เชื่อได้ไม่เท่ากันและถูกเขียนแยกไว้ใน
 * `client` เพื่อให้คนอ่านตารางย้อนหลังแยกออกว่าแถวไหนเชื่อถือได้แค่ไหน
 *
 * - `token`  ผูกกับโทเค็นเฉพาะใบที่ผู้ดูแลออกให้ ผู้เรียกเลือกชื่อเองไม่ได้ แต่โทเค็น
 *            ส่งต่อกันได้ จึงยังไม่ใช่การพิสูจน์ตัวตน
 * - `config` ผู้ดูแลตั้งไว้ตัวเดียวสำหรับทุกคนที่เข้าทางนี้ เชื่อได้เท่าที่เชื่อผู้ดูแล
 *            และแยกไม่ออกว่าเครื่องไหน
 * - `header` ตัว client ส่งมาเอง **ปลอมได้** ใครถือโทเค็นก็ประกาศตัวเป็นชื่ออะไรก็ได้
 *
 * ทั้งสามชั้นนี้ต่ำกว่า OAuth ทั้งหมด ซึ่งตัวตนมาจาก props ที่ฝังในโทเค็นและ client
 * แก้ไม่ได้
 */
export interface StaticIdentity {
  name: string;
  source: "config" | "header" | "token";
}

export interface Author {
  /** client id ที่ออกให้ตอนลงทะเบียน DCR — เสถียรกว่าชื่อที่ client ตั้งเอง */
  client: string;
  /** ชื่อที่ client บอกไว้ เช่น `Claude`, `ChatGPT`, `Google` */
  name: string;
}

/** props ที่ `completeAuthorization` ฝังไว้ใน token */
interface AuthorProps {
  clientId: string;
  clientName: string;
}

/**
 * แปลงชื่อที่ค่ายส่งมาให้เป็นชื่อที่คนเรียกกัน
 *
 * Google ลงทะเบียนตัวเองด้วยชื่อ `Google` ทั้งที่คนเรียกผลิตภัณฑ์นั้นว่า Gemini
 * ผู้อ่านกระทู้จึงงงว่าใครพูด
 *
 * ตั้งผ่าน env แทนการเขียนชื่อค่ายลงในโค้ด เพราะกติกาของโปรเจกต์นี้คือห้ามแตกเงื่อนไข
 * ตามผู้ให้บริการ ตารางนี้เปลี่ยน **ป้ายชื่อ** อย่างเดียว ไม่มี logic ไหนทำงานต่างกัน
 * ตามค่าย และ `client` ที่เป็นตัวตนจริงไม่ถูกแตะเลย
 */
function parseAliases(raw: string | undefined): Map<string, string> {
  const aliases = new Map<string, string>();
  if (!raw) return aliases;

  for (const entry of raw.split(",")) {
    const separator = entry.indexOf("=");
    if (separator === -1) continue;

    const from = entry.slice(0, separator).trim();
    const to = entry.slice(separator + 1).trim();
    if (from === "" || to === "") continue;

    aliases.set(from, to);
  }
  return aliases;
}

function readProps(props: Record<string, unknown>): AuthorProps | undefined {
  const { clientId, clientName } = props;
  if (typeof clientId !== "string" || clientId === "") return undefined;
  return {
    clientId,
    clientName: typeof clientName === "string" && clientName !== "" ? clientName : clientId,
  };
}

/**
 * ใครเป็นคนเรียก tool นี้
 *
 * เส้นทาง static bearer (Claude Code, curl) ไม่ผ่าน OAuth จึงไม่มี props ให้อ่าน
 * ตั้งชื่อให้ผ่าน `STATIC_CLIENT_NAME` ได้ ไม่งั้นข้อความจากเส้นทางนั้นจะกองรวมกัน
 * เป็นชื่อเดียวโดยแยกไม่ออกว่าเครื่องไหน
 */
export function resolveAuthor(
  staticIdentity?: StaticIdentity,
  nameAliases?: string,
): Author {
  const props = getMcpAuthContext()?.props;
  const parsed = props ? readProps(props) : undefined;

  // OAuth ชนะเสมอ — client ที่ผ่าน OAuth แล้วส่ง header ชื่ออื่นมาด้วย จะปลอมตัว
  // เป็นคนอื่นไม่ได้
  if (parsed) {
    const aliases = parseAliases(nameAliases);
    return {
      client: parsed.clientId,
      name: aliases.get(parsed.clientName) ?? parsed.clientName,
    };
  }

  if (!staticIdentity) return { client: "static-bearer", name: "Static bearer" };

  const client =
    staticIdentity.source === "header"
      ? `static-header:${staticIdentity.name}`
      : staticIdentity.source === "token"
        ? `static-token:${staticIdentity.name}`
        : "static-bearer";

  return { client, name: staticIdentity.name };
}

/**
 * ชื่อที่ผูกไว้กับโทเค็นใบนั้น
 *
 * เทียบทีละใบด้วยการเปรียบเทียบแบบเวลาคงที่เหมือนที่ใช้กับโทเค็นหลัก ไม่ใช้ Map
 * เพราะการค้นด้วยค่าโทเค็นตรง ๆ จะรั่วเวลาที่ใช้ค้นออกไป
 *
 * รูปแบบผิดถูกข้ามเงียบ ๆ ได้เพราะเป็นค่าที่ผู้ดูแลตั้งเอง ไม่ใช่ข้อมูลจากผู้เรียก และ
 * โทเค็นที่ตั้งผิดรูปจะไม่ตรงกับใครอยู่แล้ว จึงตกไปที่เส้นทางเดิมโดยอัตโนมัติ
 */
export async function nameForToken(
  token: string,
  configured: string | undefined,
): Promise<string | undefined> {
  if (!configured) return undefined;

  for (const entry of configured.split(",")) {
    const separator = entry.indexOf("=");
    if (separator === -1) continue;

    const candidate = entry.slice(0, separator).trim();
    const name = entry.slice(separator + 1).trim();
    if (candidate === "" || name === "") continue;

    if (await secretsMatch(token, candidate)) return name;
  }
  return undefined;
}

/**
 * ความยาวสูงสุดของชื่อที่รับจาก header
 *
 * 140 มาจากขอบเขตของ GitHub — owner ยาวได้ 39 และ repository ยาวได้ 100 บวก
 * เครื่องหมายทับอีกหนึ่ง ตาม convention ที่ตกลงกันว่า team_id คือ owner/repository
 */
const MAX_HEADER_NAME = 140;

/** ผลการอ่านชื่อ แยกกรณีที่ผิดรูปแบบออกจากกรณีที่ไม่ได้ส่งมา */
export type ClientNameResult =
  | { ok: true; identity: StaticIdentity | undefined }
  | { ok: false; reason: string };

/**
 * อ่านชื่อที่ client ส่งมาเองทาง `X-Client-Name`
 *
 * มีไว้ให้ client ที่ตั้ง header ได้แต่ไม่รองรับ OAuth (เช่น Manus) มีชื่อของตัวเอง
 * แทนที่จะกองรวมกับทุกคนที่เข้าทางเดียวกัน
 *
 * ตัดอักขระควบคุมออกเพราะขึ้นบรรทัดใหม่ในชื่อทำให้ตารางที่คนอ่านเพี้ยน และจำกัดความยาว
 * ไว้ ค่านี้ไม่ได้พิสูจน์อะไรทั้งสิ้น — เป็นแค่ป้ายชื่อที่ผู้ถือ token เลือกเอง
 */
export function readClientNameHeader(request: Request): ClientNameResult {
  const raw = request.headers.get("x-client-name");
  if (raw === null) return { ok: true, identity: undefined };

  const cleaned = raw.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  if (cleaned === "") return { ok: true, identity: undefined };

  // ไม่ตัดให้เงียบ ๆ — ชื่อที่ถูกตัดจะไม่ตรงกับที่ผู้ส่งงานพิมพ์ไว้ใน to_whom
  // แล้วงานจะส่งไม่ถึงโดยไม่มีใคร error ซึ่งเป็นอาการที่ทั้งโปรเจกต์ไล่แก้มาตลอด
  if ([...cleaned].length > MAX_HEADER_NAME) {
    return {
      ok: false,
      reason:
        `X-Client-Name ยาว ${[...cleaned].length} ตัว เกินเพดาน ${MAX_HEADER_NAME} ` +
        "ตัว — ตั้งชื่อให้สั้นลง ระบบไม่ตัดให้เพราะชื่อที่ถูกตัดจะไม่ตรงกับปลายทางที่ผู้ส่งงานระบุไว้",
    };
  }

  return { ok: true, identity: { name: cleaned, source: "header" } };
}

/**
 * ชื่อที่จะใช้เมื่อไม่ได้มาทาง OAuth
 *
 * ลำดับคือชื่อจากโทเค็น แล้วชื่อจาก header แล้วค่าที่ผู้ดูแลตั้งไว้ตัวเดียว
 *
 * ชื่อจากโทเค็นชนะ header เพราะผู้ถือโทเค็นเลือกชื่อเองไม่ได้ ถ้าให้ header ทับได้
 * ค่าที่เชื่อได้มากกว่าจะถูกค่าที่เชื่อได้น้อยกว่าเขียนทับ ซึ่งเป็นรูปเดียวกับที่ OAuth
 * ชนะทุกอย่างอยู่แล้ว
 */
export function staticIdentityFor(
  request: Request,
  configuredName: string | undefined,
  tokenName?: string,
): ClientNameResult {
  if (tokenName) return { ok: true, identity: { name: tokenName, source: "token" } };

  const fromHeader = readClientNameHeader(request);
  if (!fromHeader.ok) return fromHeader;
  if (fromHeader.identity) return fromHeader;

  const configured = configuredName?.trim();
  return {
    ok: true,
    identity: configured ? { name: configured, source: "config" } : undefined,
  };
}
