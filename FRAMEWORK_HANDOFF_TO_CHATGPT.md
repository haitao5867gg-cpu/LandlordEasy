# Project Commander 控制面：第二轮加固与交接报告

**收件人**：本框架的原设计者（Commander，ChatGPT Work session）
**执行者**：Claude Code（Opus 5），以 **Executor** 身份（`haitao5867`）操作，全程未切换到 Commander 身份（`haitao5867gg-cpu`）
**日期**：2026-09-10
**范围**：独立验收提出的 12 项框架缺陷，以及 PR #27 的真实 MySQL 收尾

这份报告不依赖任何对话记忆，可独立阅读。它**取代**上一版同名报告。

---

## 0. 当前 head 与 CI

| 对象 | 精确 SHA | 状态 |
|---|---|---|
| **PR #26** `infra/commander-kit-hardening` → `dev` | `ce95120` | Draft，CI 见第 5 节 |
| **PR #27** `fix/rel001-cross-type-approval` → `release/v1-rehearsal-candidate` | `652fdeb284d1ec55acd21abd74d0a50e0f83b520` | Draft，CI 见第 5 节 |
| **PR #28** `docs/control-plane-state-drift` → `dev` | `f644a68` | Draft，**CI 绿** |
| `release/v1-rehearsal-candidate` | `fd23cdc` | 仅 CI 触发器提交 |

**线上 runtime provenance**：`~/.local/lib/landlordeasy-commander/` 目前运行的是**上一轮**加固版
（`commander_runner.py` sha256 `49288bb04a964475d07124327e545ee66528c9549d73a1ac3a38cc7ef3913077`，
`installed_at` 2026-09-10T00:16，manifest **schema v2，无 source_commit**）。
本轮的改动**尚未安装到线上**——见第 7 节。

---

## 1. 十二项验收发现的处理结果

| # | 发现 | 处理 |
|---|---|---|
| 1 | `pck.py doctor` 对损坏 JSON / 错误权限 / 缺字段仍可能 `ok:true` | **已修**。根因是它把整份报告 flatten 后接受"不等于 `False`"的任何值——于是 `"invalid: ..."` 这种诊断字符串算通过。改为显式收集 `failures`，`ok` 就是"没有失败"。补了 12 个负向测试：损坏 JSON、`0644`/`0640` 权限、6 个必填字段缺失、空字段、Commander/Executor 同名、非对象 JSON、配置文件不存在、安装后被篡改。 |
| 2 | install/upgrade/rollback 非事务化 | **已重写**。版本目录 `versions/<时间戳>-<短 commit>/` 不可变；完整暂存 → 按落盘字节校验 → `fsync` 文件与目录 → 原子换 `current` 符号链接（`os.replace`）→ 换完再全量校验。任一步失败保留原版本并清掉暂存目录，**不存在文件与 manifest 不一致的窗口**。rollback 只改指针、从不删除，且**拒绝激活字节与 manifest 不符的版本**。 |
| 3 | `store_raw_output` 周围静默 `suppress` | **已删**。持久化失败改为 `PERSISTENCE` 错误，**不再继续解析、不再发布成功终态**——字节没落盘就无法免费恢复，此时报成功是撒谎。 |
| 4 | 额度路由依赖 `provider_failover=false` | **已重构**。把"替换 worker"（`provider_failover`）与"花钱"（paid overflow）拆成两个独立策略。原来前者会在考虑付费层之前把候选列表截断到 1 个，于是 owner 的付费授权**永远无法生效**。新增 `paid_overflow_max_attempts`（单任务付费尝试上限）与 `paid_overflow_max_cost_usd`（窗口内支出上限），两者在调度付费尝试**之前**强制。 |
| 5 | 错误协议过粗 | **已细化**为 invocation / environment / transient / protocol / code / safety / approval / unclassified。**命令解析、CLI 参数、resolver、测试选择器错误一律归 `INVOCATION_FAILURE`，绝不算业务代码失败**；裸的非零退出在没有正面证据（断言、红套件、类型错误）时归 `UNCLASSIFIED_FAILURE` 而不是 `CODE_FAILURE`。 |
| 6 | 需要无人值守的隔离真实 MySQL operation | **已实现并真跑通** —— 见第 2 节。 |
| 7 | manifest 缺 provenance | **已加** `schema_version`、`source_commit`、`installed_at`、全部文件哈希。`doctor` 会用 `git cat-file blob <commit>:tools/commander-runner/<file>` 把安装字节与它自称的 commit 逐一比对；commit 本地不存在时报告 **unverified**（而不是 verified）。 |
| 8 | wake destination 迁移 | **已设计，未动线上**。新增 `wake_destination_kind`：`legacy`（历史行为，当前线上指向已合并的 PR #22）与 `wake_bus`（专用长期开放 PR）。声明为 `wake_bus` 后，若目标不是开放 PR 则**拒绝投递**并在 `doctor` 中报不健康。配置、健康检查、测试、迁移与回滚方案齐备；**线上目标刻意保持不变**。 |
| 9 | 两份源码人工漂移 | **已消除**。`tools/commander-runner/` 为唯一源；`project-commander-kit/runner/` 由 `scripts/sync_from_source.py` 生成；CI 增加 `--check` 步骤，漂移无法合入。（这个守卫在本轮开发中**真的抓到了我自己的漂移**。） |
| 10 | 文档声称未达成的保证 | **已修正**。taxonomy 表与代码一致，测试数更新，`FRAMEWORK_SUMMARY.md` 新增"**What this does NOT guarantee**"一节。 |
| 11 | `CURRENT_STATE.md` 漂移 | **已拆为独立 PR #28**，纯文档，不与 runtime 修复混在一起。 |
| 12 | 普通 push、保持 Draft | 已照做。未合并、未部署、未强推。 |

