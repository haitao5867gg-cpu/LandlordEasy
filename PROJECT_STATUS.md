# 项目状态总结（历史基线：2026-07-20；最新进展见文末）

> 本文件供任何新会话的 Claude / Kiro 快速恢复上下文。仓库是唯一信息源。

## 项目是什么
LandlordEasy 房屋收租系统。嘉定公寓,4~5 栋自建楼约 300 间房(现有 Excel 覆盖 Q/R/S 三栋 130 间),整套出租,3 位房东(家人)共同管理。房东端手机 Web,租客端微信服务号 H5,先跑通「出租→账单→提醒→收款→对账」闭环。

## 协作方式
- 用户(GasCan)只与 Claude 讨论;Claude 维护 specs/ 与 review/;Kiro(Windows, Opus 4.6)按 specs/tasks.md 开发并推送;疑问走 questions.md。规则详见 COLLABORATION.md
- Claude 在 Cowork 中用仓库所有者的 fine-grained PAT 推拉(token 由用户每次会话提供,不入库);Kiro 走协作者邀请或另发 PAT
- Claude 沙盒只通 github.com HTTPS,SSH/Gitee/api.github.com 均不通

## 基础设施(避免每次新会话重新问)
- 生产服务器:腾讯云轻量应用服务器(上海),IP `111.229.167.29`,SSH 用户 `ubuntu`,密钥在 `/Users/gascan/LandLordEasy/LandLordEasy_SSHKey.pem`(不入库)。
- 域名 `landlordeasy.cn` 的注册和 DNS 解析也托管在腾讯云(跟服务器同一个账号),不是别的域名服务商;加子域名/改解析记录去腾讯云控制台的"云解析 DNSPod"部分(不是轻量应用服务器面板本身,是同一账号下的另一个功能区)。

## 已定稿(specs/ 三件套,commit 6e0205b)
- requirements.md:需求 v1(含房型模板、房间历史档案、支出管理、租客访问规则、滞纳金默认=当期租金等)
- design.md:NestJS+Prisma+MySQL / Vue3+Vant monorepo;微信能力全部 mock 隔离,无凭证可完成 P1
- tasks.md:M1~M6 共 26 个任务,Kiro 从第一个未勾选任务顺序开发

## 关键业务决策记录
收款码+人工确认先行,微信支付商户号为阶段二;账期按各合同起租日独立滚动;押金按租约单谈;附加费含清洁费/停车费(含车牌);佣金记录在租约;支出管理对应现有「耗材」表,报表算净收益;数据只归档不删除+操作日志;历史 Excel 由 Claude 清洗成 CSV 导入(待办)

## 用户待办
1. 跟 Kiro 说开工(拉仓库、读 COLLABORATION.md)
2. 服务号注册认证(有公司资质,300元/年)
3. 腾讯云轻量服务器(上海,包年)+ 域名 + ICP 备案(2~4 周,尽早)
4. 补录租客姓名/手机号(其余基础数据从 Excel 导入)
5. 阶段二前:申请微信支付商户号
6. GitHub 上邀请 Kiro 的账号为仓库协作者

## 下一步(Claude)
- Kiro 完成 M1~M2 后做首次 review(写 review/review-notes.md)
- 用户提供完整楼栋 Excel 后,清洗生成 data/import/ 标准 CSV

---

## 最新状态：2026-08-09（M11 域名上线收尾）

> 本节覆盖上方 2026-07-20 的过时进度。供 Claude Code 核查当前线上状态和未提交改动。不得在审查或提交中加入 AppSecret、openid、生产密码、生产 `.env` 或私钥。

### 线上已完成并验证

