# LandlordEasy 房屋收租管理系统

面向自有公寓运营的收租管理系统,跑通「出租 → 账单 → 提醒 → 收款 → 对账」闭环。

## 技术栈

- **后端**: Node.js 20+ / NestJS / Prisma / MySQL 8
- **前端**: Vue 3 / Vite / TypeScript / Vant 4 / Pinia
- **工程**: pnpm monorepo

## 项目结构

```
apps/
  server/          # 后端 API(NestJS)
  landlord-h5/     # 房东端 H5
  tenant-h5/       # 租客端 H5
packages/
  shared/          # 前后端共享类型、枚举
```

## 本地启动

### 前置要求

- Node.js >= 20
- pnpm >= 9
- Docker & Docker Compose

### 步骤

1. **克隆并安装依赖**

```bash
git clone <repo-url>
cd LandlordEasy
pnpm install
```

2. **启动 MySQL**

```bash
docker-compose up -d
```

MySQL 会在 `localhost:3306` 启动,数据库: `landlord_easy`

3. **配置环境变量**

```bash
cp apps/server/.env.example apps/server/.env
```

默认配置即可用于本地开发。

4. **数据库迁移**

```bash
pnpm --filter server prisma:migrate
```

5. **填充种子数据(可选)**

```bash
pnpm seed
```

生成 4 栋楼、3 种房型、300 间房、30 份在租租约及历史账单。

6. **启动后端**

```bash
pnpm dev:server
```

访问 http://localhost:3000/api/v1/health 验证运行状态。

7. **启动前端(房东端)**

```bash
pnpm dev:landlord
```

访问 http://localhost:5173

8. **启动前端(租客端)**

```bash
pnpm dev:tenant
```

访问 http://localhost:5174

9. **运行核心 E2E 测试(首次先安装 Chromium)**

```bash
pnpm exec playwright install chromium && pnpm test:e2e
```

测试会在 `localhost:3307` 启动并在结束后销毁专用 MySQL,以 `WECHAT_MODE=mock` 启动本地后端和两个前端,不会连接开发库、生产库或远程服务器。若默认 Docker Hub 镜像代理不可用,可在命令前设置 `E2E_MYSQL_IMAGE=mysql:8.0` 改用本地/官方镜像。

**排障**:如果卡在后端启动这一步、报错 `Cannot find module '.../apps/server/dist/main'`,且 `pnpm --filter server build` 本身也是退出码 0 但完全没有编译输出、`dist/` 目录压根没生成——这不是这套测试或代码的问题,是本机 Node 版本太新(实测 Node 26.x)和 `@nestjs/cli@10.x` 的 webpack 编译链不兼容,会静默失败且不报任何错误。解决办法:装一个 LTS Node(比如 `brew install node@20`,装完是 keg-only 不会影响你平时用的 Node 版本),手动跑一次 `PATH="/opt/homebrew/opt/node@20/bin:$PATH" pnpm --filter server build` 确认能正常生成 `apps/server/dist/main.js`,之后 `run.sh` 走的是同一个 `pnpm --filter server build`,只要这条命令能稳定跑通,`run.sh` 就没问题。

## 服务器部署

服务器上 `main`(生产)和 `dev`(测试)是两个**物理隔离的 git worktree**,分别在 `/opt/landlord-easy`(跟 `main`)和 `/opt/landlord-easy-dev`(跟 `dev`),不是共用同一份 checkout。这意味着:
- 日常改动先推到 `dev` 分支、部署到 dev worktree 测试,觉得不对可以直接在 `dev` 分支上 `git revert`/`reset`,**完全不会影响 `main` 或生产**
- 测试满意后把 `dev` 合并进 `main`,再对 `/opt/landlord-easy` 跑一次 `deploy.sh prod` 才是真正上线
- 两个目录各自 `cd` 进去执行部署脚本,不能在错误的目录里跑错误的目标(脚本自己会校验当前 checkout 的分支跟传入的 `prod`/`dev` 参数是否匹配,不匹配直接报错退出,不会跑错)

```bash
cd /opt/landlord-easy     && bash deploy/deploy.sh prod   # main 分支 -> 生产
cd /opt/landlord-easy-dev && bash deploy/deploy.sh dev    # dev 分支  -> dev环境
```

- `prod`:拉取当前分支(即 `main`)最新提交、安装依赖并完成数据库迁移和全量构建,保留两个前端项目各自的 `dist/` 目录,重启 PM2 进程 `landlord-easy`,最后检查并重载 Nginx。
- `dev`:拉取当前分支(即 `dev`)最新提交,执行相同的依赖安装、数据库迁移和构建流程,再将两个前端构建产物分别复制到 `/var/www/landlordeasy/landlord-h5-dev/` 和 `/var/www/landlordeasy/tenant-h5-dev/`,重启 PM2 进程 `landlordeasy-server-dev`,最后检查并重载 Nginx。运行前需确保 `/opt/landlord-easy-dev/apps/server/.env.dev` 存在(这个文件不进 git,`/opt/landlord-easy` 那份要手动复制一份过去,配置 dev 后端端口和独立数据库等环境变量)。

**不要用 `sudo` 执行 `deploy.sh`**——PM2 进程列表按系统用户隔离,root 身份执行会检测不到已存在的部署进程,误建一个抢占端口、必然崩溃的重复进程,脚本本身会在开头直接拒绝 root/sudo 执行。脚本最后 `nginx -t`/`systemctl reload nginx` 这两步需要 root 权限(读证书、控制服务),服务器上已经给部署用户配了一条最小权限的 `/etc/sudoers.d/deploy-nginx`,只免密码授权这两条具体命令,脚本内部会自动用 `sudo -n` 调用,不需要手动处理。

## 开发约定

- 提交信息格式: `feat|fix|docs|chore: 描述`
- 微信相关功能通过 `WECHAT_MODE=mock` 环境变量在本地 mock
- 数据只归档不删除
- 关键写操作自动记录操作日志

## 脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev:server` | 启动后端开发服务器 |
| `pnpm dev:landlord` | 启动房东端 H5 |
| `pnpm dev:tenant` | 启动租客端 H5 |
| `pnpm seed` | 填充种子数据 |
| `pnpm import:init -- <dir>` | CSV 导入初始数据 |
| `pnpm build` | 全量构建 |
| `pnpm lint` | 全量 lint |
