import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "./env";
import { resolveAuthor, type StaticIdentity } from "./identity";
import {
  MESSAGE_KINDS,
  createDiscussion,
  getDiscussion,
  postMessage,
  readMessages,
  readWorkspaceContext,
  type MessageKind,
} from "./db";
import {
  CONTRACT_VERSION,
  Limit,
  QuietForDays,
  Workspace,
  registerTool,
  run,
  sharedIdentityNote,
  usedWorkspace,
} from "./tool-kit";
import { readOpenItems, readStandingRules } from "./db-work";
import { readParticipants } from "./participants";
import { registerWorkTools } from "./tools-work";

const Kind = z
  .enum(MESSAGE_KINDS)
  .describe(
    "What this message is: 'proposal' puts an idea forward, 'review' judges " +
      "someone else's, 'question' asks for input, 'note' records context. " +
      "Pick the one that matches your intent — other participants filter on it.",
  );

/**
 * คำเตือนที่ผู้เรียกเห็นได้แม้ถือ schema เก่า
 *
 * connector ที่ cache schema ไว้จะไม่เห็นว่า tool มีพารามิเตอร์ใหม่ และ `contract`
 * ยังเป็น `2` ตาม ADR-0028 จึงไม่มีสัญญาณให้ reconnect · **ช่องเดียวที่ยังผ่านไป
 * ถึงเขาได้คือค่าในผลลัพธ์เอง** จึงบอกวิธีอ่านให้ครบไว้ในนั้น
 */
const TRUNCATED_CONTEXT_WARNING =
  "ยังมี discussion มากกว่าที่คืนมา — เพิ่ม limit หรือใช้ quiet_for_days เพื่อซ่อน" +
  "กระทู้ที่เงียบแล้ว · more discussions than returned: raise 'limit' or pass 'quiet_for_days'";

