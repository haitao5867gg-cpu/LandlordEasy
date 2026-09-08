# Current state

As of 2026-09-08 UTC. Release decision: **NO-GO**. Production V1 feature freeze remains active.

## Verified baselines

- `main`: `c3b5b2d849745d7ed4e0c2b5d674900d1f4bf286` — M18 production baseline.
- `origin/dev`: `63f2ba039b5a39db45d80874caa2cf013a0fe0a5` — M21 candidate plus merged Project Commander control plane, read-only CI quality gate, accepted ORG-002 Runner integration, and the ORG-003/ORG-004 control-plane merge via PR #23.
- Rehearsal candidate: `104de1521cf194c9dc76ccca52741f05a75f1180` — contains the SEC-001, SEC-002, REL-001 and REL-002 changes. Its CI Quality Gate passed. It is **not** deployed to Production and not merged to `main`.
- Commander Runner baseline (ORG-002, `tools/commander-runner/`): `77487255a60502ae5cef9f753380629289ba39e1`.
- PR #6 merged the control plane into `dev`; its push and pull-request quality-gate runs passed.
- PR #18 merged the accepted ORG-002 Runner into `dev` after CI passed on head `51143ead031fdf6c3dd90ec7fe286d371056bcc0`.
- PR #23 merged the independently reviewed and real-canary-accepted ORG-003 and ORG-004 control-plane code into `dev` from exact head `b81833de52896a2206aab1a3a6dbcb526df8f00c` after CI run [34195252567](https://github.com/haitao5867gg-cpu/LandlordEasy/actions/runs/34195252567) passed.
- `main` remains the production baseline. No blocker implementation has been deployed or merged into `main`.
- Branch protection / required-check enforcement is still pending; green CI is evidence, not permission to merge.

## Evidence policy

VERIFIED = directly checked against named commit/environment. HISTORICAL = prior report. PENDING = not tested. BLOCKED = prerequisite absent.

Historical production evidence includes real WeChat OAuth and a ¥0.01 JSAPI payment on `main`. Historical dev evidence includes backend typecheck, both H5 typecheck/builds, Jest, Chromium PDF generation, Playwright assets and landlord regression assets. Counts and old passes do not prove the current release candidate.

## Release blocker stack

