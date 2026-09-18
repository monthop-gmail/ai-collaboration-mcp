/**
 * ตรวจโทเคนของ gateway บนเส้นทางอ่านอย่างเดียว — upstream adapter
 *
 * สัญญาอยู่ที่ `ADAPTER.md` ของ `monthop-gmail/internal-mcp-gateway` ที่ `7dbea5f`
 * และชุด vector ที่วัดไฟล์นี้อยู่ที่ `test/fixtures/adapter-conformance/`
 *
 * สิ่งที่ไฟล์นี้ทำ ตรวจโทเคนแล้วคืนตัวตน
 * สิ่งที่ไฟล์นี้ไม่ทำ ไม่ออกโทเคน ไม่ตัดสินนโยบายแทน gateway และ **ไม่เชื่อว่าคำขอ
 * ที่มาจาก gateway แปลว่าผ่านแล้ว** — จุดบังคับใช้ของฝั่งนี้เป็นของฝั่งนี้
 *
 * เหตุผลที่ต้องเป็นของเราเองแทนที่จะรับ patch จากทีม gateway อยู่ใน dis-514ae7a7
 * seq 13 คือถ้าคนเขียน gateway เป็นคนเขียน adapter ของ upstream ด้วย จุดบังคับใช้
 * ที่สองจะไม่เป็นอิสระจริงตั้งแต่วันแรก
 */

/**
 * claim ทุกตัวต้องอยู่ฝ่ายใดฝ่ายหนึ่ง ไม่มี claim ที่อยู่เฉย ๆ
 *
 * `enforced` มีข้อของตัวเองในลำดับการตรวจ พร้อมรหัสปฏิเสธของตัวเอง
 * `diagnostics` มีไว้ดูและต่อเรื่องเท่านั้น **ห้ามใช้ตัดสินสิทธิ์**
 *
 * กติกานี้มีเพราะฝั่ง gateway เจอมาแล้วสองครั้งว่า `ops` แล้ว `cid` อยู่ในสภาพ
 * "มีคนใส่ค่า แต่ไม่มีใครถูกสั่งให้ทำอะไรกับมัน" — ครั้งแรกเขาแก้ที่ `ops` ตัวเดียว
 * แล้ว `cid` ก็หลุดมาในรอบถัดไป เทสต์ `claim contract` บังคับข้อนี้กับไฟล์นี้ด้วย
 */
export const CLAIM_CONTRACT = {
  enforced: ["iss", "sub", "aud", "cid", "nbf", "exp", "jti", "ops"],
  diagnostics: ["iat", "sid", "env", "team", "roles", "cor"],
} as const;

/**
 * รหัสปฏิเสธเป็นชุดปิด ไม่ใช่ข้อความอิสระ
 *
 * ฝั่ง gateway เคยพลาดข้อนี้เอง คือคัดลอกข้อความของ upstream มาเป็นเหตุผลของตัวเอง
 * ทำให้ audit นับไม่ได้ — รหัสคงที่ทำให้ตารางบันทึกนับได้และเทียบข้ามระบบได้
 */
export const REJECT_REASONS = [
  "malformed_token",
  "unsupported_alg",
  "unknown_kid",
  "bad_signature",
  "issuer_mismatch",
  "audience_mismatch",
  "connector_mismatch",
  "token_not_yet_valid",
  "token_expired",
  "replayed_jti",
  "ops_not_permitted",
  "subject_missing",
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];

/** ตัวตนที่อ่านได้จากโทเคนที่ผ่านทุกด่านแล้ว */
export interface Principal {
  sub: string;
  team?: string;
  roles?: string[];
  ops: string[];
  cid: string;
  cor?: string;
}

export type VerifyResult =
  | { ok: true; principal: Principal }
  | { ok: false; reason: RejectReason };

export interface Jwk {
  kty?: string;
  n?: string;
  e?: string;
  kid?: string;
  alg?: string;
  use?: string;
}