- 主域名 `landlordeasy.cn` 与 `www.landlordeasy.cn` 已启用 HTTPS；Nginx 监听 80/443，普通 HTTP 跳转 HTTPS，微信域名校验文件的 HTTP/HTTPS 地址均返回相同内容。
- Let's Encrypt 证书覆盖主域名和 `www`，自动续期 dry-run 已通过。
- 生产后端 PM2 进程 `landlord-easy` 在线，启动参数明确使用 Node `--env-file=/opt/landlord-easy/apps/server/.env` 和生产入口文件。
- 已用同一路径直接启动 Node 做脱敏检查：`WECHAT_MODE=real`，微信、数据库、JWT 配置键均存在；未输出任何配置值。
- 向生产登录接口提交无效测试 code 后，PM2 日志确认进入 `RealWechatAuthService`，证明运行时不是 mock。
- 前端 `VITE_WECHAT_APPID`、后端 `WECHAT_APPID` 与线上构建包已做脱敏一致性比较，结果一致。
- “海涛”的真实微信已通过一次性服务器内捕获流程写入 `landlords` 白名单，记录确认 `isActive=true`、姓名匹配；用户随后在手机微信中重新点击“房东端”，已确认成功进入系统。
- 一次性捕获结束后，服务器源码与构建产物均已恢复为不记录 openid 的隐私安全版本；含捕获标记的 PM2 日志行已删除，临时脚本已从本地和服务器 `/tmp` 清除。
- 两端线上构建包均已包含备案展示文字 `沪ICP备2026037197号`，链接目标为 `https://beian.miit.gov.cn`。
- 新增稳定性脚本后，从本机连续执行 50 次 `https://landlordeasy.cn/` 请求：50/50 成功、HTTP 200、TLS 校验结果全部为 0，耗时约 0.04～0.17 秒；当前未复现偶发失败。
- 生产部署中曾因服务器残留 TypeScript 增量缓存导致 `dist` 缺模块、短暂出现 502；已清理缓存并完整重建，API 健康检查恢复 200。`deploy/deploy.sh` 本地已加入构建前清理 `dist`/`tsconfig.tsbuildinfo` 的防复发逻辑。

### 本地已完成的代码与配置

- `deploy/nginx.conf`：真实域名、HTTPS、微信校验路径、反代及静态文件配置。
- `apps/server/src/auth/auth.service.ts`：白名单错误使用安全中文提示，日志不记录 openid。
- `apps/server/src/wechat/real-wechat-auth.service.ts`：不记录授权 code/openid。
- `apps/server/src/wechat/real-wechat-notify.service.ts`：不记录消息接收人的 openid。
- `apps/landlord-h5/src/utils/http.ts`：登录接口本身返回 401 时展示后端真实错误；只有已有 token 访问受保护接口返回 401 才提示登录过期。
- `apps/landlord-h5/src/views/Login.vue`：回调后移除一次性 code，页面展示后端中文错误。
- `apps/landlord-h5/src/App.vue`、`apps/tenant-h5/src/App.vue`：全局 ICP footer。
- `deploy/check-site-stability.sh`：可重复执行的 HTTPS/TLS 稳定性检查脚本。
- `deploy/deploy.sh`：生产 PM2 使用明确 env-file，完整构建前清理增量缓存。

### 已执行验证

- `pnpm --filter landlord-h5 build`：通过。
- `pnpm --filter tenant-h5 build`：通过。
- `pnpm --filter server build`：通过。
- `pnpm --filter server exec jest --runInBand`：2 个测试套件、15 项测试全部通过。
- 相关 TypeScript/Vue/Nginx/shell 文件 IDE diagnostics：无问题。
- `bash -n deploy/check-site-stability.sh` 与 `bash -n deploy/deploy.sh`：通过。
- 本地与服务器 9 个已部署受管文件曾逐一比较 SHA-256，全部一致；之后仅本地又修改了 `deploy/deploy.sh` 的防复发逻辑，该文件尚未同步服务器。
- 真实 OAuth 最终验收：用户手机微信登录成功。

### Git 与任务状态（Claude 重点检查）

- 当前提交基线：`105b267`（`main` 与 `origin/main`）。M11 改动仍未 commit/push。
- 与 M11 直接相关、应整理提交的文件：
  - `apps/landlord-h5/src/App.vue`
  - `apps/landlord-h5/src/utils/http.ts`
  - `apps/landlord-h5/src/views/Login.vue`
  - `apps/server/src/auth/auth.service.ts`
  - `apps/server/src/wechat/real-wechat-auth.service.ts`
  - `apps/server/src/wechat/real-wechat-notify.service.ts`
  - `apps/tenant-h5/src/App.vue`
  - `deploy/nginx.conf`
  - `deploy/deploy.sh`
  - `deploy/check-site-stability.sh`
- 文档改动尚未提交：`COLLABORATION.md`、`review/review-notes.md`、`specs/tasks.md`、本文件。
- 新的未跟踪文件 `CLAUDE.md` 与 `KIRO_CLI_NOTES.md` 不是 M11 临时脚本；看起来是 Claude Code 协作/CLI 文档。提交归属应由 Claude Code 判断，不要自动混进 M11 功能提交。
- `.m11-install.js`、`.m11-capture-toggle.js`、`.m11-whitelist-once.js` 均已删除，不应出现在仓库或提交中。
- M11 状态：
  - 11.1：线上/本地版本已核对并同步，但 **commit 尚未完成**，因此仍不能勾选完成。
  - 11.2：代码已完成并部署，构建包已确认包含备案号；**尚缺真实浏览器对两端 footer 视觉与链接点击的最终验收**，暂不勾选。
  - 11.3：50 次连续 HTTPS/TLS 测试全部成功；建议 Claude 再检查近期 Nginx error log、PM2 restart 记录和证书链后决定是否勾选。
  - 11.4：已完成。海涛白名单启用、手机真实微信登录成功、隐私日志恢复并清理。任务文档尚未更新勾选状态。

