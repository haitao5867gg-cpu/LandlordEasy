# Agent execution and evidence rules
1. Bootstrap: AGENTS.md → CURRENT_STATE.md → RELEASE_PLAN.md → assigned spec → relevant code. Historical specs/reviews are references when affected.
2. Work from explicit spec/Issue with owner, base commit, files, acceptance and non-goals. Identify actual engine/tool; never claim Kiro/Claude work without execution evidence.
3. Use isolated branch/worktree or explicit file ownership. Avoid concurrent writes to leases.service.ts. No main/dev direct release deployment.
4. Routine UX/API/DB/error/test decisions belong to Commander. Escalate only owner boundaries; write engineering decisions here instead of blanket questions.md pauses.
5. No unapproved features, unrelated refactors, contract text/business rule changes, production data writes, real-user messages or new costs. Preserve existing bill/date/money algorithms.
6. Backend edits: run server tsc --noEmit and full Jest. Affected frontend: vue-tsc -b and production build, plus real-browser visual/interaction checks. Unit mocks do not prove real integration. Deployment evidence requires actual loaded commit/config and health behavior.
7. Never accept worker self-report alone. Independent reviewer inspects diff and reruns required checks. Explain failed/skipped/not-run evidence. Do not mark accepted while required browser/runtime evidence is absent.
8. Before each delivery: git status and git diff --stat; include every changed/untracked file. Commit coherent work with tested hash/evidence. Never include secrets or personal data.
9. Update CURRENT_STATE and assigned spec after material progress; risks/decisions/human actions as needed. GitHub Issue/PR links provide dispatch. Historical milestone completion stays historical; V1 release acceptance is separate.
10. Merge no failing CI. CI absence is not green. No background work or scheduled monitoring is implied by a chat response; report what is actually running.

