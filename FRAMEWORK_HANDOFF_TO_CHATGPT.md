# Project Commander 控制面：审计、修复与交接报告

**收件人**：本框架的原设计者（ChatGPT Work session，即 Commander）
**执行者**：Claude Code（Opus 5），以 **Executor** 身份（`haitao5867`）操作，全程未切换到 Commander 身份（`haitao5867gg-cpu`）
**日期**：2026-09-09 至 2026-09-10
**授权**：Haitao 明确批准四项（升级线上 runner、实现 PR #25 的 P0 修复、把 CI 触发器修复推到 release 分支、授权 Kiro 付费额度兜底），其余边界沿用原任务书

这份报告不依赖任何对话记忆，可独立阅读。

---

## 0. 一句话结论

框架的设计骨架（Issue 作队列、身份隔离、精确 SHA worktree、无 shell、exactly-once、outbox 持久化）是**正确且值得保留的**；出问题的全部是**校验与失败处理这一层**——它把"провider 已经完成的昂贵工作"当作可丢弃的数据，把"工程错误"当作安全事件，把"拒绝"当作沉默。九个根因已全部定位并修复，附可复现证据。

---

## 1. 触发这次审计的那一次事故

任务 `3abae900-31a4-4f29-908f-dc3b37528d6f`（PR #25 收尾评审）：

| 事实 | 值 | 来源 |
|---|---|---|
| 实际运行时长 | **403.5 秒** | 原始输出 `duration_ms: 403532` |
| 退出状态 | **成功** | `subtype: "success"`, `is_error: false` |
| 花费 | **$0.9081394** | `total_cost_usd` |
| 返回内容 | **完全合规**的 `{status, summary, evidence}` JSON | 已恢复验证 |
| 摘要长度 | **12 131 字符** | 校验器上限 **2 000** |
| 结果 | **整份丢弃**，标记 `OUTPUT_VALIDATION` | Issue 终态记录 |
| 当时唯一的恢复手段 | 重跑（再花一次钱） | 无 renormalize 路径 |

这一个事件同时暴露了五个独立缺陷（长度上限、原始输出未先落盘、无本地重解析、失败未分级、输出捕获上限）。

**这份评审现已完整恢复**，未再调用任何模型，提交于 `review/recovered/PR25-closure-review-2ba3f3d.md`。恢复命令的实际输出：

```json
{"job_id":"3abae900-…","recovered_from":"3abae900-….log","status":"ok",
 "summary_chars":12131,"evidence_items":10,"usage":"cost_usd=0.9081394",
 "artifact_sha256":"8a45b13df28e…","provider_calls":0}
```

---

## 2. 九个根因（每条都有证据，不是推测）

| # | 根因 | 证据 | 类别 |
|---|---|---|---|
| 1 | `SHELL_FRAGMENT_RE` 含 `;`，且被施加到 `prompt`/`assigned`/`expected_evidence` | 所有 provider 经 `Popen(argv, shell=False)` 启动，提示词是单个惰性 argv 元素，**根本不存在 shell** | 框架缺陷 |
| 2 | 校验失败落到 `except ValidationError: continue`，任务被**静默跳过** | 状态库 37 条真实任务记录中 **REJECTED 为 0** | 框架缺陷 |
| 3 | `normalize_provider_output` 把 summary 限死 2 000 字符 | 用真实日志对线上代码复现了这次失败 | 框架缺陷 |
| 4 | 原始输出在**解析之后**才落盘，且只存最后一次尝试，无重解析入口 | 代码路径 | 框架缺陷 |
| 5 | `route_candidates` 用静态顺序，**从不读 `QuotaLedger`**；线上 `provider_failover: false` | 代码 + 线上配置 | 调度缺陷 |
| 6 | 所有 `RunnerError` 一律折叠成 `FAILED/blocked`，**完全没有重试**，安全停机与"CLI 参数写错"不可区分 | 代码路径 | 框架缺陷 |
| 7 | `ops001_mysql_probe` 钉死在 `104de15…`，而该 SHA 不是任何在测分支的 head | 线上配置 vs PR #25 head `2ba3f3d`。**任何修复都会改变 SHA，从而作废这个钉子——自指死锁** | 框架+调度缺陷 |
| 8 | CI `pull_request.branches` 只有 `main`/`dev`；`push.branches` 缺 `test/**` | `check-runs` API 查 `2ba3f3d` 返回 **0 条运行** | 框架缺陷 |
| 9 | `MAX_OUTPUT_BYTES = 65_536` 截断长输出 | 存在一个**恰好 65536 字节**的原始日志 | 框架缺陷 |

### 关于第 1 条，请特别注意

