# LandlordEasy V1.0
Updated: 2026-09-05. Product Owner / CEO: Haitao. Commander: current ChatGPT Work session.

## Mission
Deliver a safe, complete, stable, polished Production V1.0 for real landlords and tenants in approximately 14 days. This is not an MVP launch. Production launch readiness is the sole north star; calendar targets never waive acceptance gates.

## Scope
pnpm monorepo; NestJS / Prisma / MySQL 8; Vue 3 / Vite / Vant / Pinia landlord and tenant H5; Tencent Cloud / Nginx / PM2; isolated main/dev worktrees, databases and ports. Design capacity about 300 rooms and three landlords. Existing repository describes ~130 historical rooms; actual inventory is not re-audited. No microservices.

V1 includes existing property/room/lease/bill/deposit/expense/maintenance/report/reminder flows, WeChat OAuth and JSAPI payments, M19 e-sign/PDF/manual confirmation, M20 tenant binding, M21 termination/transfer/repair/announcements. Preserve mock/real boundaries.

## Feature freeze
Only P0/P1 security, release blockers, required M19–M21 gaps, severe pilot UX issues and production bugs enter the release. Other requests go to POST_LAUNCH_BACKLOG.md. Ordinary UX polish is required within existing journeys; it is not permission to add business scope.

## Roles
Haitao decides business rules, contract/legal content, major direction, third-party commercial matters, irreversible production actions, material added costs and major real-user strategy. Commander decides ordinary UX/API/DB implementation, validation, errors/loading/empty states, testing and bounded refactoring, targeting 90–95% autonomous routine decisions.
Commander: understand → decide → specify → delegate → independently verify → release.
Planned execution organization: Kiro Crew; complex engineering: Claude Code; mechanical work: Copilot/Kiro workers. Availability and authentication must be verified separately; subscriptions are not an API pool. Current Work execution agents may implement assigned specs; do not claim another product executed them.

## Permanent record
GitHub is the source of truth. Read AGENTS.md, CURRENT_STATE.md, RELEASE_PLAN.md, assigned spec, then relevant code. Changes, evidence, blockers and handoff must be committed with the work. A chat promise, worker self-report or historical checkbox is not acceptance.

