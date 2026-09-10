# Project Commander 控制面：PR A 交接报告

**收件人**：前门 Commander（ChatGPT）
**执行者**：Claude Code，以 **Executor** 身份（`haitao5867`）操作，全程未切换到 Commander 身份
**日期**：2026-09-10
**范围**：PR A 全部 15 项 Commander 决定 + 独立审计报告中经核实的全部代码级发现 + PR #27 收尾
**本报告不依赖对话记忆，取代上一版同名文件。**

---

## 0. 精确 head、CI、测试

| 对象 | 精确 SHA | 状态 |
|---|---|---|
| **PR #26** `infra/commander-kit-hardening` → `dev` | **`9d7dff24`**（代码+文档最终 head；本报告的提交在其之上） | Draft |
| PR #27 `fix/rel001-cross-type-approval` → `release/v1-rehearsal-candidate` | `652fdeb2` | Draft，双 CI 绿，真实 MySQL 5/5 · 12/12 |
| PR #28 `docs/control-plane-state-drift` → `dev` | `f644a68` | Draft，CI 绿 |
| PR #25 `test/rel001-mysql-integration` | `2ba3f3d4` | Draft，已标 **SUPERSEDED**（02:29Z），未合并未关闭 |
| `release/v1-rehearsal-candidate` | `fd23cdc` | 仅 CI 触发器提交 |

