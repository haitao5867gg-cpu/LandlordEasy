# LandlordEasy(房屋收租系统)—— Claude Code 项目须知

> 这个文件会在每次会话开始时自动加载。不管这是全新会话,还是长对话压缩/重启之后的会话,**先按下面的顺序读完文档,再做任何判断或决策**——本仓库是这个项目的唯一信息源,不要依赖对话记忆里的印象。

## 开工前必读(按顺序)

1. `COLLABORATION.md` —— 协作规则、交付标准、Kiro CLI headless 调用方式,全部硬性要求都在这
2. `PROJECT_STATUS.md` —— Kiro 维护的项目状态文档,文末"最新状态"章节记录了最近一次线上部署的详细验证过程(域名/HTTPS/微信 real 模式/白名单/稳定性测试),跟 review-notes.md 的"交接现状快照"互补,两份都要看
3. `specs/requirements.md` / `specs/design.md` —— 需求和技术方案
4. `specs/tasks.md` —— 任务清单和当前进度,**认这份文件里的勾选状态,不要认对话记忆里以为的进度**
5. `review/review-notes.md` —— 尤其看最后的"交接现状快照"和最近几条 Review,了解当前卡点和已知问题
6. `questions.md` —— 有没有悬而未决的问题
7. `KIRO_CLI_NOTES.md` —— 调用 Kiro CLI 之前先看一眼,避免语法写错、避免踩过的坑重踩

## 几条不能忘的硬性规则(详见 COLLABORATION.md,这里摘重点)

- 不要相信 Kiro(或者自己)的自述,任何"完成"都要独立跑一遍验证:`tsc --noEmit`、`jest`、`vue-tsc -b`、真实浏览器验证、确认部署实际生效
- 每次要汇报/记录状态前,先跑 `git status` 和 `git diff --stat`,如实覆盖所有变更文件,不能选择性汇报——这条是真实踩过坑总结出来的(Kiro 曾经漏报了一批已经影响生产环境 `WECHAT_MODE` 的未提交改动)
- 日期/账期/金额相关的新逻辑,先去 `BillEngineService` 里找有没有现成的算法可以复用,不要重新发明
- 生产环境的重大状态变化(比如切换微信真实登录模式)必须是明确沟通过的决定,不能是脚本的隐藏副作用
- 涉及生产部署/服务器配置/数据库/密钥的操作,Kiro CLI 调用不要用 `--trust-all-tools` 一刀切,要逐步授权
- **状态要随时落盘,不要等对话快被压缩才补**:每完成一个任务勾选、跑完一轮验证、或做出一个关键决策,立刻更新 `tasks.md`/`review-notes.md`/`PROJECT_STATUS.md`,不要攒在对话记忆里等被动触发压缩才一次性补——压缩什么时候发生不一定能精确预判,只要重要信息持续同步在文件里,压缩本身就不再是风险点

## 项目背景一句话

嘉定公寓,3 栋楼(Q/R/S,约 130 间房,历史数据),未来扩展到 4~5 栋、约 300 间房。3 位房东家人共用。技术栈:pnpm monorepo,NestJS+Prisma+MySQL 后端,Vue3+Vant4 双前端(landlord-h5 房东端 + tenant-h5 租客端)。生产域名 `landlordeasy.cn`,已备案,HTTPS 已生效。