| ID | Priority | State | Branch / PR | Remaining release gate |
|---|---|---|---|---|
| SEC-001 | P0 | LOCAL_ACCEPTED / DEPLOYMENT_PENDING | `fix/sec001-contract-access` / Draft PR #7 at `4edcee0` | migrate actual contract files; verify loaded Nginx denial/authenticated downloads and real WeChat WebView behavior |
| SEC-002 | P1 | REVIEWED / ACTIONS_GREEN | `fix/sec002-payment-authorization` / Draft PR #8 at `ae79663` | integrated runtime payment regression |
| REL-002 | P1 | REVIEWED / ACTIONS_GREEN | `fix/rel002-production-config` / Draft PR #10 at `99b0586` | prod-like startup rehearsal with real configuration boundaries |
| REL-001 | P1 | REVIEWED / ACTIVE — OPS-001 read-only MySQL probe accepted (Issue #17 job `d91f4b6c-3e72-4a85-b9d1-6f204c8e57a3`) | `fix/rel001-transaction-safety` / Draft PR #11 at `defa102` | real MySQL rollback, locking/deadlock, concurrent approval and provider-recovery evidence — **not yet passed** |
| REL-003 | P1 | CI MERGED / ENFORCEMENT_PENDING | workflow merged through PR #6; superseded PR #9 closed | configure enforceable required checks / branch rules |

The blocker PRs are intentionally stacked: `dev` → SEC-001 → SEC-002 → REL-002 → REL-001. Do not merge or deploy the stack merely because CI is green. The rehearsal candidate `104de1521cf194c9dc76ccca52741f05a75f1180` aggregates these four changes with a passing CI Quality Gate; that is evidence the gate passed on that exact candidate, not that the fixes are verified in a running rehearsal environment or deployed to Production.

## AI organization

ORG-001 is **ACCEPTED**.

- Kiro CLI 2.21.1: authenticated and accepted with `fs_read` smoke evidence.
- GitHub Copilot CLI 1.0.82: authenticated and accepted with `view,grep,glob` / read-only smoke evidence.
- Claude Code 2.1.263 on Claude Pro: authenticated and accepted with `Read,Glob,Grep`, Remote Control off, and no Web/MCP/subagent access.
- All three independently read the repository bootstrap and returned the expected title, release NO-GO decision and pre-acceptance ORG status.
- The main and isolated smoke worktrees remained clean; no refs, branches, business environment, DB, provider or deployment changed during CLI validation.

Routing and quota rules are authoritative in `specs/ORG-001-AI-CLI-ONBOARDING.md`. Commander retains scope, priority, risk, acceptance and release decisions; worker output always requires independent verification.

ORG-002 (Local Commander Runner) is **ACCEPTED for scoped development execution** at Commander Runner baseline `77487255a60502ae5cef9f753380629289ba39e1`. Acceptance is grounded in: repo_read canaries completed independently for Kiro, Copilot and Claude; stop/restart checks proving no job replay; a reversible `repo_write_test` canary; strict identity separation between the Commander (dispatcher) and Executor GitHub logins; a stable runner runtime; exact-path allowlists enforced on every `repo_delivery` quality gate; a mandatory bounded human-approval reference required on every `repo_delivery` job; and independently fail-closed provider/profile capability enforcement. Failover between providers remains disabled.

Active capability matrix (see `specs/ORG-002-LOCAL-COMMANDER-RUNNER.md`):

- Kiro: `repo_read`, `repo_write_test`, `repo_delivery`.
- GitHub Copilot: `repo_read` only — Copilot CLI 1.0.83 headless write behavior has not been validated, so write/delivery jobs are rejected at parse time and never routed to Copilot.
- Claude: `repo_read`, `repo_write_test`, `repo_delivery` — enabled after stable authentication was confirmed in both interactive and Runner (headless) environments.

`repo_delivery` only creates and pushes a UUID-derived branch; it cannot push `main`, `dev`, or the infra Commander Runner branch directly. Controlled delivery branch pushes are permitted only through this hardened `repo_delivery` profile; every other GitHub action (Issue edits, labels, PR actions, releases, workflow or repository-settings changes) stays outside the Runner entirely.

This acceptance authorizes scoped development execution only. It is not a claim of Production readiness, deployment, merge to `main`, object storage access, production database access, real third-party provider verification, or legal approval.

Installed ORG-004 runtime `b81833de52896a2206aab1a3a6dbcb526df8f00c` is **ACCEPTED for scoped Commander wake** on the Mac mini, per Issue #21 acceptance comment [5584342960](https://github.com/haitao5867gg-cpu/LandlordEasy/issues/21#issuecomment-5584342960). The event-driven PR #22 Commander is now primary; the temporary hourly-poll Commander is disabled. This acceptance authorizes scoped wake-and-dispatch execution only; it is not a claim of Production readiness or any release-gate pass.

## Next execution wave

0. **Completed checkpoint:** PR #18 merged the accepted ORG-002 Runner into `dev` after CI passed on head `51143ead031fdf6c3dd90ec7fe286d371056bcc0`. The Commander Runner runtime baseline remains `77487255a60502ae5cef9f753380629289ba39e1` because runtime code did not change. PR #23 subsequently merged the accepted ORG-003/ORG-004 control-plane code into `dev` (see Verified baselines).
1. **ACTIVE — [#12 OPS-001 connected dev rehearsal](https://github.com/haitao5867gg-cpu/LandlordEasy/issues/12)**
   - Last accepted OPS-001 read-only MySQL probe: [Issue #17](https://github.com/haitao5867gg-cpu/LandlordEasy/issues/17) job `d91f4b6c-3e72-4a85-b9d1-6f204c8e57a3` — exact isolated MySQL identity, healthy state, loopback-only binding, tmpfs storage, zero volumes, MySQL 8, synthetic database, 22 tables.
   - **Immediate active task:** OPS-001 → REL-001 real MySQL integration harness (transaction rollback, locking/deadlock, concurrent approval and provider-recovery evidence against real MySQL).
   - Pending afterward: SEC-001 proxy and private-file rehearsal; REL-002 production-like startup.
   - REL-001, SEC-001, REL-002, QA-001, UX-001, deployment and Production gates have **not** passed.
2. [#13 QA-001 M19–M21 E2E](https://github.com/haitao5867gg-cpu/LandlordEasy/issues/13)
   - Run full landlord and tenant journeys against the pinned environment.
3. [#14 UX-001 product polish](https://github.com/haitao5867gg-cpu/LandlordEasy/issues/14)
   - Resolve severe mobile/WeChat loading, empty, error, duplicate, cancellation and recovery gaps discovered by E2E.
4. Contract/legal finalization and e-sign production readiness.
5. Production rehearsal, RC freeze, deployment, smoke test and 3–5 tenant pilot.

## Owner boundaries

Contract wording and the safety undertaking remain deferred for a dedicated Commander–Haitao discussion. Watermark strategy, stale CREATED e-sign data, initial tenant records and pilot users remain human actions. Alipay is outside the active critical path pending the owner's final V1 exclusion decision.

No production/dev deployment, real DB mutation, provider call or real-user notification has been authorized by this checkpoint. Release remains **NO-GO**. Production V1 feature freeze remains in force pending SEC/REL blocker closure and full M19–M21 verification.