**CI on `9d7dff24`**：**2/2 runs completed/success（pull_request on dev + push on infra/**）**

**离线套件**：**241/241**（起点 187）。**端到端 canary**：**21/21**。**源码同步**：`sync_from_source.py --check` 通过（kit 副本由 `tools/commander-runner/` 派生，CI 强制）。**kit doctor**：ok。

**中途推送并已双绿的里程碑**：`b89f421`（P0-1/P1-5/P1-1/P1-7）、`73282a2`（A-5/P1-4）。

---

## 1. 线上 runtime provenance（未变更）

| 项 | 值 |
|---|---|
| 进程 | PID 999，2026-09-10 09:55 开机自启（launchd RunAtLoad），err log 自 09-09 无新增 |
| 布局 | **flat**（`~/.local/lib/landlordeasy-commander/commander_runner.py`），LaunchAgent 指向 flat 路径 |
| manifest | **schema v2，`source_commit: None`** —— 无法独立核验来源 |
| 安装的 `commander_runner.py` | sha256 `49288bb04a964475…`（**第一轮**加固版） |
| PR #26 head 的 `commander_runner.py` | sha256 `814400461b671a2a…` |

**结论：线上跑的不是 PR A。** 按决定 #13 本轮不部署。升级步骤见第 6 节——**顺序有硬约束**。

---

## 2. Commander 十五项决定的落实

| # | 决定 | 落实 |
|---|---|---|
| 1 | 只有前门产生意图/授权 | 文档写死（ARCHITECTURE "Standing decisions"）；Runner 无任何产生新意图的路径 |
| 2 | 背景 Commander 永久无派单权 | 同上；`COMMANDER_VERDICT_V1` 只被记录、不被消费 |
| 3 | 不删 Wake Bridge，历史不删 | 未删。`wake_outbox`、`queue_page` 等旧行保留只读；`rejected_comments`/高水位为新增 |
| 4 | Queue/Evidence 分离 + 高水位 + 兼容 #17 | **高水位已落地**（从「旧 runner 最后认领的评论」播种，无 GitHub 调用、无重放、无迟到 REJECTED）；**Issue 分离属 PR B**，需 Commander 先建 Evidence Issue |
| 5 | 不做评论 lease | 未做；文档写明若需多写入者只允许 git-ref create CAS |
| 6 | `CURRENT_USER_STATUS` 取代 inbox 已读模型 | **PR B**；本轮未动 |
| 7 | 删 `route_candidates` shim | ✅ `782cf5c` |
| 8 | 8 类诊断 → 4 policy | ✅ `POLICIES` / `STOP_CLASS_POLICY` / `policy_for()` 真正驾驭 `failover_allowed_after`；删平行清单；终态带 `policy=` |
| 9 | summary 4000 + artifact 保留期 + 信任边界 | ✅ 4000 摘录/全文进 artifact/**长度不再拒绝**；`artifact_retention_days`（30d）；SECURITY_MODEL 写明 FileVault/备份排除 |
| 10 | doctor 检测轮询/高水位/可消费/活跃任务/attempt/outbox/provenance | ✅ `queue_health` + `runtime_manifest_health` + `launchagent_health` + `token_scope_health` |
| 11 | 预定义 provider verdict，Runner 不解析自然语言 | ✅ `COMMANDER_VERDICT_V1`（verdict/p0/p1/code_changed/exact_sha_verified/recommended_transition）：解析、校验、记录，**不消费** |
| 12 | connector 可发评论，GitHub App 非阻塞 | 采纳 |
| 13 | 只改 PR #26，普通 push，Draft，不合并不部署 | ✅ |
| 14 | 文档明确 PR A/B/C 边界 | ✅ ARCHITECTURE "Delivery boundaries" |
| 15 | 重生成本报告 | 本文件 |

---

## 3. 独立审计发现的处理（逐条对当前代码核实后）

审计交接时明确：只有 P0-1/P1-1/P1-5 被亲自复现，其余是 agent 主张。我**每条先核实再改**；核实结果全部为真，另核出审计未列的一条。

| 项 | 核实 | 处理 | 提交 |
|---|---|---|---|
| **P0-1** 重复 job_id / 编辑评论 → 每 tick 抛 `ValidationError` → runner 永久停摆、零终态 | 真（`:2680` 无 try） | `rejected_comments` 表 + 独立 outbox；`recover_incomplete_jobs` 不再 raise，写 orphan FAILED | `b3a2846` |
| P1-5 CLAIMED 发帖异常逃逸烧 UUID | 真 | 降为 advisory，失败记 stderr | `b3a2846` |
| P1-1 taxonomy 不驾驭调度（`SAFE_FAILOVER_CATEGORIES` 另起一套且不含 TIMEOUT） | 真 | 4 policy 驱动；**行为变化**：repo_read 的 TIMEOUT 在 failover 开启时可切 provider | `b89f421` |
| P1-7 LaunchAgent 指 flat、pck 装 current/ → 升级 launchd 看不见 | 真 | doctor `launchagent.consistent`（按 runtime_dir 作用域）；`relink-launchagent --confirm` | `b89f421` |
| P1-2 分类器整段匹配 "quota"，污染额度账本 | 真 | 可用性类只看**最后 3 个非空行** | `c673b67` |
| P1-3 响应无 nonce，仓库内容可劫持终态 | 真 | per-attempt nonce（=attempt_id）必需；历史记录需 `--allow-legacy-without-nonce` | `c673b67` |
| P1-4 exactly-once 仅存于本地 SQLite | 真 | state 空 + Issue 有终态历史 → **拒绝启动**；`rebuild-claims --confirm` 从历史重建 | `73282a2` |
| P1-6 pck 测 kit 树、装 SOURCE 树；SYNCED 手工维护 | 真 | 测 SOURCE；install 漂移即拒；SYNCED 由源树派生（新文件 opt-out） | `782cf5c`, `75c3b52` |
| P1-8 SECURITY_MODEL 两句假话 | 真 | 改口：`isolated_test` 是真实（隔离、合成）数据库路径 | `4104d9d` |
| P1-9 成本上限对 credits 型 provider 失效、超时不记账、按任务 | 真 | 付费尝试**发起即计**到窗口计数 `paid_overflow_max_attempts_per_window`；另发现 `record()` 复活 exhausted，已修 | `75c3b52` |
| P1-10 `_api` 是约定非收窄点 | 真 | pulls GET 纳入白名单；doctor 报告 token scope 并对过宽告警。**收窄 PAT 是 owner 动作** | `75c3b52` |
| P1-11 门失败丢 Result | 真 | 门输出先落盘 `<job>.gate-N.log`；分类 + policy 进终态 | `75c3b52` |
| P2-3 renormalize 永写 attempt-1 | 真 | 按恢复的 ordinal 写 | `75c3b52` |
| P2-4 付费池取自 `capable`，绕过 `provider_failover` | 真 | 取自 `free_pool` | `75c3b52` |
| P2-6 递归无界 / 二次复杂度 | 真 | 深度 ≤2、候选 ≤64 | `75c3b52` |
| P2-7 悬空 `.current.*`；prune 可删运行中版本 | 真 | activate 清扫；prune 保护 launchd 目标 + 最小 7 天 + 两侧 resolve | `75c3b52` |
| P2-8 helper 无界缓冲 | 真 | 流式读、尾部截断 | `75c3b52` |
| 未编号 `Job.from_comment` 丢弃归一化 | 真 | 使用校验值；清死变量 | `75c3b52` |
| 缺失 5 V2 任务被静默跳过 | 真 | REJECTED + "unsupported protocol version" | `75c3b52` |
| 缺失 7 三个测试 | 已存在 | — | — |
| **（审计未列）helper 路径只认 flat** | 真 | 同时接受 `runtime_dir/current/` | `75c3b52` |
| P2-1 / 缺失 1·2·3（worktree/分支 GC、心跳、取消） | 真 | **PR B/C**；文档"not guaranteed"列明 | — |
| P2-5 "raw" 实为解码截断文本 | 真 | 文档改口 "raw capture" | `9d7dff2` |
| P0-2 provider 无沙箱 | 真（原有属性） | 文档改口"可写 runner uid 能写的任何地方" | `9d7dff2` |

---

## 4. PR #27 收尾（已完成）

在精确 head **`652fdeb284d1ec55acd21abd74d0a50e0f83b520`** 上：隔离真实 MySQL 套件 **5/5 suites、12/12 tests，rows 0→0，22 表**，loopback-only、tmpfs、零卷、镜像摘要精确匹配，包含 `rel001-cross-type-approval`，**未执行五次重复**。同 head：tsc 通过；Jest 230 passed / 12 skipped。双 CI 绿。

结果已以**一条不可编辑评论**回写 **Issue #12**：评论 id **`5612820060`**（Executor 身份，脱敏自检通过）。

PR #25 已标 SUPERSEDED，未合并未关闭，等 Commander 决定。

---

## 5. 必须如实交代的过程缺陷

**三个提交的说明超额声称了内容**：`0e1c14b`（实际仅 ARCHITECTURE + PROGRESS）、`31e4c86`（实际仅 PROGRESS）、`4104d9d`（实际仅 FAILURE_AND_RETRY 表 + SECURITY_MODEL 一段）。根因：文档编辑脚本中途失败（锚点不匹配 / heredoc 转义 SyntaxError），而 shell 链未守卫——**`set -e` 在本工具的 `eval` 包装下无效**。`9d7dff2` 用显式 `&&` + 内容 grep 守卫真正落地了其余文档，说明里逐个写明了前三者的实际内容。**历史未改写。** 这一条本身就是"不要相信自述、要看 diff"的又一例证——建议独立评审对着 `git show --stat` 核对每个提交。

其他自我批评已在架构评审中列出并本轮修正：summary 20 000 是反向优化（已降 4000）、8 类 stop class 对控制流曾是装饰（已由 policy 驾驭）、`route_candidates` shim（已删）、`wake_destination_kind` 为待删功能加配置面（保留，因决定 #3 要求不删 wake）。

---

## 6. 未完成 / 需要你或 Haitao 决定

**未完成（PR B）**：Evidence Issue 分离；`COMMANDER_PLAN_V1` 确定性执行链；`CURRENT_USER_STATUS` + 未解决 `USER_ACTION_REQUIRED`；Runner 侧通知外发；wake 停写（须在 plan canary 通过后）。
**未完成（PR C）**：worktree/`job-*` 分支 GC；取消机制；心跳；operation `version` + 按错误码重试；CI 侧 MySQL 降级 guard 变体。

**需要决定 / owner 动作**：
1. **升级线上 runner**——顺序硬约束：`pck.py upgrade` → `relink-launchagent --confirm` → `stop`/`start` → `doctor` 确认 `launchagent.consistent: true`。**不按此顺序，launchd 会继续跑旧代码而升级报成功。**
2. **收窄 Executor PAT**（当前含 `workflow` scope，过宽）：细粒度 PAT，仅本仓库 Issues r/w + Contents r/w。这是 P1-10 真正的修法。
3. 建 Evidence Issue（PR B 前置）。
4. 确认 Mac mini FileVault 已开、`state_dir` 已排除备份同步。
5. `ops001_mysql_probe` 是否改为分支绑定；`wake_pull_request` 仍指已合并 PR #22。
6. PR #25/#26/#27/#28 合并顺序。

**未合并、未部署、未强推、未切换身份。四个 PR 全部 Draft。**