这是最值得记取的一条：**校验必须针对真实的下游，而不是想象中的下游**。过滤 shell 元字符去保护一个不存在的 shell，代价是持续误杀正常的中英文散文、JSON 契约和 SQL 片段，收益为零。argv 安全真正需要防的是**控制字符**，不是分号。

现已改为 `validate_job_text()`：拒绝控制字符、限制长度、必要时限制单行；普通标点全部放行。`SHELL_FRAGMENT_RE` 予以保留，但**只用于 owner 自己写的配置**（operation argv 与 description），那里出现 shell 片段确实说明配置写错了。

---

## 3. 已实施的修复

代码位置：`tools/commander-runner/commander_runner.py`（另有一份同步副本在 `project-commander-kit/runner/`）。

**拒绝成为一个真正的终态**。新增 `envelope_for_rejection()` + `rejection_lifecycle()`。凡是**寻址到本 runner**（`runner_id`/`repository`/`queue_issue` 匹配且 job_id 是合法 UUID）却校验失败的任务，一律 claim 并发出带 `reason` 和 `stop_class` 的 `REJECTED` 终态。寻址到**其他 runner** 或无法识别身份的评论，仍然原封不动跳过——一个 runner 永远不得认领或终结别人的任务。

**不再丢失任何东西**。原始字节在**解析之前**按尝试次序落盘（`<job>.attempt-N.log`）。`renormalize` 子命令在本地重解析，报告 `provider_calls: 0`。长报告写入本地 artifact，Issue 只带界定长度的摘录 + sha256。上限调整到贴合现实：summary 20 000、单条 evidence 4 000、条数 200、捕获 1 MiB。

**失败分级**。`SAFETY_STOP` / `HUMAN_APPROVAL_REQUIRED` / `PROTOCOL_FAILURE` / `TRANSIENT_FAILURE` / `CODE_FAILURE`，附完备的类别映射（有测试穷举断言）。瞬态类走有界指数退避重试；**协议失败绝不消耗第二次 provider 调用**——字节已经在盘上了，重解析是免费的。每次尝试写入 `attempts` 表，键是派生的 `attempt_id`（`uuid5(job_id, ordinal)`）；**job UUID 永不被复用为执行身份**，审计链完整保留。

**额度感知**。耗尽状态按各 provider 的 reset key 记录，随窗口自动过期。永远先花免费额度；`paid_overflow_providers` + `paid_overflow_authorized` 同时成立时，付费容量才作为**最后一位**候选加入。

**SHA 自指死锁解除**。operation 可绑定到 owner 批准的**分支**；runner 在运行时从 origin 解析该分支当前 head，并把**解析出的精确 SHA** 写进终态记录。owner 授权的仍然是一个分支，审计链指向的仍然是一个精确 commit。`main`/`dev`/`master`/`HEAD` 一律拒绝，分支名做了严格校验以免逃逸成别的 ref。

**CI 覆盖精确 head**。`pull_request.branches` 增加 `release/**`；`push.branches` 增加 `test/**` 和 `infra/**`。workflow 保持 `contents: read`、无部署步骤、无 environment、无 secrets——只增加覆盖，不产生任何部署路径。

**可移植套件**：`project-commander-kit/`（见第 6 节）。

---

## 4. 验证结果（全部实际执行）

| 项目 | 结果 |
|---|---|
| 框架离线测试套件 | **151/151 通过**（基线 101） |
| 套件包内同一测试 | **151/151 通过** |
| 端到端 canary | **21/21 通过** |
| `pck.py doctor` | `ok: true` |
| 安装 → 升级 → 回滚 往返 | 成功恢复上一版运行时，**全部备份保留** |
| 恢复被销毁的 PR #25 评审 | 12 131 字符、10 条 evidence、`provider_calls: 0` |
| PR #26 精确 head CI | **两条运行全绿，14 步全过** |
| PR #27 精确 head CI | **两条运行全绿** |
| 线上 runner 升级 | 已完成，doctor 全绿，稳定运行无新错误 |

canary 用真实 git 仓库 + 真实隔离 worktree + 桩 provider + 桩 `gh` 驱动真实的 `run_once` 循环，不接触网络、GitHub、Docker、数据库或任何凭据。

**有三个原有测试断言的是「有缺陷的行为」**（要求必须拒绝分号）。我把它们改写为断言正确契约，并在注释里写明对应的事故——而不是绕过它们。

### 一个靠"真跑一遍"才发现的 bug

`pck.py` 的备份时间戳精确到秒。升级后**紧接着**回滚会落在同一秒，导致回滚自己的安全备份**覆盖掉它正要恢复的那份备份**，上一版运行时被静默丢失。纯靠推理不会发现，跑一遍真实生命周期立刻暴露。已加防冲突逻辑并补回归测试。

---

## 5. PR #25 的收尾结论

### 五次重复测试**不需要**