### 下一步建议

1. Claude Code 先审查 `git diff`、本节证据和 `deploy/deploy.sh` 的 PM2 行为，特别确认已存在进程执行 `pm2 restart` 时仍保留最初的 `--env-file` 参数。
2. 用真实浏览器打开房东端与租客端，确认备案号可见、不会遮挡页面/Tabbar，并验证链接指向工信部备案系统。
3. 检查 Nginx error log、PM2 重启记录和证书链；若无异常，更新 `specs/tasks.md` 的 11.2/11.3/11.4 完成说明。
4. 按连贯范围拆分 commit；不得提交任何生产配置值、openid、私钥或一次性脚本。
5. 所有核查通过后再告知 GasCan 可以重新提交公安联网备案。

---

## 最新状态：2026-08-10（Claude Code 接手后第一轮工作；公安联网备案已重新提交）

> 本节覆盖上方 2026-08-09 的进度（那一节里"下一步建议"5 条已经全部做完）。新会话（不管是本机还是换一台电脑）先看这一节，再按 `CLAUDE.md` 的顺序读其他文档。这是 GasCan 第一次用另一台家里的电脑接续工作前的交接快照。

### 这一轮做了什么（按时间顺序）

1. **11.1 commit 清理（已完成）**：交接时仓库里有一批本地生效但从未提交的 M11 改动（nginx.conf 域名/HTTPS 配置、微信登录隐私日志脱敏、ICP footer、部署脚本 502 防复发等）。逐个 diff 读完后按功能拆成 5 个独立 commit 提交并 push，不是一次性打包 commit。`specs/tasks.md` 11.1 已勾选完成。

2. **9.9 补完成说明并勾选完成**：新签租约的日期选择器 + 到期日自动算（含月末溢出 clamp，逻辑和 `BillEngineService` 一致）+ 全局中文报错，代码其实早就实现了，只是当时没写完成说明。这次本地拉起完整开发环境（docker MySQL + 后端 + 前端），真实浏览器验证了日期选择器交互，并用 curl 端到端验证了 GasCan 最初报告的 `2026/08/10` 格式确实会返回中文报错。

3. **首次正式使用 Kiro CLI headless 模式**：先按 `KIRO_CLI_NOTES.md` 的经验做了一次小的只读试跑确认调用方式无误，再开始承接正式任务。经验已经补充回 `KIRO_CLI_NOTES.md`（`--trust-tools` 的正确 capability 名字、Kiro 会自动生成 `.kiro/` 目录需要 gitignore 等）。

4. **10.8 完成（部分）**：`deploy/deploy.sh` 改成支持 `prod`/`dev` 两个部署目标（必须显式指定，缺失/非法值直接报错退出，不会默认跑到生产）。分两轮做：先做参数化本体，Claude Code 复核时发现 Kiro 自己在总结里主动标出的一个隐患——`prisma migrate deploy` 没区分环境会导致 `deploy.sh dev` 误触发生产数据库迁移——又追加一轮修复（用 Node 原生 `--env-file` 按环境分别解析 `DATABASE_URL`，避免历史上密码含 `#` 被截断的坑）。**这个功能这次部署时才发现还有更深的问题，见下面第 6 点。**

5. **Review 13：补上服务器健康检查（Nginx error log / PM2 重启记录 / 证书链）**。GasCan 问"现在能不能重新提交公安联网备案"，借这个机会把 `PROJECT_STATUS.md` 上一节"下一步建议"第 3 条（一直标"留给 Claude Code 按需跟进"但没人做过）补上。SSH 连服务器核查（只读，GasCan 已授权）：定位到 8月9日晚 19:49~20:28 确实发生过一次真实的、几十分钟量级的服务不可用（nginx error log + PM2 崩溃日志互相印证），根因是已知的部署增量缓存问题，当时已经现场修复，此后一直稳定。证书链完整有效（2026-08-08~11-06）。结论：技术上没有已知阻塞项，可以提交。

