import type { McpServer } from "@modelcontextprotocol/server";

/**
 * Tools the read-only route exposes. Deny-by-default: anything not on this list
 * is registered and then disabled, so a tool added to the workspace later is
 * unreachable on this route until someone puts it here on purpose.
 */
export const READ_ONLY_TOOLS: readonly string[] = [
  "get_workspace_context",
  "get_discussion",
  "get_tasks",
  "get_handoffs",
  "get_plans",
  "get_decisions",
];

/**
 * Wraps the server so every registration passes through the allowlist.
 *
 * Disabling rather than skipping registration buys both things the table asked
 * for at once: the SDK filters disabled tools out of `tools/list`, and a direct
 * `tools/call` on one answers `Tool <name> disabled` — an explicit refusal from
 * the server, not the `unknown tool` you would get by never registering it.
 */
export function withReadOnlyGuard(server: McpServer, allow: readonly string[] = READ_ONLY_TOOLS): McpServer {
  const allowed = new Set(allow);
  return new Proxy(server, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== "registerTool" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (name: string, ...rest: unknown[]) => {
        const registered = (value as (...a: unknown[]) => { disable?: () => void }).call(
          target,
          name,
          ...rest,
        );
        if (!allowed.has(name)) registered?.disable?.();
        return registered;
      };
    },
  });
}
