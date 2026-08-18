# 项目状态总结（历史基线：2026-07-20；最新进展见文末）

> 本文件供任何新会话的 Claude / Kiro 快速恢复上下文。仓库是唯一信息源。

## 项目是什么
LandlordEasy 房屋收租系统。嘉定公寓,4~5 栋自建楼约 300 间房(现有 Excel 覆盖 Q/R/S 三栋 130 间),整套出租,3 位房东(家人)共同管理。房东端手机 Web,租客端微信服务号 H5,先跑通「出租→账单→提醒→收款→对账」闭环。

## 协作方式
- 用户(GasCan)只与 Claude 讨论;Claude 维护 specs/ 与 review/;Kiro(Windows, Opus 4.6)按 specs/tasks.md 开发并推送;疑问走 questions.md。规则详见 COLLABORATION.md
- Claude 在 Cowork 中用仓库所有者的 fine-grained PAT 推拉(token 由用户每次会话提供,不入库);Kiro 走协作者邀请或另发 PAT
- Claude 沙盒只通 github.com HTTPS,SSH/Gitee/api.github.com 均不通

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

### ⚠️ 唯一一件必须记得的事

**公安联网备案已经重新提交（2026-08-10）。审核结果出来后，第一件事是去服务器把 `PUBLIC_REVIEW_MODE` 关掉**（见上文第 6 点），这是当前生产环境上唯一一个"开着的临时后门"，不管审核通过与否都要关。