6. **新增"备案审核临时演示登录通道"功能（11.5，当前已部署并打开）**：GasCan 担心公安审核人员点"微信授权登录"进不去会导致再次被拒（不能指望公安配合走真实微信+白名单流程），要求做一个任何人都能点的临时登录入口，明确知情并接受风险（"审核通过后拿掉"）。Claude Code 先建议了风险更低的替代方案（把审核人员 openid 加白名单），GasCan 认为不现实，坚持要临时通道。最终实现方式（Kiro CLI 实现，Claude Code 复核）：
   - 后端新增完全独立的登录路径（不改动任何现有微信登录代码，逐行核对零改动），签发的是 **2 小时短期 JWT**（正常登录 7 天）
   - 环境变量 `PUBLIC_REVIEW_MODE` 做总开关，`.env.example` 默认 `false`，前后端都做了检查
   - **当前状态：已部署到生产服务器，开关已打开（生产 `.env` 里有 `PUBLIC_REVIEW_MODE=true`），功能生效中**。真实浏览器在 `https://landlordeasy.cn/login` 完整验证过：按钮正常显示（样式跟主按钮明显区分）、点击后成功登录进工作台看到真实数据。
   - **⚠️ 待办，高优先级，不要忘（`specs/tasks.md` 11.5）：GasCan 已经在这次会话里确认公安联网备案已经重新提交。审核结果出来之后，不管通过与否，都要记得登录服务器把 `PUBLIC_REVIEW_MODE` 改回 `false`（或删掉这行）、`pm2 restart landlord-easy`，并确认 `curl https://landlordeasy.cn/api/v1/auth/review-mode` 返回 `enabled:false`。这是当前生产环境唯一一个"必须记得关掉"的东西。**

7. **部署这次功能时意外发现并处理了服务器 git 严重落后于仓库的问题（11.7，已处理）**：服务器 `/opt/landlord-easy` 的 git HEAD 停在 `90cc0e7`（M8 时期），一长串文件被手动改过、从未提交（GasCan 确认根因："之前一直在本地让 Kiro 做项目，中间一直没有推到仓库"）。用可完全恢复的 `git stash push -u`（不是 `reset --hard`）处理：stash 服务器本地改动 → 干净 `git pull` fast-forward 到最新 → 唯一需要手动保留的是 `apps/landlord-h5/.env.production` 里的真实微信 AppID（仓库里只有占位符），已精确取回。stash（`pre-deploy-drift-backup-2026-08-10`）还留在服务器上没删，作为安全网。**以后所有部署都必须走 `git pull`，不要再手动改服务器文件不提交仓库**——这是这次一系列问题的根源，`.claude/settings.json` 已经把 `git push` 加进了免确认白名单，理论上不再有"改了忘记推"的借口。

8. **部署过程中发现 `deploy/deploy.sh` 的 `prisma migrate deploy` 这一步其实从来没有成功过（11.6，还没修，下一个优先级最高的技术债）**：这个项目一直用 `prisma db push` 工作流，仓库里根本没有 `apps/server/prisma/migrations` 目录。`migrate deploy` 在没有迁移文件但目标库非空时会报错 `P3005`，而 `deploy.sh` 开头是 `set -e`，这意味着**这一步理论上一直会导致整个部署脚本中途失败**——这很可能就是第 7 点里服务器 git 长期没人 `git pull` 的根本原因（没人正常跑完过 `deploy.sh`，只能手动分步操作）。这次部署时临时跳过了这一步（本次改动不需要任何 schema 变更），完整部署过程改成手动分步执行（`pnpm install` → `prisma generate` → 前后端 build → `pm2 restart` → 加环境变量 → 再次 `pm2 restart`），每步单独验证。**下一轮工作建议优先修这个**，把 `deploy.sh` 里的 `migrate deploy` 改成 `db push`（或者干脆去掉自动跑这步，schema 变更单独手动执行），让脚本真的能从头到尾跑完一次，不用再手动分步。

### 详细过程记录

- Review 13（服务器健康检查 + 公安备案可行性评估）、Review 14（备案审核通道实现 + 部署 + git drift 处理）在 `review/review-notes.md` 最后两节，非常详细，建议新会话直接读一遍。
- `specs/tasks.md` 的 M11 部分新增了 11.5/11.6/11.7 三条，以及一个"临时功能追踪"小节专门记录审核通道功能的状态和关闭步骤。

### 当前提交基线

