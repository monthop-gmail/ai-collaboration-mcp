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
import { Limit, Workspace, run } from "./tool-kit";
import { readOpenItems } from "./db-work";
import { registerWorkTools } from "./tools-work";

const Kind = z
  .enum(MESSAGE_KINDS)
  .describe(
    "What this message is: 'proposal' puts an idea forward, 'review' judges " +
      "someone else's, 'question' asks for input, 'note' records context. " +
      "Pick the one that matches your intent — other participants filter on it.",
  );

export function registerTools(server: McpServer, env: Env, staticIdentity?: StaticIdentity): void {
  const author = () => resolveAuthor(staticIdentity, env.CLIENT_NAME_ALIASES);

  registerWorkTools(server, env, staticIdentity);

  server.registerTool(
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
        const discussion = await createDiscussion(env.DB, workspace, title, me);
        const opening =
          body === undefined
            ? undefined
            : await postMessage(env.DB, discussion.id, kind, body, me);

        return {
          discussion_id: discussion.id,
          workspace: discussion.workspace_id,
          title: discussion.title,
          created_by: discussion.created_by,
          opening_message: opening ? { seq: opening.seq, kind: opening.kind } : null,
        };
      }),
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "get_workspace_context",
    {
      description:
        "Catch up on the workspace without reading every discussion. Returns the " +
        "discussions, who has taken part, what is still open, and — under " +
        "'waiting_for_you' — the handoffs and tasks addressed to you by name. " +
        "Call this first when you join: it is cheaper than reading threads and it " +
        "is the only place work aimed at you shows up on its own.",
      inputSchema: z.object({
        workspace: Workspace,
        limit: Limit,
      }),
    },
    async ({ workspace, limit }) =>
      run(async () => {
        const me = author();
        const [context, openItems] = await Promise.all([
          readWorkspaceContext(env.DB, workspace, limit),
          readOpenItems(env.DB, workspace, me.name),
        ]);

        return {
          workspace: context.workspace,
          you_are: me.name,
          participants: context.participants,
          open_items: openItems,
          discussions: context.discussions,
          has_more: context.has_more,
          total_discussions: context.total_discussions,
        };
      }),
  );
}
