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

部署脚本必须显式指定目标环境,不传参数或传入其他值会直接报错退出:

```bash
bash deploy/deploy.sh prod
bash deploy/deploy.sh dev
```

- `prod`:拉取 `main`、安装依赖并完成数据库迁移和全量构建,保留两个前端项目各自的 `dist/` 目录,重启 PM2 进程 `landlord-easy`,最后检查并重载 Nginx。
- `dev`:执行相同的拉取、依赖安装、数据库迁移和构建流程,再将两个前端构建产物分别复制到 `/var/www/landlordeasy/landlord-h5-dev/` 和 `/var/www/landlordeasy/tenant-h5-dev/`,重启 PM2 进程 `landlordeasy-server-dev`,最后检查并重载 Nginx。运行前需确保服务器上已存在 `apps/server/.env.dev`,其中配置 dev 后端端口和独立数据库等环境变量。

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