- `main` 与 `origin/main` 一致，最新 commit `4863361`（Review 14 文档）。工作树干净，没有未提交改动。
- 生产服务器 `/opt/landlord-easy` 的 git 也已经同步到同一个 commit（今天刚处理过drift问题）。

### 还没做的事（按建议优先级）

1. **11.6**：修 `deploy.sh` 的 `prisma migrate deploy` bug（详见上文第 8 点），建议排第一，因为这个 bug 一直在拖累正常部署流程。
2. **9.11**：补一套 Playwright 端到端自动化测试，GasCan 明确要求过（人工/AI 点页面测试效率太低），一直没排上，没有技术阻塞，纯粹是优先级问题。
3. **M10 环境隔离剩余部分**（10.5/10.6/10.7/10.9，`specs/env-isolation.md` 有完整方案）：dev 子域名的前端双构建、nginx dev server 块、dev 证书、端到端验证。10.6/10.7 会改动生产 nginx 配置，风险比其他项高，建议放在确认没有更紧急事项时再做。
4. **9.4**：可选，交接管理独立 CRUD 接口，不做不影响主流程。
5. 需要 GasCan 自己做的：10.2（域名服务商加 dev 子域名 DNS 记录）、9.10（房间列表里一个手误建的"R"楼栋，去设置里改名/删掉）。

### ⚠️ 唯一一件必须记得的事（已过期，见下方 2026-08-20 章节，已解决）

~~公安联网备案已经重新提交（2026-08-10）。审核结果出来后，第一件事是去服务器把 `PUBLIC_REVIEW_MODE` 关掉，这是当前生产环境上唯一一个"开着的临时后门"，不管审核通过与否都要关。~~ **已完成**：公安备案审核已通过，`PUBLIC_REVIEW_MODE` 已于 2026-08-20 确认关闭并验证（`enabled:false`、`review-login` 返回 403）。

---

## 最新状态：2026-08-20~21（备案通过；母亲白名单；真实历史数据清洗与导入已应用到dev+生产库并验证；备份cron已修复；房东端备案号footer已调整）

> 本节覆盖上方 2026-08-10 的进度。新会话（尤其是换电脑接续）先看这一节。**这次会话的分工模式变了**：GasCan 明确要求 Kiro CLI（换了新账号，token 充足）承担大部分实现工作，Claude Code 专注架构设计+审查，且明确表态"接下来要跟 Claude 一起持续优化产品"——项目进入日常迭代阶段，不再是一次性的部署收尾工作。

### 这一轮做了什么

1. **11.5 收尾**：公安联网备案审核已通过（GasCan 确认），`PUBLIC_REVIEW_MODE` 已关闭并端到端验证。

2. **给 GasCan 母亲（占秀英）加白名单**：复用 11.4 的一次性流程（临时打印真实 openid → 母亲尝试登录 → 查 PM2 日志拿 openid → 写入 `landlords` 表 isActive=true → revert 日志改动 → `pm2 flush` 清理捕获记录）。已确认可以正常登录。这套流程现在可以认为是"标准操作"，以后每加一位家人重复同样步骤即可，不需要重新设计。

