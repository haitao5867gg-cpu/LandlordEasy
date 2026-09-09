# FRAMEWORK_PROGRESS.md

Working branch: `infra/commander-kit-hardening`, based on `origin/infra/pr-event-wake-bridge` @ `b81833de52896a2206aab1a3a6dbcb526df8f00c`.
Worktree: `/Users/haitao/LandLordEasy-kit`. Baseline offline suite: **101/101 pass**.

Identity in use: `gh` active account `haitao5867` = **Executor**. Commander is `haitao5867gg-cpu`. Identity NOT switched.

---

## Phase A — Architecture audit (COMPLETE)

### Confirmed data flow

```
Commander (haitao5867gg-cpu, web) --COMMANDER_JOB_V1 / COMMANDER_OPERATION_V1 comment--> Issue #17 (queue)
    -> Mac mini Runner (launchd, serve loop, polls 60s, as Executor haitao5867)
    -> claim (SQLite, atomic) -> isolated git worktree at exact target_sha
    -> provider argv (kiro | copilot | claude) OR fixed operation argv
    -> normalize output -> terminal comment on Issue #17
    -> optional wake comment on PR #22 (wake_pull_request)
    -> Commander reads Issue #17 for authoritative state
```

### Live runtime state (verified 2026-09-09)

- Runner process **live** under launchd, config `LandLordEasy-org002-impl/tools/commander-runner/config.json`.
- `provider_failover: false`; all three providers enabled; `wake_pull_request: 22` (a **merged** PR).
- `enabled_operations: ["ops001_mysql_probe"]` pinned to `allowed_target_shas: ["104de15…"]`.
- State DB: 37 claims — **17 blocked, 2 failed, 18 succeeded, 0 REJECTED ever**.

### Root causes (evidence-backed)