---

## 2. PR #27 的真实 MySQL 收尾证据

在**精确 head `652fdeb284d1ec55acd21abd74d0a50e0f83b520`** 上，通过新注册的
`rel001_mysql_suite` operation 运行完整真实 MySQL 套件：

```
status  : ok
summary : REL-001 isolated MySQL suite passed
candidate_sha        = 652fdeb284d1ec55acd21abd74d0a50e0f83b520
compose_project      = landlordeasy_ops001
bind                 = 127.0.0.1:33317
startup_attempts     = 1
schema               = applied
isolation_boundary   = verified
container_identity   = exact
container_health     = healthy
image_identity       = exact
loopback_binding     = exact
storage              = tmpfs_zero_volumes
mysql_major          = 8
tables               = 22
rows_before          = 0
jest                 = Test Suites: 5 passed, 5 total; Tests: 12 passed, 12 total
rows_after           = 0
exit                 = 0
```

**包含 `rel001-cross-type-approval`**（新增的跨类型并发审批用例）。
**没有执行额外的五次重复**——按上一轮结论，那对结构性保证不增加信息。

同一 head 上的其他验证：

- `pnpm --filter server exec tsc --noEmit` — 通过
- `pnpm --filter server test -- --runInBand` — **230 passed / 12 skipped / 0 failed**

### 隔离边界

loopback-only `127.0.0.1:33317`；`/var/lib/mysql` 为 tmpfs；项目卷数为 0；容器名与 compose
项目精确匹配；镜像摘要精确匹配 `mysql@sha256:7dcddc01…`；数据库起止行数均为 0，因此本次运行
的每一行都是合成的、可归因的。**未接触生产、真实用户数据、支付或任何第三方 provider。**

### 过程中修掉的两个我自己的 bug（都是真跑才暴露的）

1. operation 里我把边界探针放在了 schema 应用**之前**，而探针断言表数为 22 —— 顺序错误。
2. 我的新测试假设 `createTransferFixture` 会写入 RECEIVE 押金记录，实际它不写（只有
   `createTerminationFixture` 写）。断言因此永远失败，而失败又会留下 fixture 行，
   连带让后面的 maintenance 套件的"数据库必须为空"前置条件失败——**表面上 12 个测试全挂，
   实际只有 1 个真失败**。这正是"必须保留失败前已收集的证据"的最好例证：我为此让
   `ProbeError` 携带 evidence 后，一次运行就定位了。

---

## 3. 关键设计判断（供你复核）

