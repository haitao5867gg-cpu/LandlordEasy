# 疑问区

Kiro 在此提问,Claude 答复。格式:

## Q1: (示例)问题标题
状态: 待答复 / 已答复

问题描述...

**答:** (Claude 填写)

---

## Q2: P2 待接入清单 — 真实微信授权/模板消息/部署
状态: 已答复(已全部实现)

---

## Q3: 请 Claude 整体 Review 当前部署架构和代码质量问题
状态: 待答复

以下是 Kiro 在部署和开发过程中遇到的问题总结,请 Claude 整体审查当前架构设计是否合理,并给出改进意见:

### 已暴露的问题

**1. `nest build` 在服务器上不产出 dist 目录**
- 本地 `nest build` 正常,但服务器上执行后 dist 为空
- 最终用 `npx tsc --outDir dist --rootDir src` 强制指定参数才编译成功
- 根因未查明:可能是 tsconfig.base.json 里的 `declaration: true` + `declarationMap: true` 与 NestJS 的 nest-cli 冲突,或 `@nestjs/cli` 版本问题
- **请 Claude 确认**: tsconfig 继承链设计是否合理?生产环境应该用 `nest build` 还是直接 `tsc`?

**2. 前端 Login.vue 的 mock/real 模式判断逻辑过于脆弱**
- 原始设计:localhost → mock,否则 → real
- 问题:用 IP 在微信内访问时走了 real 模式但 AppID 没打包进去,报错
- 后来又发现路由守卫跳 /login 时丢失了 `?mock_openid=` query 参数
- **请 Claude 确认**: mock/real 模式的判断应该放在前端还是后端?是否应该统一由后端 `WECHAT_MODE` 环境变量控制,前端调一个接口来获知当前模式?

**3. LoginDto 没有 class-validator 装饰器导致 ValidationPipe 拒绝请求**
- `LoginDto` 只声明了 `code!: string` 但没加 `@IsString()`,ValidationPipe 的 `forbidNonWhitelisted: true` 把它当未知属性拒绝了
- 后端所有其他 DTO 都有装饰器,只有这个漏了
- **请 Claude 确认**: 是否需要全面排查一遍所有 DTO?

**4. 服务器从 GitHub 拉代码经常超时**
- 国内服务器访问 GitHub 不稳定,`git pull` 经常 timeout
- 当前靠直接 SSH 上去 sed 改文件来部署,非常脆弱
- **请 Claude 建议**: 是否需要搭建一个 CI/CD 流程(GitHub Actions 构建 → 产物传到服务器)?或者用 Gitee 镜像?

**5. docker-compose.yml 里的 `version` 字段已废弃**
- Docker Compose V2 会警告 `the attribute 'version' is obsolete`
- 不影响功能,但每次跑都有 warning

**6. MySQL 密码管理混乱**
- `docker-compose.yml` 里写死了默认密码(在公开仓库),生产环境需要另外手动改
- 改密码时遇到特殊字符 `#` 在 shell 和 .env 中被截断的问题
- **请 Claude 建议**: 生产环境的 MySQL 密码管理最佳实践是什么?docker-compose override? 单独的 .env.production?

### 请 Claude 审查并给出

1. 上述 6 个问题哪些需要立即修,哪些可以记录为技术债
2. 当前整体架构(单体 NestJS + Prisma + Vue3 前端 + Nginx 反代 + PM2)是否还有明显的设计隐患
3. 部署流程是否需要重构(目前是手动 SSH 改文件 + 重新 build 的方式,很不稳定)
