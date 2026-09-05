# Current state
As of 2026-09-05 UTC. Release decision: **NO-GO**.

## Baseline verified through GitHub
- main: c3b5b2d849745d7ed4e0c2b5d674900d1f4bf286 (M18 baseline).
- dev: d58097e20a84ea27678895d15f94fb9cc6c21d1b (M21 candidate).
- Both match the handoff; only main/dev branches and no open Issues/PRs at initial check.
- Both branches report unprotected. REL-003 must distinguish CI existence from enforceable merge protection.
- AGENTS.md, COLLABORATION.md and historical specs already exist. Control plane supplements historical records; current release priority and owner delegation follow the 2026-09-05 handoff.
- Control plane: release/v1-control-plane, commit a166fa0 (draft PR #6). Security work branch: fix/sec001-contract-access, based on a166fa0. main/dev are not deployment targets for this task.

## Evidence classes
VERIFIED = directly checked this session; HISTORICAL = prior report; PENDING = not yet tested; BLOCKED = unmet prerequisite. Every runtime result must name environment and tested commit.
Historical: main real OAuth and ¥0.01 WeChat payment; dev backend tsc, both frontend typechecks/builds, Jest 13 suites/123 cases, Chromium PDF generation. None has been rerun at initialization.
Historical: six Playwright files / about 88 cases and ~80 landlord regression cases. Counts are assets, not proof all ran or pass today.
Handoff estimates 85–90% internal completeness / 70–75% safe release readiness are unverified estimates, not Commander scores.

## Release work
| ID | Priority | State | Next evidence |
|---|---|---|---|
| SEC-001 | P0 | LOCAL_VERIFIED / DEPLOYMENT_PENDING | dev/prod proxy + migration + real WeChat verification |
| SEC-002 | P1 | READY | retired report route removal or ownership checks |
| REL-001 | P1 | READY | atomic approvals and concurrent/failure tests |
| REL-002 | P1 | READY | fail-closed startup validation |
| REL-003 | P1 | READY | isolated CI gates and enforcement evidence |

SEC-001 code review verified predictable public PDF writes, app static serving and both Nginx uploads aliases. Current landlords share whitelist portfolio access; schema contains no per-landlord property grant. This repair must not silently create a new business access model.
Engineering execution assigned to Work agent; Kiro/Claude CLI unavailable in this environment. No real-provider call, production mutation or notification is authorized by this assignment.

## Known limitations and next steps
Complete control plane → implement/review SEC-001 → retain NO-GO until all RELEASE_GATE.md conditions are evidenced. Production and dev runtime states have not been inspected this session.
Legal text/watermark and pilot decisions remain in HUMAN_ACTIONS.md. Do not request routine engineering decisions from Haitao.


## GitHub dispatch
- [SEC-001](https://github.com/haitao5867gg-cpu/LandlordEasy/issues/1) — specs/SEC-001.md
- [SEC-002](https://github.com/haitao5867gg-cpu/LandlordEasy/issues/2) — specs/SEC-002.md
- [REL-001](https://github.com/haitao5867gg-cpu/LandlordEasy/issues/3) — specs/REL-001.md
- [REL-002](https://github.com/haitao5867gg-cpu/LandlordEasy/issues/4) — specs/REL-002.md
- [REL-003](https://github.com/haitao5867gg-cpu/LandlordEasy/issues/5) — specs/REL-003.md

## Latest checkpoint — 2026-09-05
- Control plane and five specs committed in a166fa0; GitHub draft PR #6 targets dev. main/dev remain at original pinned hashes (rechecked before security delivery).
- SEC-001: private PDF storage, authenticated landlord/tenant downloads and tenant signed-contract discovery; app/Nginx legacy URL denial; dry-run-first offline migration; two H5 blob-download interactions.
- Independent review reproduced a direct-backend symlink alias leak and fixed it; raw HTTP encoding/path/link regressions added.
- Current local evidence: backend typecheck PASS; Jest 15 suites / 166 tests PASS including real Chromium PDF generation; both H5 typecheck/build PASS; five real Chromium UI fixture cases PASS; ten migration fixtures PASS; git diff --check PASS.
- All DB/provider inputs in these tests are isolated fixtures. Browser tests use synthetic API responses. Runtime dependencies (headless shell and CJK font) installed locally only. See specs/SEC-001-VERIFICATION.md for commands and boundaries.
- Not deployed; no real contracts migrated; no actual Nginx loaded-config or real WeChat WebView evidence. SEC-001 issue stays open. CI still absent, no PR merged, release remains NO-GO.
- Next engineering priority: close SEC-001 dev rehearsal evidence in a connected execution environment; dispatch SEC-002, REL-002 and REL-003 independently, then REL-001 with leases-service ownership coordinated. Do not wait for legal input to do ordinary engineering.
