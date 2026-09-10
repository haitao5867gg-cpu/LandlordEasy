# Migration from the LandlordEasy deployment

The kit was extracted from the LandlordEasy control plane (Issues #12/#17/#21,
PRs #22/#23/#25). This is what an existing operator must change, and what the
original deployment got wrong so a new one does not repeat it.

## What changed in the runtime

The runner is the same program with the defects removed. Behavioural changes an
existing operator will notice:

| Change | Before | After |
|---|---|---|
| Job text validation | `;` `\|` `&&` backticks rejected | control characters rejected; punctuation allowed |
| Invalid job | silently skipped | explicit `REJECTED` terminal with reason + stop class |
| Summary limit | 2 000 chars (rejecting) | 4 000-char Issue excerpt; full text in artifact; length never rejects |
| Evidence item / count | 1 000 / 50 | 4 000 / 200 |
| Output capture | 64 KiB | 1 MiB |
| Raw persistence | after parsing, final attempt only | **before** parsing, per attempt |
| Recovery from a parse failure | re-run the model | `renormalize`, zero provider calls |
| Long reports | truncated into the Issue | local artifact + sha256 in the Issue |
| Stop conditions | one undifferentiated `FAILED` | eight diagnostic classes mapped to four policies |
| Retry | none | bounded with backoff for BOUNDED_RETRY; PROTOCOL recovers locally; INVOCATION/CODE never retried |
| Attempt identity | job UUID reused | derived `attempt_id`, full audit chain |
| Routing | static order, quota ignored | free quota first, authorized paid overflow last |
| Operation targets | exact SHA pin only | exact SHA **or** owner-approved branch head |
| CI triggers | `main`/`dev` PR bases | plus `release/**` bases, `test/**` and `infra/**` pushes |

Everything protective is unchanged: identity separation, endpoint restriction to
the queue Issue, no shell, exact-SHA worktrees, delivery path allowlists,
two-pass tree validation, secret redaction with fail-closed verification,
exactly-once terminal records, and outbox durability.

## Migration steps

### 1. Back up and upgrade

```bash
python3 project-commander-kit/scripts/pck.py doctor  --config <live config>
python3 project-commander-kit/scripts/pck.py upgrade --config <live config>
```

`upgrade` stages a complete new version under `versions/`, verifies and fsyncs
it, and atomically moves the `current` pointer. Previous versions stay on disk
(never deleted by upgrade; pruned only when older than a week, beyond the
newest ten, and neither `current` nor the launchd target). Restart the runner
afterwards -- and on a flat-layout host, see 1b first.

Roll back at any time:

```bash
python3 project-commander-kit/scripts/pck.py rollback --config <live config>
```

### 1b. Before the FIRST transactional upgrade on a flat-layout host

The live host still runs the flat layout and its LaunchAgent points at
`runtime_dir/commander_runner.py`. `pck.py upgrade` writes `versions/` and moves
`current`, **but launchd keeps executing the flat file** — the upgrade reports
success and changes nothing that runs. `doctor` now fails on this
(`launchagent.consistent: false`). Sequence:

```bash
pck.py upgrade --config <live>                                     # stages versions/ + current
commander_runner.py --config <live> relink-launchagent --confirm   # plist -> current/
commander_runner.py --config <live> stop && … start
commander_runner.py --config <live> doctor                         # launchagent.consistent: true
```

The comment high-water mark seeds itself at the last comment the old runner
claimed; no GitHub call, no replay, no late REJECTEDs for historical comments.
If the state directory was ever lost, the runner refuses to serve until
`rebuild-claims --confirm` re-seeds claims from the Issue's terminal history.

Operation definitions may now name the helper at `runtime_dir/current/…`; the
flat path stays valid for hosts that have not migrated.

### 2. Config additions (all optional, all default-off)

```json
"max_attempts": 3,
"paid_overflow_providers": [],
"paid_overflow_authorized": false
```

An existing config is accepted unchanged; omitted fields take safe defaults.

### 3. Recover anything already lost

Every discarded run whose raw log still exists (7-day retention) is recoverable:

```bash
for f in ~/.local/state/landlordeasy-commander/raw-output/*.log; do
  job=$(basename "$f" .log)
  python3 <runtime>/commander_runner.py --config <config> renormalize --job "$job" || true
done
```

This calls no provider. The PR #25 closure review was recovered exactly this
way: `status: ok`, 12 131-character summary, 10 evidence items,
`usage: cost_usd=0.9081394`, `provider_calls: 0`.

### 4. Retire the exact-SHA operation pin

`ops001_mysql_probe` is pinned to `104de15…`, which is not the head of any
branch under test — so the controlled MySQL operation could never run against
the candidate, and the work fell back to a human. Replace the pin:

```json
"allowed_target_shas": [],
"allowed_target_branches": ["test/rel001-mysql-integration"]
```

The owner still authorizes exactly one branch; the resolved SHA is recorded in
the terminal record. `main`/`dev`/`master`/`HEAD` are refused.

### 5. Fix the wake target

`wake_pull_request` currently points at PR #22, which is **merged**. Point it at
an open PR or set it to `null`. Wake notices carry no authority either way, but
a merged PR is a confusing place to receive them.

### 6. Re-run the canary

```bash
python3 project-commander-kit/runner/tests/canary_end_to_end.py
```

Expect every check green (34 as of PR B). Then dispatch one real `repo_read`
job and confirm the terminal record carries `attempt_id`, `stop_class`, and an
artifact digest.

### 7. (PR B) Split evidence off the queue

Create a long-lived Issue from the Executor or Commander account titled so it
is obviously not a queue (LandlordEasy: #29 "Commander evidence log — do not
close"), then set `"evidence_issue": 29`. From the next tick every Executor
record lands there; records already queued for the queue Issue are still
delivered to the queue Issue (the outbox row says where it must go).
`rebuild-claims` scans both Issues. The high-water cursor stays a queue
cursor.

### 8. (PR B) Owner notification

```json
"operational_executables": {"gh": "…", "git": "…", "python": "…", "osascript": "/usr/bin/osascript"},
"notify_channel": "imessage",
"notify_recipient": "<phone or Apple ID, this file only>",
"notify_enabled": true
```

Run `commander_runner.py --config <path> notify-test --confirm` once while
sitting at the host: macOS will ask whether `python3` may control Messages.
Allow it; the test message should arrive within seconds.

### 9. (PR B) Plan canary, then wake retirement

Have the Commander post one two-step `COMMANDER_PLAN_V1` (an operation, then
a `repo_read` review with `{"from_step": …}`). Expect one
`COMMANDER_PLAN_RUNNER_V1 COMPLETED` on the evidence Issue and one phone
notification. Only after that passes set `"wake_pull_request": null`; no
wake code or table is removed.

## Lessons worth carrying forward

1. **Validate what the sink actually requires.** Filtering shell metacharacters
   out of a string that never reaches a shell blocked legitimate work and
   protected nothing. Validate for the real sink — argv safety means control
   characters, not semicolons.

2. **Persist before you parse.** The most expensive bug in the system was a
   2 000-character limit meeting a 12 131-character answer, with the bytes
   already thrown away. Durability must come before validation, always.

3. **Silence is not a state.** "Skipped" and "not yet seen" were
   indistinguishable, so a human filled the gap. Every terminal outcome needs a
   record, refusals included.

4. **Grade your failures.** One `FAILED` bucket for "tests are red" and "the CLI
   flag was wrong" makes automation stop for things it could have fixed itself.

5. **Do not pin to something your own commits change.** An exact-SHA
   authorization that any fix invalidates is a deadlock. Authorize the branch;
   record the resolved commit.

6. **Check that CI triggers cover the branches you actually use.** PR #25 had no
   exact-head CI at all because its base matched no `pull_request` filter and its
   head prefix matched no `push` filter.
