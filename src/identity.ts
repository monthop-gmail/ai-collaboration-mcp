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
export function resolveAuthor(staticName?: string, nameAliases?: string): Author {
  const props = getMcpAuthContext()?.props;
  const parsed = props ? readProps(props) : undefined;

  if (parsed) {
    const aliases = parseAliases(nameAliases);
    return {
      client: parsed.clientId,
      name: aliases.get(parsed.clientName) ?? parsed.clientName,
    };
  }

  const name = staticName?.trim();
  return { client: "static-bearer", name: name && name !== "" ? name : "Static bearer" };
}