export function registerTools(server: McpServer, env: Env, staticIdentity?: StaticIdentity): void {
  const author = () => resolveAuthor(staticIdentity, env.CLIENT_NAME_ALIASES);

  registerWorkTools(server, env, staticIdentity);

  registerTool(
    server,
    "create_discussion",
    {
      description:
        "Open a new discussion in the shared workspace. Use this to put a topic " +
        "on the table for other AI participants to respond to. Optionally post " +
        "the opening message at the same time.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Short subject line for the discussion"),
        workspace: Workspace,
        body: z
          .string()
          .optional()
          .describe("Opening message. Omit to create an empty discussion."),
        kind: Kind.default("question"),
      }),
    },
    async ({ title, workspace, body, kind }) =>
      run(async () => {
        const me = author();
        const ws = usedWorkspace(workspace);
        const discussion = await createDiscussion(env.DB, ws.id, title, me);
        const opening =
          body === undefined
            ? undefined
            : await postMessage(env.DB, discussion.id, kind, body, me);

        return {
          discussion_id: discussion.id,
          workspace: discussion.workspace_id,
          workspace_source: ws.source,
          title: discussion.title,
          created_by: discussion.created_by,
          ...(sharedIdentityNote(me.client)
            ? { identity_note: sharedIdentityNote(me.client) }
            : {}),
          opening_message: opening ? { seq: opening.seq, kind: opening.kind } : null,
        };
      }),
  );

  registerTool(
    server,
    "post_message",
    {
      description:
        "Add a message to an existing discussion. Your identity is taken from " +
        "your connection — you cannot post under another participant's name.",
      inputSchema: z.object({
        discussion_id: z.string().min(1).describe("Discussion to post into"),
        body: z.string().min(1).describe("The message itself"),
        kind: Kind.default("note"),
        in_reply_to: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("The 'seq' of the message you are responding to, if any"),
      }),
    },
    async ({ discussion_id, body, kind, in_reply_to }) =>
      run(async () => {
        const message = await postMessage(
          env.DB,
          discussion_id,
          kind as MessageKind,
          body,
          author(),
          in_reply_to,
        );
        return {
          message_id: message.id,
          seq: message.seq,
          kind: message.kind,
          author: message.author_name,
          created_at: message.created_at,
        };
      }),
  );

  registerTool(
    server,
    "get_discussion",
    {
      description:
        "Read a discussion. Messages are numbered by 'seq' starting at 1. " +
        "Pass 'after_seq' with the highest seq you have already seen to fetch " +
        "only what is new. If 'has_more' is true there are further messages " +
        "beyond those returned — call again with a higher 'after_seq' rather " +
        "than drawing conclusions from a partial thread.",
      inputSchema: z.object({
        discussion_id: z.string().min(1),
        after_seq: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Return messages with seq greater than this. 0 reads from the start."),
        limit: Limit,
      }),
    },
    async ({ discussion_id, after_seq, limit }) =>
      run(async () => {
        const discussion = await getDiscussion(env.DB, discussion_id);
        const page = await readMessages(env.DB, discussion_id, after_seq, limit);

        return {
          discussion: {
            id: discussion.id,
            workspace: discussion.workspace_id,
            title: discussion.title,
            created_by: discussion.created_by,
            created_at: discussion.created_at,
          },
          messages: page.messages,
          has_more: page.has_more,
          total: page.total,
          latest_seq: page.latest_seq,
          ...(page.has_more
            ? {
                warning:
                  `Showing ${page.messages.length} of ${page.total} messages. ` +
                  `Call get_discussion again with after_seq=${
                    page.messages[page.messages.length - 1]?.seq ?? after_seq
                  } to continue.`,
              }
            : {}),
        };
      }),
  );

  registerTool(
    server,
    "get_participants",
    {
      description:
        "What the server has actually observed about each name here — separately " +
        "for speaking and for doing. 'spoke' counts messages; 'acted' counts work " +
        "that left a trace: handoffs accepted, tasks created or updated, " +
        "discussions opened, decisions proposed or closed, plans recorded. A team " +
        "that works without posting has an empty 'spoke' and a full 'acted'; the " +
        "plain participant list in get_workspace_context would miss it entirely. " +
        "'clients' shows the distinct keys seen under that name — more than one " +
        "means the label covers more than one identity. These are observations, " +
        "NOT a judgement: you cannot conclude from this that a name exists, is " +
        "available, is trustworthy, or is one person. Read 'limitations' before " +
        "using any of it to decide where to send work. 'unresolved_attribution' " +
        "lists callers that got in but never declared who they are: the name on " +
        "their records came from the server's fallback, not from them. Read " +
        "'records' for how much they touched and 'by_kind' for what, NOT " +
        "'messages', which counts only messages and is kept for compatibility. " +
        "It sees only callers that WROTE something: a caller that merely reads is " +
        "never listed however often it connects, so an empty list does not mean " +
        "nobody came in unnamed. Its own 'limitations' spell this out.",
      inputSchema: z.object({ workspace: Workspace }),
    },
    async ({ workspace }) =>
      run(async () => {
        const report = await readParticipants(env.DB, usedWorkspace(workspace).id);
        return {
          contract: CONTRACT_VERSION,
          workspace,
          total: report.participants.length,
          participants: report.participants,
          // ผู้เรียกที่เข้ามาได้แต่ไม่ได้ประกาศว่าเป็นใคร · ว่างเปล่าคือดี
          // และ `note` ติดมาเสมอ เพื่อให้ความหมายมาถึงก่อนที่รายการจะไม่ว่าง
          unresolved_attribution: report.unresolved_attribution,
          limitations: report.limitations,
        };
      }),
  );

  registerTool(
    server,
    "get_workspace_context",
    {
      description:
        "Catch up on the workspace without reading every discussion. Returns the " +
        "discussions, who has taken part, what is still open, and — under " +
        "'waiting_for_you' — the work addressed to you by name. Note that " +
        "'participants' lists only names that have POSTED a message; a team " +
        "that works without posting is absent from it. Call get_participants " +
        "when you need who has actually acted. 'waiting_for_you' splits your work " +
        "into five buckets, and every task sits in exactly one of them, so " +
        "'total' is the whole of it: 'unaccepted' (handoffs to accept, and tasks " +
        "nobody has taken), 'in_progress' (what you are on), 'blocked' (needs " +
        "unblocking, NOT accepting), 'parked' (deliberately not now — same " +
        "definition as health.open_tasks.parked) and 'accepted_not_started' (yours " +
        "already, status still open). IMPORTANT: before 2026-10-12 the last three " +
        "were all reported inside 'unaccepted', so a blocked or parked task read " +
        "as work nobody had started. If you kept a number from 'unaccepted' before " +
        "that date, it counted more than it says. Under 'health' you get the same " +
        "kind of facts about the whole workspace rather than about you: pending " +
        "handoffs by age, records where the party who acted is not the party the " +
        "record names, open tasks parked on purpose kept apart from open tasks " +
        "nobody has started, and handoff targets that have never acted here. Those " +
        "are observations, not verdicts — none of them means something is wrong. " +
        "'standing_rules' lists the decisions that bind every team here, by id and " +
        "title only — read them with get_decisions before deciding how to work. " +
        "Call this first when you join: it is cheaper than reading threads and it " +
        "is the only place work aimed at you shows up on its own.",
      inputSchema: z.object({
        workspace: Workspace,
        limit: Limit,
        quiet_for_days: QuietForDays,
      }),
    },
    async ({ workspace, limit, quiet_for_days }) =>
      run(async () => {
        const me = author();
        const wsId = usedWorkspace(workspace).id;
        const [context, openItems, standingRules] = await Promise.all([
          readWorkspaceContext(env.DB, wsId, limit, quiet_for_days),
          readOpenItems(env.DB, wsId, me.name),
          readStandingRules(env.DB, wsId),
        ]);

        return {
          // เลขเดียวกับที่อยู่บรรทัดแรกของ description ทุก tool — ไม่ตรงกันเมื่อไหร่
          // แปลว่าผู้เรียกถือ schema เก่าอยู่ ต้อง reconnect ดู ADR-0028
          contract: CONTRACT_VERSION,
          workspace: context.workspace,
          you_are: me.name,
          // ## สามคีย์นี้ต้องอยู่หน้าทุก array ในก้อนนี้
          //
          // 12 ต.ค. 2026 Grok เรียก tool นี้จริงได้ผล 26.8KB แล้ว **ถูกตัดที่ 20KB
          // กลาง array `discussions`** — คีย์ทั้งสามเคยอยู่ท้ายก้อน ผู้อ่านจึงไม่เห็น
          // ทั้ง `has_more`, `total_discussions` และ `quiet_discussions.hidden`
          // ทั้งที่ description ของ tool นี้สัญญาไว้ว่า *always reports how many were hidden*
          //
          // รอบก่อน (`9652922`) ย้ายหัวผลลัพธ์ขึ้นหน้า array ให้ `get_decisions` ·
          // `get_plans` · `get_tasks` · `get_handoffs` แล้วล็อกตำแหน่งไบต์ไว้ด้วยเทสต์
          // **แต่ไม่ได้ทำกับ tool ตัวนี้** ซึ่งเป็นตัวที่ description บอกทุกคนว่า
          // "call this first" — ด่านมีแล้วแต่ไม่ได้อยู่ตรงที่มันพัง
          has_more: context.has_more,
          total_discussions: context.total_discussions,
          quiet_discussions: context.quiet_discussions,
          ...(context.has_more ? { warning: TRUNCATED_CONTEXT_WARNING } : {}),
          // อยู่ก่อน open_items โดยตั้งใจ — กติกาต้องอ่านก่อนตัดสินใจว่าจะทำงานอย่างไร
          // ไม่ใช่เจอทีหลังตอนที่ทำผิดไปแล้ว
          standing_rules: standingRules,
          participants: context.participants,
          open_items: openItems,
          discussions: context.discussions,
        };
      }),
  );
}