3. **真实历史数据清洗与导入（当前最大的工作，未完全完成，见下）**：GasCan 提供了两份手工记账 Excel（"鸿翼公寓租金耗材"=嘉定公寓 Q/R/S 三栋，"明远公寓租金耗材"=明远公寓一栋），要求清空种子数据、直接用真实数据、历史也要完整重建（不只是当前快照）、租客姓名手机号暂时留空占位。

   - **数据清洗（Claude Code 亲自做，不是 Kiro——这是项目一贯的分工）**：用 pandas 清洗出 `data/import/history-2026-08/`下三个 CSV：`rent_ledger_final.csv`（3590行，两处物业185个房间，2024-01~2026-07逐月租金流水）、`rent_events_no_period.csv`（376行退房/空置等无账期事件）、`expenses_clean.csv`（896行支出）。原始 Excel 列结构在不同年份不一致，已按列名而非位置映射清洗；修正了部分行的年份录入错误。详细字段说明、已知数据缺口、建议的租约切分算法设计都写在该目录下的 `README.md` 里。旧的 `data/import/{buildings,rooms,leases,expenses}.csv`（更早一轮清洗的半成品，租客信息从未补全，也没有明远公寓）已删除，被这批数据取代。
   - **导入脚本**：`apps/server/src/scripts/import-history-2026-08.ts`（Kiro 实现，Claude Code 审查+独立复核，不是只信 Kiro 自述）。清空旧种子数据（`Landlord`/`AuditLog` 表明确排除，有硬性断言保护，清空前后都会打印行数核对），按启发式规则（备注关键词/同月收退押/日期缺口/押金大幅变化）把月度流水切分成 Lease 分段，每段内按月生成 Bill+Payment（历史租金视为已收），会输出"低置信度切分点"清单供人工抽查。
   - **Claude Code 独立复核过程中发现并推动修复了两个真实 bug（不是走流程，是真的复核出问题）**：
     1. `buildSheetMonthMap` 原来用"从2026年7月线性倒数"的位置假设给每个月度 sheet 分配日期，跟实际数据不符（比如嘉定"1月租金1"sheet 实际数据是2025年1月，被错误算成2026年1月），导致部分房间的历史租约被错误交叉切分（金额汇总总数是对的，所以没被最初的抽查发现）。已改成用每个 sheet 实际 `period_start` 众数来判断月份年份，重新验证过 Q101 等受影响房间的时间线连续性。
     2. 佣金（嘉定"佣金"/明远"中介费"）字段最初被当作应该向租客收取的账单附加项处理，Claude Code 复核数据分布后发现佣金中位数正好等于当次新押金的100%、且几乎只出现在换租客的月份——这是国内典型的"房东付给中介一个月房租作为佣金"模式，不是收租客的。GasCan 确认后已改成生成 `Expense` 记录（成本），不再计入 `Bill`/`BillItem`。
   - **本地独立验证**（Claude Code 自己在本机 Docker MySQL 上重新跑过，不只信 Kiro 结果）：185个房间、679条历史租约（174个当前ACTIVE）、3316张历史账单（金额合计¥6,636,259，与CSV的租金+停车费总和完全一致）、643条押金记录、支出895条常规+426条佣金=1321条（合计¥2,854,564.03，与CSV完全一致）。`tsc`/`jest` 均独立重跑通过。
   > **勘误（2026-08-21）**：本节最初记录的租约数是"599条（171 ACTIVE）"，GasCan 确认这个数字实际来自 Kiro 第一轮跑脚本、也就是 `buildSheetMonthMap` 用位置线性推算月份那个 bug 修复**之前**的旧结果；后来修复该 bug（以及佣金记账口径 bug）后重新核对了账单/支出总额，但漏了同步重新核对租约条数，误把旧数字沿用进了这段总结。2026-08-21 部署到服务器 `landlordeasy_dev` 库重新跑脚本，实测为 679 条（174 ACTIVE）；已用 CSV 字节级 hash 比对、脚本确定性代码审查、3 个房间时间线抽查（对照原始 CSV 备注/押金/佣金字段）、679 条租约全量重叠检测（零重叠）四项交叉验证，确认 679 是当前脚本+当前 CSV 的正确结果，599 是过期数字，已在此处更正。

4. **应用到服务器（dev+生产库，进行中，还没完成）**：GasCan 明确要求"应用到dev和生产一起"。过程中发现并处理了几个问题：
   - **确认了环境隔离现状**：本机测试库（我自己电脑的Docker）、服务器 `landlord_easy`（生产）、服务器 `landlordeasy_dev`（M10建的dev环境）三者完全独立，物理和逻辑上都分开。
   - **发现服务器 `apps/server/.env.dev` 文件缺失**（`landlordeasy-server-dev` 进程还在跑是因为用的是启动时加载进内存的老配置，文件本身已经不知何时被删了）——**这个还没修，下次接手要先处理，否则 dev 进程一旦重启会起不来**。
   - **发现生产库当前仍是种子/demo数据**（"租客001"这种占位名字），不是真实数据，所以清空不会丢失任何真实业务记录——已确认这一点才决定继续。
   - **已打一份新的生产库备份**：`/opt/backups/landlord_easy_20260820.sql.gz`（这次操作前手动跑的，之前上一份备份是7月22日的——**发现每日自动备份 cron（task 9.3 建的）不知何时停止工作了，这个也要修**）。
   - **正在改**：导入脚本的 `assertLocalDatabase()` 安全检查原来硬编码"只允许库名精确等于 landlord_easy"，这个规则在本机测试时没问题，但放到服务器上会挡住 `landlordeasy_dev`（名字不在白名单里），而且会把生产库 `landlord_easy` 当成"安全的本地测试库"直接放行（因为服务器本地访问自己的MySQL，host也是localhost）——这个判断逻辑需要改成白名单两个库名 + 要求显式传参数确认目标库名，正在改，改完才能正式对 dev/生产执行导入。

### 下一次接手/继续时，按这个顺序处理

