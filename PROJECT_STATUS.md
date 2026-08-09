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
