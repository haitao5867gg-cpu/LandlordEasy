# OPS-001 — Connected Dev Release Rehearsal
Priority P0/P1 gate. Status READY. Owner: senior integration engineer; acceptance: Commander.

## Objective
Close the runtime evidence that cannot be proven by unit tests or GitHub Actions, using isolated dev/staging resources before any production change.

## Required evidence
1. Pin the exact cumulative candidate SHA and record host, worktree, ports, database name and loaded environment mode without printing secrets.
2. SEC-001: back up upload metadata/files; dry-run then migrate representative contract PDFs; prove legacy `/uploads/contracts/**` denial through loaded Nginx and authenticated landlord/owning-tenant downloads through the real proxy. Test cross-tenant, unauthenticated, encoded traversal and symlink cases. Verify WeChat WebView download behavior with approved non-production identities.
3. REL-002: execute compiled startup with prod-like synthetic configuration. Missing/default JWT, mock WeChat, mock WeiQian and incomplete real-provider settings must fail before `AppModule` side effects. A complete non-secret rehearsal configuration must start and pass health checks.
4. REL-001: on isolated MySQL 8 data, inject failure after every write in termination, transfer and repair completion. Verify full rollback, then run concurrent approvals/room claims and capture lock/deadlock/retry outcomes. No production database may be used.
5. Exercise WeiQian `FOLLOWED -> LAUNCHING -> CREATED` recovery with an approved sandbox/mock boundary. Prove no duplicate provider call and document reconciliation for ambiguous `LAUNCHING` tasks.

## Safety and rollback
- No production host, database, payment, contract or user notification without a separate owner-approved runbook.
- Snapshot before mutation; list exact restore command and verify restore on isolated data.
- Stop on environment ambiguity, unexpected real-provider mode, PII in logs, or mismatch between deployed and tested SHA.

## Acceptance
Evidence packet names SHA, commands, sanitized config keys, screenshots/log excerpts, negative tests, backup/restore result and reviewer. Unit mocks alone do not pass this gate. Update SEC-001, REL-001 and REL-002 specs plus `project-brain/RELEASE_GATE.md`.
