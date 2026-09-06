# ORG-001 — AI CLI Onboarding

Priority control-plane enablement. Status **ACCEPTED — 2026-09-06 UTC**. Owner: Commander.

## Objective

Connect Kiro CLI, GitHub Copilot CLI and Claude Code after the repository control system is ready, then prove each can bootstrap from repository truth without relying on chat history.

## Acceptance evidence

All tests ran from the isolated detached worktree at `22c8a9bc00e17b01bc6f64bbfbe04c56337d2b94`. The main worktree and smoke worktree finished clean; no repository ref, business environment, server, database, deployment or provider was changed.

| Worker | Version / account | Accepted permission envelope | Default/observed model | Smoke evidence | Observed usage |
|---|---|---|---|---|---|
| Kiro CLI | 2.21.1; authenticated | `fs_read` only | model inventory recorded in Issue #15; route explicitly per task | Read the four bootstrap documents and returned the required markers | 0.32 Credits |
| GitHub Copilot CLI | 1.0.82; authenticated | model-visible `view,grep,glob`; read only; write/shell/URL/MCP/remote disabled | Claude Sonnet 5 | Read the four bootstrap documents; exit 0 | 3.35 AI Credits |
| Claude Code | 2.1.263; Claude Pro | `Read,Glob,Grep` only; Web/MCP/subagents disabled; `remoteControlAtStartup=false` for the session | claude-sonnet-5 | Read the four bootstrap documents; exit 0 | visible cost $0.0453182 |

Each worker returned:

```text
BOOTSTRAP_TITLE=LandlordEasy — Agent Bootstrap
RELEASE_DECISION=NO-GO
ORG_STATUS=WAITING FOR COMMANDER READY SIGNAL AND OWNER ASSISTANCE
```

The returned ORG status is the historical text read from this file before acceptance; this update supersedes it.

## Mandatory bootstrap

Every worker must read, in order:

1. `AGENTS.md`
2. `project-brain/CURRENT_STATE.md`
3. `project-brain/RELEASE_PLAN.md`
4. its assigned Issue/Spec
5. only relevant code

A successful login or model response is never delivery evidence. Each implementation still requires an isolated branch/worktree, targeted permissions, tests, independent diff review and Issue/Spec update.

## Routing policy

| Work class | Primary | Model guidance | Fallback / review |
|---|---|---|---|
| Coordinated multi-step issue execution, retries and checkpoints | Kiro | `gpt-5.6-terra` default; `gpt-5.6-luna` for cheap mechanical work | Commander review; Sonnet only when complexity justifies it |
| Tests, validation, CRUD, documentation and small fixes | Copilot | account default unless Commander pins a model | Kiro Luna/Terra |
| Transactions, security, WeChat/WeiQian, difficult cross-module defects | Claude Code | Sonnet 5 default | Kiro Sonnet 5; Opus only by exception |
| WHAT, WHY, priority, scope, risk, acceptance and release | Commander | current Work model | never delegated |

Kiro `claude-opus-5` / other Opus variants and `gpt-5.6-sol` are exceptional P0/P1 tools, not defaults. Exact routing may change with task evidence and remaining quota.

## Quota discipline

- Kiro and Copilot quotas reset monthly on the first day; preserve them for implementation throughput.
- Claude quota resets Saturday and has a five-hour usage window; batch difficult reviews and integrations.
- Record material observed usage in the assigned Issue when the CLI exposes it.
- No subscription is a shared API pool. Do not silently switch accounts, buy credits or incur new cost.
- Full model inventory is not required to dispatch work; a known working model and bounded permission envelope are sufficient.

## Safety envelope

- Start with the least tool and path permission needed by the assigned Spec.
- No blanket trust for production hosts, databases, secrets, deployment, payment/signing providers or real-user messages.
- Copilot must not use `/allow-all`, `/yolo` or equivalent outside an explicitly isolated and approved environment.
- Claude Remote Control stays off unless separately authorized for a concrete need.
- Unexpected permissions, network destinations or repository mutations are stop conditions.
- Worker self-report is not acceptance; Commander or an assigned independent reviewer verifies the diff and reruns required evidence.

## Limitations

ORG-001 proves authenticated, bounded, repository-aware invocation. It does not pre-approve any write task or production access. The first real task for each CLI remains subject to its Issue/Spec, branch, permission and review gates.
