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


---

## Phase G — PR A（合并会话后，本会话独立执行）

起点：`e759962`，另一 session 交接为空（无未提交、无领先提交）；它的独立审计发现已核实并优先处理。

| 项 | 状态 | 提交 |
|---|---|---|
| **P0-1** 无法认领的评论导致 runner 永久停摆（重复 job_id / 已编辑评论 → 每 tick 抛 ValidationError，零终态） | ✅ `rejected_comments` 表 + 独立 outbox；`recover_incomplete_jobs` 改为如实 orphan FAILED，不再 raise | `b3a2846` |
| **P1-5** CLAIMED 发帖异常逃逸烧掉 UUID | ✅ 降为 advisory，失败只记 stderr | `b3a2846` |
| **P1-1** taxonomy 不驾驭调度（`SAFE_FAILOVER_CATEGORIES` 另起一套，且不含 TIMEOUT） | ✅ 4 policy（FAIL_CLOSED/LOCAL_RECOVERY/BOUNDED_RETRY/REPORT_AND_STOP）驱动 `failover_allowed_after`；删平行清单。**行为变化**：repo_read 的 TIMEOUT 在 failover 开启时可切 provider | 本次 |
| **P1-7** LaunchAgent 指向 flat 路径，pck 装到 current/ → 升级 launchd 看不见 | ✅ doctor 新增 `launchagent.consistent`（按 runtime_dir 作用域，别的项目报 None）；新增 `relink-launchagent --confirm`（备份 plist） | 本次 |
| A-1 删 `route_candidates` shim | ✅ | `782cf5c` |
| A-3 summary→4000，超长截断进 Issue、全文进 artifact，**长度不再是拒绝理由** | ✅ | `782cf5c` |
| A-4 artifact 保留期（30d 可配）+ 宿主机信任边界声明 | ✅ | `53087d5` + 文档 |
| A-5 评论 ID 高水位（`since`、O(1) 单评论查询、从「最后看到」播种）+ P1-4 state 丢失拒绝启动 + `rebuild-claims` | ✅ | `73282a2` |
| A-6 doctor：最后成功轮询/高水位/队列可读/活跃 job&attempt/三个 outbox 深度 | ✅ | `53087d5` |
| A-7 `COMMANDER_VERDICT_V1` 定义、解析、记录，**不消费** | ✅ | `53087d5` |
| A-8 文档 + schema/示例补 4 字段 | ✅ | 本次 |
| P1-2 尾部 3 行判可用性 / P1-3 per-attempt nonce / P1-6 pck 测 SOURCE 树 | ✅ | `c673b67`, `782cf5c` |
| Issue #12 回写 | ⏳ 待 PR A 收口后一次性做 | |

**线上警告**：在 P1-7 的 relink 落地并验证前，**不要对线上跑 `pck upgrade`**——它会报成功但 launchd 继续跑旧代码。

套件 **223/223**，canary 21/21。CI：`b89f421`、`73282a2` 双绿。


### Phase G 续 — 审计报告全量处理（用户外出期间，自主模式）

收到另一 session 的完整审计（2 P0 / 11 P1 / 8 P2 / 7 缺失）。**逐条对当前代码核实后**处理：

| 项 | 核实 | 处理 |
|---|---|---|
| P1-8 SECURITY_MODEL 两句假话 | 真 | 文档改口：`isolated_test` 是真实（隔离）数据库路径 |
| P1-9 付费上限对 credits 型 provider 失效、超时不记账、按任务不按窗口 | 真 | 付费尝试**发起即计**到窗口级计数 `paid_overflow_max_attempts_per_window`；另发现 `record()` 会复活 exhausted，已修 |
| P1-10 `_api` 是约定非收窄点 | 真 | pulls GET 纳入白名单；doctor 报告 token scope 并对过宽告警；**收窄 PAT 是 owner 动作** |
| P1-11 门失败丢 Result | 真 | 门输出先落盘 `<job>.gate-N.log`，分类+policy 进终态 |
| P1-6 (a)(c) | 真 | install 漂移即拒；SYNCED 由源树派生（opt-out） |
| P2-3 renormalize 永写 attempt-1 | 真 | 按恢复的 ordinal 写 |
| P2-4 付费池取自 `capable` | 真 | 取自 `free_pool`，尊重 `provider_failover` |
| P2-6 递归无界/二次复杂度 | 真 | 深度 ≤2、候选 ≤64 |
| P2-7 悬空 `.current.*`、prune 可删运行中版本 | 真 | activate 清扫；prune 保护 launchd 目标 + 最小 7 天 |
| P2-8 helper 无界缓冲 | 真 | 流式读、尾部截断 |
| 未编号 `Job.from_comment` 丢弃归一化 | 真 | 使用校验值；清死变量 |
| 缺失 5 V2 任务静默跳过 | 真 | REJECTED + "unsupported protocol version" |
| 缺失 7 三个测试 | 已存在 | — |
| P2-1/缺失 1/2/3（GC、心跳、取消） | 真 | **PR B/C**，文档列为未保证 |
| P2-5 "raw" 实为解码截断文本 | 真 | 文档改口为 "raw capture" |
| helper 路径只认 flat（审计未列） | 真 | 同时接受 `current/` |

Issue #12 回写：评论 `5612820060`（Executor 身份，脱敏自检通过）。

套件 **241/241**，canary 21/21。
