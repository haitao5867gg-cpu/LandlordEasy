# ORG-001 — AI CLI Onboarding
Priority control-plane enablement. Status WAITING FOR COMMANDER READY SIGNAL AND OWNER ASSISTANCE. Owner: Commander + Haitao.

## Objective
Connect Kiro CLI, GitHub Copilot CLI and Claude Code only after the repository control system is ready, then prove each can execute a bounded GitHub Issue/Spec without relying on chat history.

## Preconditions
- `AGENTS.md`, project brain, release gates, assigned Specs and Issue/PR workflow are current on the agreed working branch.
- CI reports the exact candidate and no worker can bypass required review.
- Haitao explicitly assists product installation/login or subscription access. Subscriptions and quotas remain separate; no shared API pool is assumed.

## Minimum connection checklist
1. Record installed product/version and authenticated account scope without committing tokens.
2. Grant least privilege. Production host, DB, secrets, deployment, payment/provider calls and real-user messages require separate explicit approval; never use blanket trust for these.
3. Configure each worker to bootstrap from `AGENTS.md` and its assigned Spec/Issue.
4. Run a read-only repository/bootstrap smoke test, then one reversible documentation/test-only trial task in an isolated branch.
5. Independently inspect diff, rerun evidence and confirm the worker updated the Issue/Spec before accepting it.

## Routing
- Kiro: coordinated issue execution, tests, retries and checkpoints.
- Copilot: mechanical tests, validation, CRUD, documentation and small fixes.
- Claude Code: transactions, security, WeChat/WeiQian integrations and difficult cross-module bugs.
- Commander retains WHAT/WHY/priority/risk/acceptance/release and may reassign work based on evidence.

## Acceptance
For each CLI, record version, safe permission scope, smoke-task Issue/PR, independent review and any limitations. A successful login alone is not acceptance. Do not start onboarding until Commander explicitly tells Haitao the control system is ready.