1. ✅ 已完成（2026-08-20）：`assertLocalDatabase()` 已改成 `landlord_easy`/`landlordeasy_dev` 双白名单 + 显式 `--confirm-target=<库名>` 确认，`tsc` 独立验证通过，已 commit+push（commit `d8ef469`）。
2. ✅ 已完成（2026-08-20）：服务器 `apps/server/.env.dev` 已重建（DATABASE_URL 指向 `landlordeasy_dev`，PORT=3001，WECHAT_MODE=mock，数据库账号密码复用生产 `.env`），`landlordeasy-server-dev` 已重启验证 `curl http://localhost:3001/api/v1/health` 正常返回 connected。
3. ✅ 已完成（2026-08-21）：最新代码已部署到服务器。过程：`git stash push -u` 暂存服务器本地改动（含未跟踪的 `apps/server/.env.dev`）→ `git pull origin main` 干净 fast-forward 到 `9545f3e` → 分别用 `git checkout stash@{0} -- apps/landlord-h5/.env.production` 和 `git checkout stash@{0}^3 -- apps/server/.env.dev` 精确取回（后者是未跟踪文件，存在 stash 的第三父提交里，不能直接从 `stash@{0}` 本体取，踩了一次坑才发现）→ `pnpm install` + `prisma generate` + `pnpm --filter server build`（清过 `dist`/`tsconfig.tsbuildinfo` 缓存），未涉及 `prisma migrate`/`db push`。
4. ✅ 已完成（2026-08-21）：对 `landlordeasy_dev` 跑了一次导入，`node --env-file=.env.dev dist/scripts/import-history-2026-08.js --confirm-target=landlordeasy_dev`。**验证方式做了调整**：dev 环境目前没有可公网访问的前端地址（M10 的 dev nginx 配置块本来就没做，见下方 10.6/10.7），没法做真实浏览器验收，改成直接 SQL 查库核对：185 房间/4 栋楼/679 条租约（174 ACTIVE）/3316 张账单(¥6,636,259)/1321 条支出(¥2,854,564.03)/643 条押金——除租约条数外均与本节上方"本地独立验证"数字一致；额外抽查了 3 个房间（R307/S307/明远307）的租约时间线逐条对照原始 CSV 备注/押金/佣金字段，逻辑均自洽；对全部 679 条租约做了同房间时间段重叠检测，零重叠。过程中发现租约数（599→679）跟本节旧记录不一致，排查后确认是文档记录疏漏（见上方勘误），不是这次运行有问题。
5. ✅ 已完成（2026-08-21）：核实了每日备份 cron 的真实状态——**确认属实，不是猜测**：`crontab -l`（ubuntu用户）无内容，`sudo crontab -l`（root）只有一条腾讯云 stargate 任务，没有任何 mysqldump 相关配置；`/opt/backups/` 目录里 `landlord_easy_20260722.sql.gz` 之后到 8/20 之间没有任何自动生成的备份文件。确认后手动执行 `/opt/backups/backup-mysql.sh` 打了新备份 `landlord_easy_20260821.sql.gz`（gzip 完整性校验通过，dump 头确认是 `landlord_easy` 库），不是复用旧备份。
6. ✅ 已完成（2026-08-21）：对生产 `landlord_easy` 执行了导入。**第一次尝试因为命令行参数顺序错误失败**（把 `--confirm-target=landlord_easy` 当成了脚本的第一个位置参数，被 `getDataDir()` 误当成数据目录路径，在读 CSV 阶段直接报错退出——发生在任何清空/写入操作之前，已用 SQL 查询确认生产库当时完全未被触碰），修正参数顺序后重新执行成功。结果：185房间/4栋楼/679条租约(174 ACTIVE)/3316张账单(¥6,636,259)/1321条支出(¥2,854,564.03)/643条押金，与 `landlordeasy_dev` 逐项吻合；`Landlord`/`AuditLog` 行数导入前后不变；全量679条租约重叠检测零重叠；`bill`/`expense` 金额汇总与文档记录完全一致。**真实浏览器验证这一步经 GasCan 本人明确决定跳过**（生产微信登录是 real 模式，此前为备案审核开的临时登录通道已在审核通过后关闭，重新打开需要额外授权；这次是纯数据变更未改动任何前端代码，GasCan 认为 SQL 级验证已经足够，不需要为此重新打开临时登录通道）。详见 `specs/tasks.md` 任务 12.1 完整记录。
7. ✅ 已完成（2026-08-21）：`specs/tasks.md` 已新增 `## M12 历史数据导入应用到 dev/生产库` 章节，任务 12.1 记录了完整的改动/验证过程/结果/遗留问题，12.2 记录了下面第 8 条备份 cron 问题（尚未修复，作为独立待办）。
8. ✅ 已完成（2026-08-21）：**上面第 8 条曾经的判断有误，已重新查明并修复。** 之前以为 cron 配置"彻底消失"，但那是因为 `crontab -l`/`sudo crontab -l` 本来就看不到 `/etc/cron.d/` 目录下的系统级配置——实际核实后，`/etc/cron.d/mysql-backup` 文件从 7/22 建立后从未被删除，真正原因是这个文件当初照搬了用户级 `crontab -e` 的语法、少了系统级 `/etc/cron.d/` 语法要求的用户名字段，导致 cron 把命令路径误当用户名解析，语法错误、整份文件被静默跳过（`sudo systemctl restart cron` 后从 syslog 拿到实锤：`Error: bad username; while reading /etc/cron.d/mysql-backup`）。已修正为 `0 3 * * * root /opt/backups/backup-mysql.sh >> /opt/backups/backup.log 2>&1`，并用"临时改到近未来时间+重启+等待触发"的方法实测验证过确实能正常执行（生成了一份 226450 字节的新备份，体量与真实历史数据吻合），改回每日3点正式排程后未见新语法错误。详见 `specs/tasks.md` 任务 12.2。
9. ✅ 已完成（2026-08-21）：房东端备案号 footer 挡视野问题——GasCan 微信内实测反馈后，改成只在"我的"页展示，其他页面不再渲染；已部署到服务器，GasCan 本人在微信内真实验证确认"没问题了"。租客端本次未动（GasCan 明确当前优先做房东端，租客端暂不开发）。详见 `specs/tasks.md` 任务 12.3。
10. 顺带确认：GasCan 在微信内查看工作台时看到的数字从demo数据的"空置279"变成了真实数据的"空置11"（185房间-174条ACTIVE租约=11，正好对上），这是脱离SQL查询之外、通过真实业务页面对生产导入结果的又一次独立佐证。

