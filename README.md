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