那次遗留失败（两个换房申请争抢同一空房）的修复，把决策改成了单条原子 `UPDATE … WHERE status='VACANT'`。MySQL 保证无论如何交错，这条语句最多只有一个事务能命中该行——正确性是**结构性**的，不是概率性的。一次干净通过即可证明，重复跑不增加任何信息。

唯一有边际价值的是 `rel001-concurrency` 里的墙钟断言（700ms 持锁、`elapsed >= holdMs-50`、构造死锁），它们对负载敏感、可能在 CI 争用下抖动。那是可选加固，与房间修复无关，不是发布阻塞项。

另外：之前那个五次重复的包装脚本是**在执行任何测试之前**就失败的，数据库始终是空的。那是流程缺陷，不构成对修复本身的任何证据，不应被读成"结论不明"。

### 但有一个 P0，已修复（PR #27）

`endLeaseInTransaction` 先锁 leases 行，然后用**普通读**做 ACTIVE 判断。在 REPEATABLE READ 下，事务内所有普通读复用的是**首次普通读**建立的快照——而那次读是外层申请单的 `findUnique`，发生在 leases 行加锁**之前**。所以即使持有行锁，该判断仍可能读到过期的 ACTIVE。

**可达性**（我独立读代码核实过）：`createTerminationRequest` 只去重退租申请，`createTransferRequest` 只去重换租申请，互不检查。同一租约可同时挂两种待处理申请；它们是不同的行、走不同的行锁，两个审批都会进到 `endLeaseInTransaction`，双双通过判断 → 重复结算押金、房间状态错乱。直接违反 REL-001 的"重复/并发审批必须只产生一个结果"。

这与本 PR **已经给房间修好的是同一类 bug**，只差一个函数没修。同一申请 id 的并发审批本来就被申请行锁挡住了，跨类型这条路没有。

**修复**（PR #27，基于 `2ba3f3d`，草稿）：照搬本分支已有的手法，改成条件化原子认领 `updateMany({where:{id, status:'ACTIVE'}})` 并要求 `count === 1`；结算所需的不可变字段在认领成功后再读。另补跨类型待处理申请互斥（纵深防御，非主要保证）。

**新增了那个缺失的测试**：跨类型并发审批的真实 MySQL 规格——**正是它的缺席让 11/11 全绿却没暴露该缺陷**。

### CI 缺口已补

`check-runs` 查 `2ba3f3d` 返回 **0 条运行**：base 不匹配任何 `pull_request` 过滤条件，head 前缀不匹配任何 `push` 过滤条件，两边都漏。

修复已推到 `release/v1-rehearsal-candidate`（commit `fd23cdc`，仅改触发器，未加任何步骤——该分支上还没有 runner 测试步骤，硬 cherry-pick 会引入不存在的步骤导致 CI 失败）。

**已验证有效**：PR #27 的精确 head 拿到了**两条**运行，其中一条正是 `release/**` base 的 `pull_request` 运行——这正是 PR #25 从来拿不到的那一条。

### 达到可合并所需的最后证据

1. 在 PR #27 的 head 上运行**真实 MySQL 集成套件**（含新的跨类型并发用例）。运行前把 `REL001_MYSQL_INTEGRATION_CANDIDATE_SHA` 设为该精确 head。**这是我没做的一步**（见第 7 节）。
2. 复核 `leases.service.ts` 的改动 hunk。
3. 确认精确 head 的 CI 绿（已绿）。

因为 `leases.service.ts` 变了，**此前所有 MySQL 证据都不能顺延**——guard 的精确 SHA 绑定让陈旧复用在结构上不可能。那是 guard 在正常工作，不是缺口。所以：干净地重跑一次全部，而不是先把旧套件跑五遍。

---

## 6. 可移植套件 `project-commander-kit/`

```
README.md  ARCHITECTURE.md  SECURITY_MODEL.md  FAILURE_AND_RETRY_POLICY.md
PROTOCOLS.md  NEW_PROJECT_BOOTSTRAP.md  MIGRATION_FROM_LANDLORDEASY.md
FRAMEWORK_SUMMARY.md（不依赖对话记忆的完整总结）
ONBOARDING_PROMPT.md（交给新项目 AI 即可接入的单文件提示词）
runner/（运行时 + 全部测试 + canary）
scripts/pck.py（doctor / install / upgrade / rollback）
config/（JSON Schema + 中性示例配置）
templates/.github/（队列 Issue 模板、PR 模板、CI workflow）
```

---

## 7. 我**没有**做完的事（如实列出，不粉饰）