### 本轮新发现、留给下一次接手的事

- **599 vs 679 租约条数勘误**：本节上方"本地独立验证"记录的"599条历史租约"是过期数字（GasCan 确认来自 bug 修复前的旧运行结果，写文档时漏了同步更新），已更正为679条，详见该处勘误说明和 `specs/tasks.md` 12.1。
- ~~生产导入日志里一条支出记录因源数据错误被跳过~~（**2026-08-21 GasCan 决定不处理**：系统不算上线，数据未来还要重新初始化，现在数据不对没关系）：`expenses_clean.csv` 第386行"冰箱"记录的 `amount` 字段本身是文本而非数字，脚本正确跳过未硬写脏数据，详见 `specs/tasks.md` 12.1。
- ~~178条低置信度切分点待人工抽查~~（**2026-08-21 GasCan 决定不处理**，理由同上）：完整清单仍在服务器 `/opt/landlord-easy/import-prod-run2.log`，如果以后数据重新初始化前想抽查可以再翻出来。
- **备份cron已修复**：见上方第8条，真正原因是 `/etc/cron.d/` 语法缺用户名字段，不是配置消失，已修正并实测验证生效。
- **流程疏漏（如实记录）**：这次对生产库执行导入前，Claude Code 没有主动核实"最新备份是什么时候"就直接跑了，事后查实际时间戳才发现凑巧有一份 11:13 的备份（不是 cron 也不是本次会话打的，来源不明，疑似 GasCan 或另一个并行会话手动打的）刚好在导入前几分钟生成，"运气好"不代表"流程对"，下次涉及生产库的破坏性操作前必须先核实备份时间戳再动手，不能跳过这一步直接执行。GasCan 本人回应：项目尚未正式运行，这次数据备份的重要性不高，不追究，但这条记录留着提醒以后的会话。

### 关于协作模式的变化（供下一个接手的会话理解上下文）

GasCan 明确说了"接下来我需要跟你一起不断优化这个产品"——项目已经从"完成部署上线"转入日常产品迭代阶段。分工上，GasCan 明确要求把大部分实现工作交给 Kiro CLI（新账号，token 充足），Claude Code 承担架构设计+代码审查角色，但**审查标准没有降低**——这次会话里两个真实 bug（sheet月份错位、佣金记账方向）都是 Claude Code 独立复核数据分布/交叉验证发现的，不是走流程性的"跑一下 tsc 就过"，这个习惯需要保持。
