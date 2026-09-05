# SEC-001 local verification — 2026-09-05

State: LOCAL_VERIFIED; deployment acceptance PENDING. Baseline: control-plane commit a166fa0 on dev d58097e. This report accompanies the reviewed security implementation; final immutable commit is identified in its GitHub PR. No application source changes followed the final backend/browser checks.

## What changed

- Contract previews and signed archives use backend-cwd `data/private/contracts`, mode-0600 files and guarded filesystem reads. Legacy DB URL values are never interpreted as filesystem/remote fetch paths.
- Active whitelisted landlords use authenticated PDF endpoints; tenant discovery/download is scoped by task lease tenantId and SIGNED status, including historic leases. No new landlord ownership model introduced.
- Both H5 apps fetch PDF blobs with bearer headers, validate PDF content type and expose loading/error/retry. Tokens never enter download URLs.
- Nest startup middleware and both Nginx site blocks deny legacy public contract URLs. Independent review reproduced and fixed innocuous upload symlink exposure on the direct backend. Repeated URL decode is limited to denial; link checks inspect the once-decoded path Express serves.
- Offline migration defaults to dry run, preflights conflicts and links, copies/verifies before public-source removal, and can rerun. No real files were touched.

## Executed evidence

| Check | Command / configuration | Result |
|---|---|---|
| Locked install | `pnpm install --frozen-lockfile` | PASS; existing lockfile retained |
| Prisma generation | `pnpm --filter server exec prisma generate` | PASS; no database operation |
| Backend typecheck | `pnpm --filter server exec tsc --noEmit` | PASS |
| Full backend regression | `PDF_CHROME_EXECUTABLE_PATH=/path/to/headless_shell pnpm --filter server exec jest --runInBand` | 15 suites / 166 tests PASS |
| HTTP + storage security subset | included in full Jest; real Nest routing/JWT/guards, fixture DB/provider/files | 2 suites / 43 tests PASS |
| Migration | `python3 -m unittest discover -s scripts -p test_migrate_contract_files.py` | 10 fixture tests PASS |
| Landlord | `pnpm --filter landlord-h5 build` (includes vue-tsc -b) | PASS |
| Tenant | `pnpm --filter tenant-h5 build` (includes vue-tsc -b) | PASS |
| Browser | `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/headless_shell pnpm exec playwright test -c e2e/sec001.config.ts` | 5 cases PASS; 390×844 mobile viewport |
| Diff whitespace | `git diff --check` | PASS |

Runtime used Playwright headless shell build 1187; full Chromium could not launch because the container denies its Unix singleton socket. PDF test initially failed for missing browser and then full-Chromium socket restrictions; it passed with headless shell, without skipping or altering production PDF code. Official Noto CJK SC was installed in runtime only to verify readable Chinese labels. No dependency lock or font asset was changed in the repository.

Independent security review and browser review were separate Work execution agents, followed by Commander diff review and rerun of backend typecheck/full Jest/migration checks. They are not Kiro Crew or Claude Code executions.

已用真实浏览器验证界面正常：local synthetic fixtures only. Landlord CREATED preview and SIGNED download; bearer header/no URL credential; file bytes/name; loading/duplicate prevention/error/retry; preview leaves status unchanged. Tenant historic signed-contract list/download, loading failure/retry, empty state, and non-PDF rejection. Four screenshots inspected after CJK font setup; changed controls readable with no horizontal overflow at 390px. Details and reproducible cases: `e2e/sec001/README.md`.

## Not established by these tests

- Live MySQL ownership/data state, actual dev/prod loaded code and Nginx syntax/location behavior.
- Migration of real legacy contract files or restoration of real backups.
- WeChat mobile WebView blob download/open support or real Weiqian/WeChat acceptance on this candidate.
- Full tenant/landlord journey polish or V1 release readiness; these five cases cover SEC-001 interactions only.
- CI enforcement. No Actions gate exists yet; REL-003 remains open.

代码已提交，尚未部署。Issue #1 stays open; follow SEC-001-ROLLOUT.md in an authorized runtime. Do not restore public contract serving during rollback. No production data, live messages, paid signing or contract wording was changed.
