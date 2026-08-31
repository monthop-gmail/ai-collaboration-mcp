import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "./env";
import { resolveAuthor, type StaticIdentity } from "./identity";
import {
  DECISION_STATUSES,
  TASK_STATUSES,
  acceptHandoff,
  createHandoff,
  createTask,
  readDecisions,
  readPlans,
  recordPlan,
  readHandoffs,
  readTasks,
  recordDecision,
  updateTask,
  type DecisionStatus,
  type TaskStatus,
} from "./db-work";
import { Limit, Workspace, handoffReminder, run } from "./tool-kit";

const Detail = z.string().describe("Full reasoning or context. Be specific — this is what a participant who was not present will read.");

/** tools ของ Phase 2 — สิ่งที่ตกผลึกจากการคุยแล้วต้องมีคนทำต่อ */
export function registerWorkTools(server: McpServer, env: Env, staticIdentity?: StaticIdentity): void {
  const author = () => resolveAuthor(staticIdentity, env.CLIENT_NAME_ALIASES);

  server.registerTool(
    "record_decision",
    {
      description:
        "Record a conclusion the group has reached, so it survives outside the " +
        "thread. Recorded as 'proposed' — this tool cannot mark anything approved, " +
        "because proposing is not deciding. A human approves separately.",
      inputSchema: z.object({
        title: z.string().min(1).describe("The decision in one line"),
        detail: Detail,
        workspace: Workspace,
        discussion_id: z
          .string()
          .optional()
          .describe("Discussion this came out of, if any"),
      }),
    },
    async ({ title, detail, workspace, discussion_id }) =>
      run(async () => {
        const decision = await recordDecision(
          env.DB,
          workspace,
          title,
          detail,
          author(),
          discussion_id,
        );
        return {
          decision_id: decision.id,
          status: decision.status,
          proposed_by: decision.proposed_by,
          note: "สถานะเป็น 'proposed' — ยังไม่มีใครอนุมัติ",
        };
      }),
  );

  server.registerTool(
    "get_decisions",
    {
      description:
        "List decisions in the workspace, newest first. Check this before " +
        "reopening a settled question. 'proposed' means it is still awaiting a human.",
      inputSchema: z.object({
        workspace: Workspace,
        status: z.enum(DECISION_STATUSES).optional().describe("Filter by status"),
        limit: Limit,
      }),
    },
    async ({ workspace, status, limit }) =>
      run(async () => {
        const page = await readDecisions(
          env.DB,
          workspace,
          limit,
          status as DecisionStatus | undefined,
        );
        return { decisions: page.rows, has_more: page.has_more, total: page.total };
      }),
  );

  server.registerTool(
    "record_plan",
    {
      description:
        "Write down how the group intends to carry something out, so it can be " +
        "found without reading the whole thread. Plans cannot be edited — if the " +
        "approach changes, record a new one and set 'supersedes' to the old id.",
      inputSchema: z.object({
        title: z.string().min(1).describe("The plan in one line"),
        body: z
          .string()
          .min(1)
          .describe("The steps, in enough detail that someone else can act on them"),
        workspace: Workspace,
        discussion_id: z.string().optional().describe("Discussion this came out of"),
        decision_id: z.string().optional().describe("Decision this carries out"),
        supersedes: z
          .string()
          .optional()
          .describe("Id of the plan this replaces. The old one stops showing in get_plans."),
      }),
    },
    async ({ title, body, workspace, discussion_id, decision_id, supersedes }) =>
      run(async () => {
        const plan = await recordPlan(env.DB, workspace, title, body, author(), {
          discussionId: discussion_id,
          decisionId: decision_id,
          supersedes,
        });
        return {
          plan_id: plan.id,
          created_by: plan.created_by,
          supersedes: plan.supersedes,
          note: "แผนแก้ไม่ได้ ถ้าเปลี่ยนให้บันทึกใหม่แล้วระบุ supersedes",
        };
      }),
  );

  server.registerTool(
    "get_plans",
    {
      description:
        "List the plans in force, newest first. Superseded plans are hidden " +
        "unless you ask for them. Read this before planning something yourself — " +
        "someone may already have.",
      inputSchema: z.object({
        workspace: Workspace,
        discussion_id: z.string().optional().describe("Only plans from this discussion"),
        include_superseded: z
          .boolean()
          .default(false)
          .describe("Include plans that have been replaced"),
        limit: Limit,
      }),
    },
    async ({ workspace, discussion_id, include_superseded, limit }) =>
      run(async () => {
        const page = await readPlans(env.DB, workspace, limit, {
          discussionId: discussion_id,
          includeSuperseded: include_superseded,
        });
        return { plans: page.rows, has_more: page.has_more, total: page.total };
      }),
  );

  server.registerTool(
    "create_task",
    {
      description:
        "Turn something the group agreed on into work with an owner. Starts as " +
        "'open'. Link it to the discussion it came from so whoever picks it up " +
        "can read the reasoning.",
      inputSchema: z.object({
        title: z.string().min(1).describe("What needs doing, in one line"),
        detail: Detail.default(""),
        workspace: Workspace,
        discussion_id: z.string().optional().describe("Discussion this came out of"),
        assigned_to: z
          .string()
          .optional()
          .describe(
            "Who should do it, if that is already settled. This records ownership " +
              "only — it is NOT a handoff and sends them no context. To hand work " +
              "over, create the task and then call create_handoff.",
          ),
      }),
    },
    async ({ title, detail, workspace, discussion_id, assigned_to }) =>
      run(async () => {
        const task = await createTask(
          env.DB,
          workspace,
          title,
          detail,
          author(),
          discussion_id,
          assigned_to,
        );
        return {
          task_id: task.id,
          status: task.status,
          assigned_to: task.assigned_to,
          created_by: task.created_by,
          // ระบุออกมาตรง ๆ ว่ายังไม่มี handoff เพื่อไม่ให้ผู้เรียกเล่าว่าส่งต่อแล้ว
          handoff: null,
          ...(handoffReminder(task.assigned_to)
            ? { note: handoffReminder(task.assigned_to) }
            : {}),
        };
      }),
  );

  server.registerTool(
    "update_task",
    {
      description:
        "Change a task's status, owner, or detail. Pass at least one of them. " +
        "Your name is recorded as the one who made the change.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        status: z.enum(TASK_STATUSES).optional(),
        assigned_to: z
          .string()
          .optional()
          .describe("Change the owner. Records ownership only — not a handoff."),
        detail: z.string().optional(),
      }),
    },
    async ({ task_id, status, assigned_to, detail }) =>
      run(async () => {
        const task = await updateTask(env.DB, task_id, author(), {
          status: status as TaskStatus | undefined,
          assigned_to,
          detail,
        });
        return {
          task_id: task.id,
          status: task.status,
          assigned_to: task.assigned_to,
          updated_by: task.updated_by,
          updated_at: task.updated_at,
          // เตือนเฉพาะตอนที่ผู้เรียกเปลี่ยนผู้รับผิดชอบเองในคำสั่งนี้
          ...(assigned_to !== undefined && handoffReminder(assigned_to)
            ? { note: handoffReminder(assigned_to) }
            : {}),
        };
      }),
  );

  server.registerTool(
    "get_tasks",
    {
      description:
        "List tasks in the workspace, newest first. Filter by status or owner to " +
        "find what is still open or what is yours.",
      inputSchema: z.object({
        workspace: Workspace,
        status: z.enum(TASK_STATUSES).optional(),
        assigned_to: z.string().optional().describe("Filter to one owner"),
        limit: Limit,
      }),
    },
    async ({ workspace, status, assigned_to, limit }) =>
      run(async () => {
        const page = await readTasks(env.DB, workspace, limit, {
          status: status as TaskStatus | undefined,
          assigned_to,
        });
        return { tasks: page.rows, has_more: page.has_more, total: page.total };
      }),
  );

  server.registerTool(
    "create_handoff",
    {
      description:
        "Hand a task to someone else along with what you did, what is left, and " +
        "where you got stuck. This also reassigns the task. Use it instead of " +
        "silently reassigning — the context is the part that matters.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        to: z
          .string()
          .min(1)
          .describe("Who should pick this up. Free text — they need not be connected yet."),
        context: z
          .string()
          .min(1)
          .describe("What you did, what remains, and anything that blocked you"),
      }),
    },
    async ({ task_id, to, context }) =>
      run(async () => {
        const { handoff, task } = await createHandoff(
          env.DB,
          task_id,
          to,
          context,
          author(),
        );
        return {
          handoff_id: handoff.id,
          task_id: task.id,
          to: handoff.to_whom,
          from: handoff.from_name,
          task_assigned_to: task.assigned_to,
          status: handoff.status,
        };
      }),
  );

  server.registerTool(
    "get_handoffs",
    {
      description:
        "List handoffs, newest first. Call this when you join to see whether work " +
        "is waiting for you. Defaults to pending ones only.",
      inputSchema: z.object({
        status: z
          .enum(["pending", "accepted"])
          .default("pending")
          .describe("Which handoffs to show"),
        to: z.string().optional().describe("Filter to handoffs aimed at this name"),
        task_id: z.string().optional().describe("Filter to one task"),
        limit: Limit,
      }),
    },
    async ({ status, to, task_id, limit }) =>
      run(async () => {
        const page = await readHandoffs(env.DB, limit, {
          status,
          to_whom: to,
          task_id,
        });
        return { handoffs: page.rows, has_more: page.has_more, total: page.total };
      }),
  );

  server.registerTool(
    "accept_handoff",
    {
      description:
        "Take on a handed-over task. Records you as the one who accepted it and " +
        "moves the task to 'in_progress'. You are identified by your connection, " +
        "so you cannot accept on someone else's behalf.",
      inputSchema: z.object({ handoff_id: z.string().min(1) }),
    },
    async ({ handoff_id }) =>
      run(async () => {
        const { handoff, task } = await acceptHandoff(env.DB, handoff_id, author());
        return {
          handoff_id: handoff.id,
          accepted_by: handoff.accepted_by,
          task_id: task.id,
          task_status: task.status,
          task_assigned_to: task.assigned_to,
        };
      }),
  );
}