export interface AdapterConfig {
  /** ผู้ออกโทเคนที่ยอมรับ ค่าเดียว */
  issuer: string;
  /**
   * audience ของ **connector ตัวนี้ตัวเดียว** ไม่ใช่ของ gateway
   *
   * adapter ที่รับ "โทเคนใดก็ได้ที่ออกโดย gateway" คือ adapter ที่ผิด
   */
  audience: string;
  getJwks: () => Jwks | Promise<Jwks>;
  /**
   * บอกความจริงว่าเก็บ `jti` ที่เคยเห็นหรือไม่
   *
   * ค่าเริ่มต้นเป็น false เพราะไฟล์นี้รันบน Worker ซึ่งมี isolate หลายตัวพร้อมกัน
   * แต่ละตัวมีหน่วยความจำของตัวเองและตายเมื่อไรก็ได้ โทเคนใบเดียวยิงสองครั้งอาจตก
   * คนละ isolate แล้วผ่านทั้งสองครั้ง
   *
   * สัญญาเขียนไว้ตรง ๆ ว่า `trackJti: true` ที่ผิด แย่กว่า `trackJti: false` ที่ถูก
   * เพราะอย่างหลังบอกความจริงแล้วทะเบียนบันทึกข้อจำกัดไว้ อย่างแรกทำให้ทุกคนเชื่อว่า
   * กัน replay อยู่ — ถ้าจะเปิดข้อนี้ต้องใช้ KV หรือ Durable Object ไม่ใช่ Set ในหน่วยความจำ
   */
  trackJti?: boolean;
  /**
   * connector ที่ `cid` ต้องตรงกับ — **ค่าบังคับ**
   *
   * รอบแรกไฟล์นี้แกะเอาจากส่วนท้ายของ `audience` เพราะ harness ส่ง config มาสี่ค่า
   * ซึ่งผ่านชุดทดสอบ แต่อ่อนกว่าที่ควร และฝั่ง gateway แก้ harness ให้ส่งค่าที่ห้ามาแล้ว
   *
   * เหตุผลที่การแกะเองอ่อนกว่า — มันเปลี่ยนด่านนี้จาก "cid ตรงกับ connector ที่ประกาศ
   * ไว้ไหม" เป็น "cid ตรงกับส่วนท้ายของ audience ไหม" ซึ่งสองอย่างนี้เท่ากันเฉพาะ
   * ตอนที่ audience สะกดตามรูปที่เราเดา สัญญาไม่ได้รับประกันรูปนั้น ถ้าวันหนึ่ง
   * audience ของจริงเป็นรูปอื่น ด่านนี้จะยังเขียวโดยที่เทียบคนละเรื่องกับที่ตั้งใจ
   *
   * ทำเป็นค่าบังคับแทนที่จะเป็น optional ที่มีค่าสำรอง เพราะค่าสำรองที่ผิดเงียบ ๆ
   * แย่กว่าการบังคับให้คนตั้งค่าเพิ่มหนึ่งตัว
   */
  connectorId: string;
  /**
   * กุญแจที่ตั้งไว้มาจากไหน — `"fixture"` คือชุด vector สาธารณะ
   *
   * โทเคนในชุดนั้นมี `exp` ไกลถึงปี 2100 และอยู่ในรีโปสาธารณะ ใครอ่านรีโปแล้วหยิบ
   * ไปยิงใส่ deployment ที่ตั้งกุญแจชุดนั้นได้ทันที — ยอมรับได้เฉพาะ deployment
   * ทดสอบที่ไม่มีข้อมูลจริง และต้องประกาศตัว ไม่ใช่ตั้งไปเงียบ ๆ
   */
  jwksSource?: "fixture" | "gateway";
  /** นาฬิกา แยกออกมาให้เทสต์เดินเวลาได้ */
  now?: () => number;
}

export interface Jwks {
  keys?: Jwk[];
}

export interface UpstreamAdapter {
  verify(token: string, ctx: { operation?: string }): Promise<VerifyResult>;
  /** ประกาศข้อจำกัดของตัวเอง ให้ทะเบียนฝั่ง gateway อ่านได้โดยไม่ต้องเชื่อคำบรรยาย */
  readonly limitations: readonly string[];
}

const deny = (reason: RejectReason): VerifyResult => ({ ok: false, reason });