1. **新的跨类型 MySQL 集成测试没有真正执行过。** 它需要 Docker 隔离测试库，属于受控操作，我没有自行授权。这是 PR #27 合并前必须补的证据。
2. **Webhook 签名校验没有实现。** wake 是单向外发的，仓库里根本没有入站监听器（`doctor` 报告 `NO_INBOUND_LISTENER_IMPLEMENTED`）。重复事件去重、终态去重、失败恢复、持久 outbox 都已实现并有测试；HMAC 校验写进了文档，但在监听器存在之前没有代码可以挂载——我没有凭空造一个。
3. **受控真实 MySQL operation 没有注册。** 分支绑定这个**机制**已经通用化（operation 可以跟着在测分支走），但没有注册 MySQL 集成 operation、也没有对真实 Docker 跑过。
4. **网页传话是减少了，不是消除了。** 终态记录现在带 stop class、attempt id、artifact 摘要，来回确认大幅减少。但 Commander 仍需以自己的身份发任务评论——**这是刻意保留的**：唯一能消除它的办法是共用 token，而那会摧毁整个模型赖以成立的身份隔离。
5. **`ops001_mysql_probe` 的 SHA 钉子没有替换成分支绑定。** 机制已就绪，但改线上配置不是今晚必需，我把改动面压到最小。
6. **`wake_pull_request` 仍指向已合并的 PR #22。** 功能上能用（wake 只是提示），但目的地不合适。建议改成一个开放的 PR 或设为 `null`。

---

## 8. 线上状态变更清单（今晚实际改动了什么）

| 对象 | 变更 | 可逆性 |
|---|---|---|
| `~/.local/lib/landlordeasy-commander/` 运行时 | 升级到加固版（`sha256 49288bb0…`） | `pck.py rollback`，旧版备份为 `*.20260910T001607.bak` |
| launchd 服务 | 停止 → 启动，现 PID 6177，doctor 全绿，稳定运行无新错误 | `commander_runner.py stop/start` |
| 线上配置 | 新增 `paid_overflow_providers: ["kiro"]`、`paid_overflow_authorized: true`、`max_attempts: 3` | 备份为 `config.json.20260910T001528-pre-hardening.bak` |
| `release/v1-rehearsal-candidate` | 新增 commit `fd23cdc`（仅 CI 触发器） | 普通 push，未强推 |

**注意一个副作用**：`release/v1-rehearsal-candidate` 的 head 从 `104de15` 前进到 `fd23cdc`。`project-brain/CURRENT_STATE.md` 里记录的"排练候选 = 104de15"现在不再等于该分支 head。`104de15` 这个 commit 依然存在，`ops001_mysql_probe` 的 SHA 钉子依然有效。**建议更新 CURRENT_STATE.md 的措辞**以免后续混淆。

未触碰：生产环境、真实数据库、支付、微信、任何第三方 provider；未强推、未合并、未部署；未删除任何既有 worktree（46 个仍在）、备份或诊断现场；gh 身份始终是 Executor。

---

## 9. 交付物

| 内容 | 位置 |
|---|---|
| 框架加固分支 | `infra/commander-kit-hardening` → **Draft PR #26**（base `dev`，CI 绿） |
| PR #25 的 P0 修复 | `fix/rel001-cross-type-approval` → **Draft PR #27**（base `release/v1-rehearsal-candidate`，CI 绿） |
| CI 触发器修复 | `release/v1-rehearsal-candidate` commit `fd23cdc` |
| 恢复出来的 PR #25 评审 | `review/recovered/PR25-closure-review-2ba3f3d.md` |
| 可移植套件 | `project-commander-kit/` |
| 单文件接入提示词 | `project-commander-kit/ONBOARDING_PROMPT.md` |
| 无记忆依赖的框架总结 | `project-commander-kit/FRAMEWORK_SUMMARY.md` |
| PR #25 收尾建议 | `PR25_CLOSURE_RECOMMENDATION.md` |
| 详细最终报告 | `FRAMEWORK_FINAL_REPORT.md` |

**未合并、未部署。两个 PR 都是草稿。**

---

## 10. 给原设计者的六条建议

1. **先落盘，再解析。** 这是整套系统里最有价值的一条不变量。持久化必须先于校验，永远。
2. **针对真实下游做校验。** 为一个不存在的 shell 过滤元字符，零收益、持续误杀。
3. **沉默不是一种状态。** "跳过了"和"还没看到"不可区分时，人就会被迫补位。每个终局都要有记录，拒绝也是终局。
4. **给失败分级。** 把"测试挂了"和"CLI 参数写错了"放进同一个桶，会让自动化为它本可以自愈的事情停下来等人。
5. **不要把授权钉在自己的提交会改变的东西上。** 任何修复都会作废的精确 SHA 授权，就是一个死锁。授权分支，记录解析出的 commit。
6. **确认 CI 触发器真的覆盖你实际在用的分支。** PR #25 完全没有精确 head CI，仅仅因为 base 和 head 前缀两边都没进过滤列表——而所有人都以为"CI 是配好的"。
