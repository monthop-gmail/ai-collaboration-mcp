import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "./env";
import { resolveAuthor, type StaticIdentity } from "./identity";
import {
  ACTIONABLE_HANDOFF_STATES,
  DECISION_STATUSES,
  STALE_AFTER_DAYS,
  TASK_STATUSES,
  acceptHandoff,
  createHandoff,
  createTask,
  getCurrentHandoffId,
  readDecisions,
  readPlans,
  recordPlan,
  resolveDecision,
  setDecisionScope,
  DECISION_SCOPES,
  type DecisionScope,
  readHandoffs,
  readTasks,
  recordDecision,
  updateTask,
  type DecisionStatus,
  type TaskStatus,
} from "./db-work";
import {
  ActingContext,
  Limit,
  Workspace,
  actedAs,
  crossTaskWarning,
  handoffReminder,
  registerTool,
  run,
  sharedIdentityNote,
  usedWorkspace,
} from "./tool-kit";

const Detail = z.string().describe("Full reasoning or context. Be specific — this is what a participant who was not present will read.");

/** tools ของ Phase 2 — สิ่งที่ตกผลึกจากการคุยแล้วต้องมีคนทำต่อ */
export function registerWorkTools(server: McpServer, env: Env, staticIdentity?: StaticIdentity): void {
  const author = () => resolveAuthor(staticIdentity, env.CLIENT_NAME_ALIASES);

  registerTool(
    server,
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
        const ws = usedWorkspace(workspace);
        const me = author();
        const decision = await recordDecision(
          env.DB,
          ws.id,
          title,
          detail,
          me,
          discussion_id,
        );
        return {
          decision_id: decision.id,
          status: decision.status,
          proposed_by: decision.proposed_by,
          workspace: ws.id,
          workspace_source: ws.source,
          ...(sharedIdentityNote(me.client)
            ? { identity_note: sharedIdentityNote(me.client) }
            : {}),
          note: "สถานะเป็น 'proposed' — ยังไม่มีใครอนุมัติ",
        };
      }),
  );

  registerTool(
    server,
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
          usedWorkspace(workspace).id,
          limit,
          status as DecisionStatus | undefined,
        );
        return { decisions: page.rows, has_more: page.has_more, total: page.total };
      }),
  );

  registerTool(
    server,
    "set_decision_scope",
    {
      description:
        "Mark an approved decision as a rule the whole workspace must follow, or " +
        "take that mark off. Rules marked this way are listed under " +
        "'standing_rules' in get_workspace_context, so nobody has to page through " +
        "every decision to find the ones that bind them. This ALWAYS requires the " +
        "server's approval code — closing a decision can be relayed, but marking " +
        "one as a rule binds people who were not in the room, so it cannot be. " +
        "Only 'approved' decisions can be marked. Who changed the scope and when " +
        "is recorded on the decision, for marking and for unmarking alike.",
      inputSchema: z.object({
        decision_id: z.string().min(1),
        scope: z
          .enum(DECISION_SCOPES)
          .describe(
            "'workspace' makes it a standing rule for everyone; 'project' is the " +
              "default and means it settles its own subject only.",
          ),
        approval_code: z
          .string()
          .min(1)
          .describe(
            "The server's approval code, handed to you by a person for this call. " +
              "There is no unverified path here — a wrong or missing code fails the " +
              "call and changes nothing.",
          ),
      }),
    },
    async ({ decision_id, scope, approval_code }) =>
      run(async () => {
        const decision = await setDecisionScope(
          env.DB,
          decision_id,
          scope as DecisionScope,
          author(),
          { code: approval_code, secret: env.APPROVAL_SECRET },
        );
        return {
          decision_id: decision.id,
          title: decision.title,
          scope: decision.scope,
          status: decision.status,
          standing_rule: decision.scope === "workspace",
          scope_set_by: decision.scope_set_by,
          scope_set_at: decision.scope_set_at,
        };
      }),
  );

  registerTool(
    server,
    "resolve_decision",
    {
      description:
        "Close a decision as approved or rejected — use this to settle which " +
        "proposal stands and to clear duplicates. A decision can only be closed " +
        "once. Who closed it and how strongly that is evidenced are recorded by " +
        "the server, not chosen by you.",
      inputSchema: z.object({
        decision_id: z.string().min(1),
        verdict: z
          .enum(["approved", "rejected"])
          .describe("'approved' means this one stands; 'rejected' retires it"),
        reason: z
          .string()
          .min(1)
          .describe("Why. Someone reading this next month needs it to make sense."),
        acting_context: ActingContext,
        superseded_by: z
          .string()
          .optional()
          .describe(
            "When rejecting something as a duplicate, the id of the decision that " +
              "stands in its place. Point at the one still in force — pointing at " +
              "another rejected decision is refused, because a reader following the " +
              "trail would never reach the real answer. Leave empty when rejecting " +
              "on merit with nothing replacing it.",
          ),
        approval_code: z
          .string()
          .optional()
          .describe(
            "Only if a person handed you the server's approval code. Do not guess " +
              "or reuse one — a wrong code fails the call instead of closing anything. " +
              "Without it the closure is recorded as relayed, which is fine.",
          ),
      }),
    },
    async ({ decision_id, verdict, reason, superseded_by, approval_code, acting_context }) =>
      run(async () => {
        const { decision, announced } = await resolveDecision(
          env.DB,
          decision_id,
          verdict,
          reason,
          author(),
          { code: approval_code, secret: env.APPROVAL_SECRET },
          superseded_by,
          acting_context,
        );
        return {
          decision_id: decision.id,
          status: decision.status,
          decided_by: decision.decided_by,
          decided_by_kind: decision.decided_by_kind,
          superseded_by: decision.superseded_by,
          // บริบทที่ประกาศตอนปิดใบ · คืนเสมอแม้เป็น null
          acting_context: decision.acting_context,
          announced_in_discussion: announced,
          note:
            decision.decided_by_kind === "human"
              ? "ยืนยันด้วยรหัสแล้ว บันทึกเป็นการตัดสินใจของคน"
              : "บันทึกเป็น relayed — เชื่อว่ามีคนสั่ง แต่ยังไม่มีอะไรยืนยัน",
        };
      }),
  );

  registerTool(
    server,
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
        const ws = usedWorkspace(workspace);
        const me = author();
        const plan = await recordPlan(env.DB, ws.id, title, body, me, {
          discussionId: discussion_id,
          decisionId: decision_id,
          supersedes,
        });
        return {
          plan_id: plan.id,
          created_by: plan.created_by,
          supersedes: plan.supersedes,
          workspace: ws.id,
          workspace_source: ws.source,
          ...(sharedIdentityNote(me.client)
            ? { identity_note: sharedIdentityNote(me.client) }
            : {}),
          note: "แผนแก้ไม่ได้ ถ้าเปลี่ยนให้บันทึกใหม่แล้วระบุ supersedes",
        };
      }),
  );

  registerTool(
    server,
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
        const page = await readPlans(env.DB, usedWorkspace(workspace).id, limit, {
          discussionId: discussion_id,
          includeSuperseded: include_superseded,
        });
        return { plans: page.rows, has_more: page.has_more, total: page.total };
      }),
  );

  registerTool(
    server,
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
        const ws = usedWorkspace(workspace);
        const me = author();
        const task = await createTask(
          env.DB,
          ws.id,
          title,
          detail,
          me,
          discussion_id,
          assigned_to,
        );
        return {
          task_id: task.id,
          status: task.status,
          assigned_to: task.assigned_to,
          created_by: task.created_by,
          workspace: ws.id,
          workspace_source: ws.source,
          ...(sharedIdentityNote(me.client)
            ? { identity_note: sharedIdentityNote(me.client) }
            : {}),
          // ระบุออกมาตรง ๆ ว่ายังไม่มี handoff เพื่อไม่ให้ผู้เรียกเล่าว่าส่งต่อแล้ว
          handoff: null,
          ...(handoffReminder(task.assigned_to)
            ? { note: handoffReminder(task.assigned_to) }
            : {}),
        };
      }),
  );

  registerTool(
    server,
    "update_task",
    {
      description:
        "Change a task's status, owner, detail, or result pointer. Pass at least " +
        "one of them. Your name is recorded as the one who made the change. " +
        "When you finish a task, set 'result_ref' as well as the status — a task " +
        "marked done with no pointer cannot be told apart from one whose result " +
        "was never written down.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        status: z.enum(TASK_STATUSES).optional(),
        assigned_to: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Change the owner. Records ownership only — not a handoff. Pass null " +
              "to leave the task with no owner.",
          ),
        detail: z.string().optional(),
        acting_context: ActingContext,
        result_ref: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Where the result of this work can be read — a discussion reference " +
              "like 'dis-xxxx#12', a URL, or a commit. This is a pointer, not the " +
              "result itself. Pass null to take an existing pointer off.",
          ),
      }),
    },
    async ({ task_id, status, assigned_to, detail, result_ref, acting_context }) =>
      run(async () => {
        const task = await updateTask(env.DB, task_id, author(), {
          status: status as TaskStatus | undefined,
          assigned_to,
          detail,
          result_ref,
          acting_context,
        });
        const crossTask = crossTaskWarning(
          task.title,
          task.assigned_to,
          task.updated_by,
          task.status,
        );
        return {
          task_id: task.id,
          // `title` อยู่ในผลลัพธ์เพราะ **ช่องนี้เป็นช่องเดียวที่บอกว่า "ใบไหน"**
          //
          // 27 ก.ย. มีการเขียนบันทึกผลของ ThaiACC ลงในใบของ CARE แล้วกดปิด ส่วนใบ
          // ThaiACC ตัวจริงยังเปิดอยู่ · ผู้เรียกไม่มีอะไรในผลลัพธ์ให้ทักตัวเองเลย
          // เพราะทุกช่องที่คืนกลับมาถูกต้องทั้งหมด — แค่เป็นของใบอื่น
          //
          // เซิร์ฟเวอร์ตรวจแทนไม่ได้ว่าเนื้อหาเข้ากับใบไหม (ดู `crossTaskWarning`)
          // สิ่งที่ทำได้คือ **คืนชื่อใบมาให้เห็น** แล้วผู้เรียกจับได้เอง
          title: task.title,
          status: task.status,
          assigned_to: task.assigned_to,
          updated_by: task.updated_by,
          acted_as: actedAs(task.assigned_to, task.updated_by, task.acting_context),
          updated_at: task.updated_at,
          // คืนเสมอ แม้เป็น null — ผู้เรียกต้องแยก *ยังไม่มีใครบันทึกตัวชี้* ออกจาก
          // *ระบบไม่เก็บช่องนี้* ได้จากผลลัพธ์เดียว
          result_ref: task.result_ref,
          // เช่นเดียวกับ create_task — บอกตรง ๆ ว่ามี handoff รออยู่หรือไม่ ไม่ใช่เงียบ
          handoff: await getCurrentHandoffId(env.DB, task.id),
          // เตือนเฉพาะตอนที่ผู้เรียกเปลี่ยนผู้รับผิดชอบเองในคำสั่งนี้
          ...(assigned_to != null && handoffReminder(assigned_to)
            ? { note: handoffReminder(assigned_to) }
            : {}),
          // แยกช่องจาก `note` โดยตั้งใจ — สองอย่างนี้เตือนคนละเรื่องและเกิดพร้อมกันได้
          // ใช้ช่องเดียวกันแล้วอันหนึ่งจะกลบอีกอันเงียบ ๆ
          ...(crossTask ? { cross_task_warning: crossTask } : {}),
        };
      }),
  );

  registerTool(
    server,
    "get_tasks",
    {
      description:
        "List tasks in the workspace, newest first. Filter by status or owner to " +
        "find what is still open or what is yours. Each row carries 'handoff': the " +
        "id of the handoff still waiting to be accepted, or null when nobody has " +
        "been handed this work — an owner alone does not mean it was handed over.",
      inputSchema: z.object({
        workspace: Workspace,
        status: z.enum(TASK_STATUSES).optional(),
        assigned_to: z.string().optional().describe("Filter to one owner"),
        limit: Limit,
      }),
    },
    async ({ workspace, status, assigned_to, limit }) =>
      run(async () => {
        const page = await readTasks(env.DB, usedWorkspace(workspace).id, limit, {
          status: status as TaskStatus | undefined,
          assigned_to,
        });
        return { tasks: page.rows, has_more: page.has_more, total: page.total };
      }),
  );

  registerTool(
    server,
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
          .describe(
            // สองกรณีเพราะ handoff มีสองแบบจริง — ส่งต่องานที่ทำค้างไว้ กับมอบงานใหม่
            // พร้อมโจทย์ ถ้อยคำเดิมครอบแต่แบบแรก ทำให้ handoff ที่ดีที่สุดที่ระบบเคยมี
            // (ho-932138dd) สอบตกทั้งที่ผู้รับเองยกว่าเป็นตัวอย่างที่ดี — ข้อสังเกตจาก
            // monthop-gmail/agent-platform ใน dis-96c2a3fa seq 7 ซึ่งเป็นผู้รับใบนั้น
            "For work already under way: what you did, what remains, and anything " +
              "that blocked you. For work that starts here: where the context lives, " +
              "what angle you want, what is out of scope this round, and where the " +
              "result should go.",
          ),
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

  registerTool(
    server,
    "get_handoffs",
    {
      description:
        "List handoffs in the workspace, newest first. Call this when you join to " +
        "see whether work is waiting for you. Defaults to pending ones only. Each " +
        "row carries a 'state': 'waiting' still needs someone to accept it, " +
        "'stale' has been waiting over " +
        `${STALE_AFTER_DAYS} days and needs a decision rather than more waiting, ` +
        "'superseded' was replaced by a newer handoff on the same task, and " +
        "'obsolete' points at a task that is already done — the last two need no " +
        "one to accept them.",
      inputSchema: z.object({
        workspace: Workspace,
        status: z
          .enum(["pending", "accepted"])
          .default("pending")
          .describe("Which handoffs to show"),
        to: z.string().optional().describe("Filter to handoffs aimed at this name"),
        task_id: z.string().optional().describe("Filter to one task"),
        limit: Limit,
      }),
    },
    async ({ workspace, status, to, task_id, limit }) =>
      run(async () => {
        const page = await readHandoffs(env.DB, usedWorkspace(workspace).id, limit, {
          status,
          to_whom: to,
          task_id,
        });
        const inactive = page.rows.filter(
          (h) => !ACTIONABLE_HANDOFF_STATES.includes(h.state) && h.status === "pending",
        );
        return {
          handoffs: page.rows,
          has_more: page.has_more,
          total: page.total,
          ...(inactive.length > 0
            ? {
                note:
                  `${inactive.length} of these are still 'pending' but no longer need ` +
                  "accepting (superseded or obsolete). Close the loop by finishing or " +
                  "reassigning the task they point at, not by accepting them.",
              }
            : {}),
        };
      }),
  );

  registerTool(
    server,
    "accept_handoff",
    {
      description:
        "Take on a handed-over task. Records you as the one who accepted it and " +
        "moves the task to 'in_progress' — EXCEPT when the task is 'blocked', " +
        "which is left as it is, because accepting a handoff says who is holding " +
        "the task, not that the blocker is gone. Read 'task_status_source' to see " +
        "which happened: 'accept' means this call moved it, 'unchanged' means it " +
        "kept the status it already had, and you must call update_task yourself " +
        "once the blocker is actually cleared. You are identified by your " +
        "connection, so you cannot accept on someone else's behalf.",
      inputSchema: z.object({
        handoff_id: z.string().min(1),
        acting_context: ActingContext,
      }),
    },
    async ({ handoff_id, acting_context }) =>
      run(async () => {
        const { handoff, task, taskStatusKept } = await acceptHandoff(
          env.DB,
          handoff_id,
          author(),
          acting_context,
        );
        return {
          handoff_id: handoff.id,
          accepted_by: handoff.accepted_by,
          task_id: task.id,
          // เหตุผลเดียวกับ `update_task` — ผู้รับควรเห็นว่ารับใบไหนไว้ ไม่ใช่แค่รหัส
          task_title: task.title,
          task_status: task.status,
          // มีเสมอทั้งสองกรณี — ผู้อ่านต้องแยก *การรับใบเลื่อนสถานะให้* ออกจาก
          // *สถานะเดิมถูกเก็บไว้* ได้จากผลลัพธ์เดียว ไม่ใช่จากการเดาว่าทำไมยังเป็น blocked
          task_status_source: taskStatusKept ? "unchanged" : "accept",
          task_status_note: taskStatusKept
            ? "ใบนี้เป็น blocked อยู่ การรับใบไม่เลื่อนสถานะให้ เพราะการรับบอกว่าใครถือ " +
              "ไม่ใช่ว่าตัวที่บล็อกหายไปแล้ว — ปลดได้แล้วค่อยเรียก update_task เอง"
            : "การรับใบเลื่อนสถานะเป็น in_progress ให้แล้ว",
          task_assigned_to: task.assigned_to,
          acted_as: actedAs(handoff.to_whom, handoff.accepted_by, handoff.acting_context),
        };
      }),
  );
}