**把"替换 worker"和"花钱"拆开**。原来 `provider_failover=false` 会让付费兜底静默失效。这两件
事的风险属性完全不同：前者是工作路由偏好，后者是支出决定。合在一个开关里，等于让一个技术
偏好否决了 owner 的商业授权。

**裸的非零退出不算"你的代码坏了"**。这是本轮改动里我最有把握的一条。误判的代价不对称：把
环境问题说成代码失败，会让人去调试一个本来没问题的产品；反过来最多是多重试一次。所以
`CODE_FAILURE` 现在需要正面证据。

**`UNCLASSIFIED_FAILURE` 是新增的第八类**。你给的六类里没有它，但我认为"猜不出来"必须能被
如实表达，否则只能在"算代码失败"和"算环境失败"之间二选一，两个都是编造。

**版本目录 + `current` 指针**，而不是原地替换。`runtime_manifest_health` 同时支持新旧布局，
所以线上那套 flat 布局不会因为这次改动而失效。

---

## 4. 仍未完成 / 刻意未做

1. **本轮 runtime 尚未安装到线上。** 线上仍是上一轮版本（manifest v2，无 provenance）。
   装上去之后 `doctor` 才会报 provenance 已验证；在此之前它会如实报告"legacy manifest
   without provenance"。这是一次**部署动作**，按约束我不做。
2. **`wake_pull_request` 仍指向已合并的 PR #22。** 迁移机制已就绪但刻意未改线上目标。
   建议：开一个专用的长期 Wake Bus PR，把 `wake_destination_kind` 设为 `wake_bus`。
3. **webhook 签名校验仍未实现。** 仓库里没有入站监听器（`doctor` 报
   `NO_INBOUND_LISTENER_IMPLEMENTED`），没有可挂载的地方，我没有凭空造一个。
4. **`ops001_mysql_probe` 的 SHA 钉子未替换。** 分支绑定机制可用，但改线上配置不是本轮必需。
5. **operation 未经由队列真实派发过。** 我以 Executor 身份运行了 helper 本身（同一份代码路径），
   **无法**发 `COMMANDER_OPERATION_V1` 评论——那需要 Commander 身份，身份隔离不能破。
   真正的端到端派发验收需要你来发那条评论。
6. **架构复核仍在进行中。** 我并行启动了一个独立的架构评审，结论尚未返回。

---

## 5. 验证汇总

| 项目 | 结果 |
|---|---|
| 框架离线套件 | **187/187 通过**（上一轮 151，基线 101） |
| kit 套件（同一份源码） | 187/187 |
| 端到端 canary | **21/21** |
| 源码漂移检查 | 通过（CI 强制） |
| PR #27 tsc | 通过 |
| PR #27 完整 Jest | 230 passed / 12 skipped / 0 failed |
| PR #27 真实 MySQL | **5 套件 / 12 测试全过，行数 0→0** |
| PR #28 CI | 绿 |
| PR #26 / #27 CI | 见分支状态（推送后触发，`release/**` base 与 `test/**`/`infra/**` push 均已覆盖） |

---

## 6. PR #25 的处置

按要求：PR #27 通过真实 MySQL 验收后，PR #25 标记为 **superseded**，
但**不合并、不关闭**，等待 Commander 决定。

理由：PR #25 的内容已被 PR #27 完全包含（PR #27 基于 `2ba3f3d` 并在其上修复 P0），
且 PR #25 的精确 head `2ba3f3d` 从未获得任何 CI 运行，也从未跑过跨类型并发用例。

---

## 7. 需要你/Haitao 决定的动作

1. 把本轮 runtime 安装到线上（`pck.py upgrade`，可 `rollback`）。
2. 开专用 Wake Bus PR 并切换 `wake_destination_kind`。
3. 用 Commander 身份发一条 `COMMANDER_OPERATION_V1`，对 `rel001_mysql_suite` 做真正的
   端到端派发验收。
4. 决定 PR #25 / #26 / #27 / #28 的合并顺序。
5. 是否把 `ops001_mysql_probe` 改为分支绑定。

**未合并、未部署、未强推、未切换身份。四个 PR 全部保持 Draft。**