/** ถอด base64url เป็นไบต์ — `atob` ไม่รู้จัก `-` `_` และไม่ยอมให้ขาด padding */
function fromBase64Url(value: string): Uint8Array | undefined {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

function jsonSegment(segment: string): Record<string, unknown> | undefined {
  const bytes = fromBase64Url(segment);
  if (!bytes) return undefined;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function createAdapter(config: AdapterConfig): UpstreamAdapter {
  const expectedCid = config.connectorId;
  const clock = config.now ?? (() => Date.now());
  const trackJti = config.trackJti === true;
  // เก็บเฉพาะเมื่อผู้เรียกยืนยันว่าจะเก็บ และรู้ตัวว่าใช้ได้เฉพาะโพรเซสเดียว
  const seenJti = new Set<string>();

  const limitations = [
    ...(trackJti ? [] : ["jti_replay_not_tracked"]),
    "jwks_pinned_not_fetched",
    ...(config.jwksSource === "fixture" ? ["jwks_is_public_test_fixture"] : []),
  ];

  async function verify(token: string, ctx: { operation?: string }): Promise<VerifyResult> {
    if (typeof token !== "string" || token === "") return deny("malformed_token");

    const parts = token.split(".");
    // อ่าน header ก่อนอย่างอื่นทั้งหมด เพราะข้อ 0 ของลำดับคือ `alg`
    const header = parts.length >= 2 ? jsonSegment(parts[0]!) : undefined;
    if (!header) return deny("malformed_token");

    // ข้อ 0 — ต้องมาก่อนการตรวจว่ามีลายเซ็นหรือไม่
    //
    // `alg:none` มักมาในรูป `header.payload.` คือลายเซ็นว่าง ถ้าตรวจ "ครบสามส่วนไหม"
    // ก่อน โทเคนนั้นจะตกด้วย `malformed_token` ซึ่งดูเหมือนปลอดภัย แต่แปลว่าเราไม่เคย
    // ตรวจ `alg` เลย แล้วโทเคน `alg:none` ที่ใส่ขยะเป็นลายเซ็นจะรอดด่านนี้ไปได้
    //
    // ฝั่ง gateway ตกข้อนี้ในการรันครั้งแรกของตัวเอง และมี vector สองตัวจับไว้
    if (header.alg !== "RS256") return deny("unsupported_alg");

    if (parts.length !== 3 || parts[2] === "") return deny("malformed_token");

    const payload = jsonSegment(parts[1]!);
    const signature = fromBase64Url(parts[2]!);
    if (!payload || !signature) return deny("malformed_token");

    // ข้อ 1 — `kid` ต้องมีใน JWKS แล้วลายเซ็นต้องถูก
    const jwks = await config.getJwks();
    const kid = typeof header.kid === "string" ? header.kid : undefined;
    const jwk = jwks.keys?.find((k) => k.kid === kid && (k.alg ?? "RS256") === "RS256");
    // กุญแจที่ขาด `n` หรือ `e` ใช้ตรวจอะไรไม่ได้ ถือเสมือนไม่มีกุญแจใบนั้น
    // ดีกว่าปล่อยให้ importKey โยนแล้วตกไปเป็น bad_signature ซึ่งชี้ผิดที่
    if (!jwk?.n || !jwk.e) return deny("unknown_kid");

    let signatureOk = false;
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: jwk.kty ?? "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      signatureOk = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        signature,
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
      );
    } catch {
      // กุญแจที่ import ไม่ได้ ถือว่าลายเซ็นตรวจไม่ผ่าน ไม่ใช่ปล่อยผ่าน
      signatureOk = false;
    }
    if (!signatureOk) return deny("bad_signature");

    // ข้อ 2
    if (payload.iss !== config.issuer) return deny("issuer_mismatch");

    // ข้อ 3 — `aud` ต้องเป็น **สตริง** และตรงตัว
    //
    // RFC 7519 ยอมให้ `aud` เป็น array และไลบรารี JWT มาตรฐานเกือบทุกภาษาตรวจแบบ
    // "มีค่าที่เราต้องการอยู่ในรายการไหม" ซึ่งเป็นพฤติกรรมเริ่มต้น ไม่ใช่ความสะเพร่า
    // ผลคือ `aud: [ของเรา, "mcp://gw/tenant/…"]` จะผ่าน ซึ่งคือ audience ระดับ tenant
    // ซ่อนอยู่ในรายการเดียวกับค่าที่ถูก — เป็นความล้มเหลวที่เป็นเหตุให้โปรเจกต์นั้นมีอยู่
    if (typeof payload.aud !== "string" || payload.aud !== config.audience) {
      return deny("audience_mismatch");
    }

    // ข้อ 3ข — เทียบสองทาง `cid` ต้องตรงกับ connector ที่ audience ชี้ถึง
    const cid = typeof payload.cid === "string" ? payload.cid : undefined;
    if (cid !== expectedCid) return deny("connector_mismatch");

    // ข้อ 4 — ไม่มี `exp` คือไม่ผ่าน ไม่ใช่ถือว่าไม่มีวันหมดอายุ
    const now = Math.floor(clock() / 1000);
    const exp = typeof payload.exp === "number" ? payload.exp : undefined;
    const nbf = typeof payload.nbf === "number" ? payload.nbf : undefined;
    if (nbf !== undefined && now < nbf) return deny("token_not_yet_valid");
    if (exp === undefined || now >= exp) return deny("token_expired");

    // ข้อ 5 — เก็บเฉพาะเมื่อประกาศว่าเก็บ
    const jti = typeof payload.jti === "string" ? payload.jti : undefined;
    if (trackJti) {
      if (!jti || seenJti.has(jti)) return deny("replayed_jti");
      seenJti.add(jti);
    }

    // ข้อ 6 — operation ของคำขอต้องอยู่ใน `ops`
    const ops = asStringArray(payload.ops);
    if (ctx.operation !== undefined && !ops.includes(ctx.operation)) {
      return deny("ops_not_permitted");
    }

    // ข้อ 7 — `sub` ต้องมีและไม่ว่าง
    //
    // ถ้าปล่อยผ่าน ตัวตนที่ map ต่อจะกลายเป็นค่าที่ไม่มีใครเป็นเจ้าของ ซึ่งคือ
    // shared identity กลับมาทางประตูหลัง
    const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (sub === "") return deny("subject_missing");

    return {
      ok: true,
      principal: {
        sub,
        ops,
        cid,
        ...(typeof payload.team === "string" ? { team: payload.team } : {}),
        ...(asStringArray(payload.roles).length ? { roles: asStringArray(payload.roles) } : {}),
        ...(typeof payload.cor === "string" ? { cor: payload.cor } : {}),
      },
    };
  }

  return { verify, limitations };
}