| # | Root cause | Evidence | Class |
|---|---|---|---|
| 1 | `SHELL_FRAGMENT_RE` includes `;` and is applied to `prompt`/`assigned`/`expected_evidence`. Providers are invoked via `subprocess.Popen(argv, shell=False)` — **no shell exists**, so this filter protects nothing and only rejects ordinary punctuation. | `commander_runner.py` SHELL_FRAGMENT_RE + `Job.from_comment` | Framework defect |
| 2 | Validation failures in the queue loop hit `except ValidationError: continue` — the job is **silently skipped**, never claimed, no terminal record. Commander sees silence and re-posts manually. | `run_once` queue loop; 0 REJECTED in 37 claims | Framework defect |
| 3 | `normalize_provider_output` caps `summary` at 2000 chars. Job `3abae900` (PR #25 review): Claude ran **403.5s, exit 0, `subtype=success`, $0.908**, emitted schema-valid JSON with a **12131-char summary** → discarded whole as `OUTPUT_VALIDATION`. | raw-output log inspected + failure reproduced against live code | Framework defect |
| 4 | Raw output is persisted only *after* normalization, only for the final attempt, and there is **no re-normalization path** — recovery requires re-spending provider quota. | `run_once`: `store_raw_output` after `execute_with_failover` | Framework defect |
| 5 | `route_candidates` uses a hardcoded static order and **never consults `QuotaLedger`**; `provider_failover` is off in production config. No quota-aware routing or paid-overflow gate exists. | `route_candidates` / `QuotaLedger` unused in routing | Scheduling defect |
| 6 | Every `RunnerError` collapses to `FAILED/blocked` "runner stop condition"; there is **no retry at all** and no separation of safety stops from ordinary engineering failure. | `run_once` `except RunnerError` | Framework defect |
| 7 | `ops001_mysql_probe` is pinned to exact SHA `104de15…`; PR #25's head is `2ba3f3d…`, so the controlled MySQL operation **can never run against the branch under test** — forcing manual operation. Editing code changes the SHA, which invalidates the pin: the self-reference loop. | config `allowed_target_shas` vs PR #25 head | Framework + scheduling defect |
| 8 | CI `pull_request.branches` is only `main`/`dev`; `push.branches` omits `test/**`. PR #25 (`test/rel001-mysql-integration` → `release/v1-rehearsal-candidate`) therefore gets **no exact-head CI at all**. | `.github/workflows/ci-quality-gate.yml` | Framework defect |
| 9 | `MAX_OUTPUT_BYTES = 65_536` truncates long provider runs (job `1e0372e7` is exactly 65536 bytes = hard overflow). No artifact channel for long reports. | raw-output file sizes | Framework defect |

### Recovered artifact

The PR #25 closure review destroyed by root cause #3 was **fully recovered offline from the raw log with no model call**. It contains a P0 code finding (`endLeaseInTransaction` REPEATABLE-READ snapshot reuse allowing concurrent termination+transfer approval), the CI one-line fix, and an explicit finding that the 5 extra MySQL repetitions are **not** materially required. This is deliverable E's core content and is proof that re-normalization is viable.

---

## Phase B — Framework implementation (CORE COMPLETE)

Implemented in `tools/commander-runner/commander_runner.py` unless noted.

| Root cause | Fix |
|---|---|
| 1 semicolon rejection | `SHELL_FRAGMENT_RE` no longer applied to Commander job text. New `validate_job_text()` rejects control characters and enforces length/single-line, and permits ordinary punctuation. `SHELL_FRAGMENT_RE` is retained for owner config (operation argv/description) only. |
| 2 silent skip | `envelope_for_rejection()` + `rejection_lifecycle()`; the queue loop now claims and posts an explicit `REJECTED` terminal (with `stop_class` and reason) for any job addressed to this runner that fails validation. Jobs for other runners are still skipped untouched. |
| 3 long output discarded | `MAX_SUMMARY_CHARS` 2 000 → 20 000, evidence item 1 000 → 4 000, items 50 → 200. |
| 4 no recovery path | Raw output is persisted **before** parsing, per attempt (`<job>.attempt-N.log`). New `renormalize` CLI + `renormalize_job()` re-parse locally with **zero provider calls**. `store_artifact()` writes the full report locally; the Issue carries a bounded excerpt + sha256. |
| 5 no quota routing | `QuotaLedger.is_exhausted()/mark_exhausted()`; `route_candidates()` prefers providers with free quota and falls back to `paid_overflow_providers` **only** when all free windows are exhausted **and** `paid_overflow_authorized` is true. |
| 6 undifferentiated stops | `STOP_CLASSES` + `ERROR_CATEGORY_STOP_CLASS` + `stop_class_for()`. Bounded retry with exponential backoff (`retry_backoff_seconds`, cap 60s) for transient classes; `max_attempts` config (default 3, ceiling 5). Attempts recorded in a new `attempts` SQLite table with derived `attempt_id` — the job UUID is never reused as an execution identity. |
| 7 SHA self-reference | `allowed_target_branches` on operation definitions + `resolve_operation_binding()`. The owner authorizes a *branch*; the runner resolves its current head from origin and pins the resolved SHA in the terminal record. Protected branches (`main`/`dev`/`master`/`HEAD`) are refused. |
| 8 CI gap | `.github/workflows/ci-quality-gate.yml`: added `release/**` to `pull_request.branches` and `test/**`/`infra/**` to `push.branches`. Workflow is `contents: read` with no deploy step, so no deployment path is created. |
| 9 output truncation | `MAX_OUTPUT_BYTES` 65 536 → 1 048 576. |

### Verified recovery of the destroyed PR #25 review

`renormalize_job()` run against a copy of the live raw log:

```
job_id 3abae900-…  recovered_from 3abae900-….log  status ok
summary_chars 12131   evidence_items 10   usage cost_usd=0.9081394
provider_calls 0
```

Offline suite after core changes: **102/102 pass** (was 101; three tests that encoded the semicolon defect were rewritten to assert the corrected contract).

## Phase B2 — remaining framework work (COMPLETE)
## Phase C — project-commander-kit/ (COMPLETE)

Portable kit at `project-commander-kit/`: runner + full suite, `scripts/pck.py`
(doctor/install/upgrade/rollback), config JSON schema + neutral example,
GitHub Issue/PR/CI templates, ONBOARDING_PROMPT.md (single-file handoff) and
FRAMEWORK_SUMMARY.md (no chat context required).

Bug found by running the real lifecycle: `pck.py` backup timestamps have
one-second resolution, so upgrade-then-rollback in the same second let the
rollback's own safety copy overwrite the backup it was restoring. Fixed with a
collision guard + regression test.
## Phase D — Verification (COMPLETE)

- repo suite 151/151, kit suite 151/151 (baseline was 101)
- end-to-end canary 21/21 (real git repo, real worktree, stub provider and gh)
- `pck.py doctor` ok; install -> upgrade -> rollback round trip verified, all backups retained
- destroyed PR #25 review recovered with `provider_calls: 0`
- PR #25 exact head confirmed to have **0** CI runs; triggers widened
## Phase E — PR #25 closure (COMPLETE)

`PR25_CLOSURE_RECOMMENDATION.md`. Do not merge yet: an independently verified P0
(REPEATABLE READ snapshot reuse in `endLeaseInTransaction`, reachable via
concurrent cross-type termination+transfer approval) sits in a file this PR
already edits. The five extra repeat runs are **not** required. Recovered review
committed at `review/recovered/PR25-closure-review-2ba3f3d.md`.


---

## Phase F — 用户批准后的自主执行（2026-09-10 凌晨，COMPLETE）

Haitao 睡前明确批准四项，全部完成：

1. **升级线上 runner 并重启** — `pck.py upgrade`（旧版备份 `*.20260910T001607.bak`），
   停止 → 启动，PID 6177，`doctor ok:true`，稳定运行 5 分钟以上无新错误，lease 活跃。
   顺序教训：我先改了配置再升级运行时，导致旧二进制无法解析自己的配置；
   正确顺序是先升级运行时（新代码向后兼容旧配置），再改配置。
2. **实现 PR #25 的 P0 修复** — 分支 `fix/rel001-cross-type-approval`，Draft PR #27。
   原子认领 + 跨类型互斥 + 缺失的并发测试。
   `tsc` 通过；server Jest **230 passed / 12 skipped / 0 failed**（原 228，新增 2 个单元测试）。
   新的 MySQL 规格被 Jest 发现并按 guard 正确跳过，**未对真实数据库执行**。
3. **CI 触发器推到 release 分支** — commit `fd23cdc`，仅改触发器（该分支尚无 runner 测试步骤，
   硬 cherry-pick 会引入不存在的步骤）。副作用：release 分支 head 由 `104de15` 前进到 `fd23cdc`。
4. **授权 Kiro 付费额度兜底** — 线上配置加入 `paid_overflow_providers: ["kiro"]`、
   `paid_overflow_authorized: true`、`max_attempts: 3`（配置已备份）。

**触发器修复已被实证**：PR #27 的精确 head 拿到两条运行，其中一条是 `release/**` base 的
`pull_request` 运行 —— 正是 PR #25 从来拿不到的那一条。PR #26 与 #27 CI 均全绿。

交接报告：`FRAMEWORK_HANDOFF_TO_CHATGPT.md`。
