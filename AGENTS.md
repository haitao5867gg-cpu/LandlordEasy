# LandlordEasy — Agent Bootstrap

> 2026-09-05 V1.0 Release Management 生效。Haitao 为 Product Owner；Commander 管理优先级、Spec、验收与发布。以 GitHub 文档恢复状态，不依赖长聊天。

## 开工顺序
1. 本文件。
2. `project-brain/CURRENT_STATE.md`。
3. `project-brain/RELEASE_PLAN.md`。
4. 分配的 `specs/SEC-*.md` / `specs/REL-*.md` 和对应 Issue。
5. 相关代码；需要历史依据时查 `specs/requirements.md`、`specs/design.md`、`specs/tasks.md`、`review/review-notes.md`、`PROJECT_STATUS.md`。

## 当前工作规则
- 先读 `project-brain/AGENT_RULES.md` 与 `RELEASE_GATE.md` 的验收要求。
- FEATURE FREEZE：只处理安全、发布阻塞、M19–M21 必需缺口、严重 UX 和生产 bug。
- 常规 UX/API/DB 实现与测试由 Commander 决定；不再把所有技术疑问提交用户审批。法律/合同、商业规则、重大方向、新成本、第三方商务、生产不可逆操作、真实用户重大策略仍由 Haitao 决策。
- `COLLABORATION.md` 保留历史执行经验和验证底线；其中旧的角色分工、全量历史 bootstrap、任务顺序与“一切不确定都等用户”规则，由本次交接明确取代。
- 任何旧 milestone 的已完成不等于 V1 release gate 通过。先核对当前 commit、环境和实际证据。
- 当前优先级 SEC-001 → 其他已分配 Release Spec。未分配的新功能不自主开工。
- 调 Kiro CLI 之前仍须读 `KIRO_CLI_NOTES.md` 和适用官方说明，确认实际可用；不假设不同订阅共享额度或可自动调度。

## 几条不能忘的硬性规则(详见 COLLABORATION.md,这里摘重点)

- 不要相信 Kiro(或者自己)的自述,任何"完成"都要独立跑一遍验证:`tsc --noEmit`、`jest`、`vue-tsc -b`、真实浏览器验证、确认部署实际生效
- 每次要汇报/记录状态前,先跑 `git status` 和 `git diff --stat`,如实覆盖所有变更文件,不能选择性汇报——这条是真实踩过坑总结出来的(Kiro 曾经漏报了一批已经影响生产环境 `WECHAT_MODE` 的未提交改动)
- 日期/账期/金额相关的新逻辑,先去 `BillEngineService` 里找有没有现成的算法可以复用,不要重新发明
- 生产环境的重大状态变化(比如切换微信真实登录模式)必须是明确沟通过的决定,不能是脚本的隐藏副作用
- 涉及生产部署/服务器配置/数据库/密钥的操作,Kiro CLI 调用不要用 `--trust-all-tools` 一刀切,要逐步授权
- **状态要随时落盘,不要等对话快被压缩才补**:每完成一个任务勾选、跑完一轮验证、或做出一个关键决策,立刻更新 `tasks.md`/`review-notes.md`/`PROJECT_STATUS.md`,不要攒在对话记忆里等被动触发压缩才一次性补——压缩什么时候发生不一定能精确预判,只要重要信息持续同步在文件里,压缩本身就不再是风险点

## 项目背景一句话

嘉定公寓,3 栋楼(Q/R/S,约 130 间房,历史数据),未来扩展到 4~5 栋、约 300 间房。3 位房东家人共用。技术栈:pnpm monorepo,NestJS+Prisma+MySQL 后端,Vue3+Vant4 双前端(landlord-h5 房东端 + tenant-h5 租客端)。生产域名 `landlordeasy.cn`,已备案,HTTPS 已生效。
