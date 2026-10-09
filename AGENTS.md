# AGENTS.md: ai-collaboration-mcp

> Base rules for all repos: `AGENTS.base.md` in the central org knowledge standard (a private repo; ask the owner for access).
> **This repo's own rules are in [`CLAUDE.md`](CLAUDE.md), and they apply to every AI agent, not only Claude.** Where CLAUDE.md and the base rules differ, CLAUDE.md wins for this repo.
> Metadata: [`repo.yaml`](repo.yaml) · last_reviewed: 2026-10-09 (against 86fdb69; pointers below unchanged since 9ed7ff6)

## Read order for this repo
1. `CLAUDE.md`: rules that are hard to undo (secrets, posting to the table, deploy, migrations).
2. `README.md`: what it is and how to use it. `NOTES.md`: reasons behind decisions.
3. `docs/`: boundaries, deploy, owner checklist, provisioning runbook.
4. Cross-workstream decisions recorded **in the running workspace (ws-001)**, not in git.

## Pointers (facts from the repo, 2026-10-09)
- Stack: Cloudflare Workers + D1, TypeScript, vitest. CI: `.github/workflows/ci.yml`.
- Production deploy only via `./scripts/deploy.sh` (CLAUDE.md).
- Version source: `package.json` (currently `0.1.0`).

## Unknown / TBD
- Approving humans: TBD. No `docs/decisions/` ADR folder or CHANGELOG yet; decisions currently live in `NOTES.md` and ws-001.
