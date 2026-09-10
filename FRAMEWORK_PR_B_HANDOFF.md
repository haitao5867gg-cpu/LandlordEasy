# PR B handoff — plan executor, evidence split, owner status, iMessage notification

Branch `infra/commander-plan-executor`, Draft PR #30 (stacked on PR #26 / PR A).
Code head: `d082ba0`. This file is the only commit after it.

## Delivered (all offline-verified, then rolled out to the Mac mini)

| Item | Where | Proof |
|---|---|---|
| `COMMANDER_PLAN_V1` executor — ≤10 forward-only steps, derived jobs run through the unchanged posted-job path, edge lookup on `ok` / stop class / `verdict.*`, `FAIL_CLOSED` → `USER_ACTION_REQUIRED_V1`, crash-resume | `commander_runner.py`: `Plan`, `derive_step_job`, `advance_plans`, `finish_plan`, `run_job_to_terminal` | `tests/test_plan_and_notify.py` PlanParsingTests + PlanExecutionTests (incl. `test_a_crash_between_steps_resumes_from_the_next_step`); canary checks 22–34 |
| Queue / Evidence split (`evidence_issue`), `_api` as one complete allowlist, pre-split outbox rows still delivered where they were queued, `rebuild-claims` scans both issues | `Config.terminal_issue`, `GitHubClient._api`, `drain_terminal_outbox`, `record_issues` | EvidenceSplitTests; canary `all_executor_records_on_evidence_issue` |
| `CURRENT_USER_STATUS` pinned comment (POST once, PATCH in place, heartbeat 600 s, re-create only when gone); `COMMANDER_ACK_V1` | `refresh_user_status`, `user_status_body`, `ACK_RE` | UserStatusTests; canary `status_is_patched_in_place_not_reposted` |
| Owner notification through Messages.app — `notify_outbox` in the terminal transaction, fixed `IMESSAGE_SCRIPT`, argv-only, minimal payload, default off, 5 attempts then `gave_up` | `_after_terminal_tx`, `drain_notify_outbox`, `send_imessage`, CLI `notify-test` | NotifyOutboxTests; canary `notification_carries_no_evidence`, `script_is_the_shipped_constant` |
| doctor: `evidence`, `notify`, notification depth, open actions, status comment | `evidence_health`, `notify_health`, `queue_health` | live doctor below |
| Docs + config schema + `COMMANDER_CONSOLE_PROMPT.md` | `project-commander-kit/` | — |

Offline: 274/274 in `tools/commander-runner` and in the kit copy; `sync_from_source.py --check` clean; canary 34/34.

## Live rollout (2026-09-10, Mac mini)

1. `pck.py upgrade` → `versions/20260910T051333Z-d082ba0e`, manifest v3 `source_commit d082ba0…`, tests OK, previous version `…-41330b18` kept.
2. Live config (0600, backed up as `config.json.20260910T0515-pre-prb.bak`): `evidence_issue: 29`, `operational_executables.osascript`, `notify_channel: imessage`, `notify_enabled: true`, recipient set (lives only in that file).
3. Runner restarted from `current/` (LaunchAgent `follows_pointer: true`).
4. doctor `ok: true`; `evidence {issue 29, open, usable}`; `notify {usable: true}`; queue polling fresh; high-water unchanged.
5. `notify-test --confirm` → `NOTIFY_SENT`; `notify_outbox` row `test:… sent`.
6. First `CURRENT_USER_STATUS` created on Issue #29 (comment 5613545224) with `recent=` listing the last five real terminals from #17.

Still open, owner-side: the Executor PAT is a classic token with `workflow` (doctor `overbroad: ['workflow']`). A fine-grained PAT cannot target a repository owned by another personal account, so the fix is a classic token with only `repo`, or moving the repository into an organization.

## What the Commander must do next (the plan canary)

Post one `COMMANDER_PLAN_V1` on Issue #17 as `haitao5867gg-cpu`. A safe first plan: `ops001_mysql_probe` (read-only, already pinned to `104de1521cf194c9dc76ccca52741f05a75f1180`) followed by a `claude` `repo_read` review at `{"from_step": "s1"}`. Expected: two step terminals + one `COMMANDER_PLAN_RUNNER_V1 COMPLETED` on #29, `CURRENT_USER_STATUS` patched, one iMessage. Only after that passes: `wake_pull_request: null` (decision #3). Nothing wake-related was removed.

## Boundaries kept

Normal push; Draft; no merge; no deploy; no production / real data / payment / credential contact; the phone number is in the 0600 config only and in no commit, comment, or log; no comment-based lease; background Commanders have no dispatch power; wake code and history untouched.
