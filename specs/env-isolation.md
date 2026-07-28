# 环境隔离方案(dev/test + prod,同域名同服务器)

> 背景:GasCan 想要两套环境——一套开发测试用,一套正式使用给房东家人用。要求:共用一个域名、共用现有的这台腾讯云轻量应用服务器,数据完全隔离。2026-07-28 跟 GasCan 讨论确认可行,方案如下。Claude 负责这份 spec,Kiro 负责实现,实现过程中的具体问题写 questions.md。

## 已确认的关键决策

- 测试环境子域名:`dev.<你的域名>`(正式环境继续用主域名,比如 `<你的域名>` / `www.<你的域名>`)
- ICP 备案:已查证,备案是对主域名备案,子域名不需要单独备案,`dev.<域名>` 可以直接用
- 微信登录:测试环境**继续用 mock 模式**,不接真实微信授权,不占用公众号后台"网页授权域名"2 个名额里的一个;真实微信登录只在正式环境跑
- 服务器:不新增机器,同一台轻量服务器跑两套后端进程 + 两个前端静态目录 + 同一个 MySQL 容器里开两个 database

## 整体架构

```
                         ┌─────────────── Nginx ───────────────┐
                         │                                       │
   <域名> / www.<域名>   │  server_name <域名> www.<域名>       │
   ──────────────────►   │  → 反代 /api/ 到 127.0.0.1:3000        │
                         │  → 静态文件走 landlord-h5/tenant-h5 的  │
                         │    prod 构建产物                       │
                         │                                       │
   dev.<域名>            │  server_name dev.<域名>               │
   ──────────────────►   │  → 反代 /api/ 到 127.0.0.1:3001        │
                         │  → 静态文件走 dev 构建产物              │
                         └───────────────────────────────────────┘
                                    │                    │
                         PM2: landlordeasy-server   PM2: landlordeasy-server-dev
                         (端口 3000)                  (端口 3001)
                                    │                    │
                                    └────────┬───────────┘
                                             MySQL(同一个容器/实例)
                                    landlordeasy_prod   landlordeasy_dev
                                       (两个独立 database,数据完全隔离)
```

## 具体改动清单

### 1. DNS
在域名服务商那边加一条 A 记录:`dev` → 服务器公网 IP(跟主域名解析到同一台机器)。这个 GasCan 自己去域名后台加,不需要 Kiro 操作服务器。

### 2. HTTPS 证书
域名备案下来、Let's Encrypt 能正常签发后,`dev.<域名>` 需要单独再签一次证书(不是自动包含在主域名证书里)。`deploy/certbot.sh` 现在的脚本只签了一个域名,需要扩展成能传入域名参数,分别对主域名和 `dev.<域名>` 各跑一次。

### 3. 数据库:同一个 MySQL,两个 database
不需要新的 MySQL 容器。现有的生产库保留(建议确认一下实际库名,统一改成/确认为 `landlordeasy_prod` 便于区分),新建一个 `landlordeasy_dev` database,结构用 `prisma migrate`/`prisma db push` 在这个新库上跑一遍,种子数据用现成的 `prisma/seed.ts` 灌(**不要把生产数据 dump 过去**,dev 库应该只有种子数据 + 平时测试产生的数据,跟真实房东/租客数据完全分开)。

### 4. 后端:两个 PM2 进程
- 现有生产进程保持不变,确认它叫 `landlordeasy-server`(或统一改成这个名字方便区分),端口 3000,读 `.env.production`(或现有的 `.env`,建议改名成 `.env.production` 更明确)
- 新增一个 PM2 进程 `landlordeasy-server-dev`,端口改成 3001(`.env.dev` 里设 `PORT=3001`),`DATABASE_URL` 指向 `landlordeasy_dev`,`WECHAT_MODE=mock`
- 两个进程用各自独立的 `.env` 文件,不要共用一份改来改去,避免手滑改错环境

### 5. 前端:两次构建,四个产物
`landlord-h5`、`tenant-h5` 各自打包两次:
- `pnpm build`(现有方式)产出正式环境版本
- 新增一个 dev 版本的构建(不需要改代码逻辑,`baseURL` 用的是相对路径 `/api/v1`,天然适配"同域名不同子域名各自反代到各自后端"这个方案,不需要加 `VITE_API_BASE_URL` 之类的环境变量)

服务器上建两组目录,比如:
```
/var/www/landlordeasy/landlord-h5-prod/
/var/www/landlordeasy/tenant-h5-prod/
/var/www/landlordeasy/landlord-h5-dev/
/var/www/landlordeasy/tenant-h5-dev/
```
Nginx 两个 `server_name` 块分别指向 prod/dev 各自的目录。

### 6. Nginx 配置
在 `deploy/nginx.conf` 里加第二个 `server` 块,`server_name dev.<域名>;`,内容结构照抄现有的 server 块,把 `/api/` 反代目标端口改成 3001,静态文件根目录改成 dev 的构建产物路径,HTTPS 证书路径指向 `dev.<域名>` 单独签发的证书。

### 7. 部署脚本
`deploy/deploy.sh` 建议改成接受一个参数区分环境,比如:
```
./deploy.sh prod   # 拉 main 分支代码,build 生产版本,重启 landlordeasy-server
./deploy.sh dev    # 拉 dev 分支代码(或当前分支),build 测试版本,重启 landlordeasy-server-dev
```
不需要上完整 CI/CD(之前 Q3 已经讨论过,现在团队规模不需要),手动跑脚本、带一个环境参数就够。

### 8. Git 分支建议(GasCan 可以按自己习惯调整,不强制)
建议 `main` 分支对应正式环境,平时开发在别的分支(比如 `dev`)上跑,测过 OK 了再合并到 `main` 部署正式环境。这样"测试环境部署的代码"和"正式环境部署的代码"不会混在一起,避免正式环境不小心跑上还没测完的东西。

## 实施前 Kiro 需要先确认一件事

先登录服务器跑一下 `free -h` 看看这台轻量服务器实际内存有多少。现在只跑一套(1 个 Node 进程 + 1 个 MySQL),加一套以后是 2 个 Node 进程 + 同一个 MySQL(多一个库,不是多一个实例),对于家庭规模的访问量,大概率够用,但如果服务器只有 2GB 内存,建议先确认一下再开工,免得跑起来发现资源不够导致互相抢内存卡顿。

## 不在这次范围内的事

- 不用买第二台服务器
- 不用给 dev 环境接真实微信登录/模板消息(继续 mock)
- 不用上 CI/CD 流水线
