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
| Summary limit | 2 000 chars | 20 000 chars |
| Evidence item / count | 1 000 / 50 | 4 000 / 200 |
| Output capture | 64 KiB | 1 MiB |
| Raw persistence | after parsing, final attempt only | **before** parsing, per attempt |
| Recovery from a parse failure | re-run the model | `renormalize`, zero provider calls |
| Long reports | truncated into the Issue | local artifact + sha256 in the Issue |
| Stop conditions | one undifferentiated `FAILED` | five graded classes |
| Retry | none | bounded, with backoff, transient/protocol only |
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

`upgrade` copies the current runtime aside as `*.<timestamp>.bak` before
replacing it. Nothing is deleted. Restart the runner afterwards.

Roll back at any time:

```bash
python3 project-commander-kit/scripts/pck.py rollback --config <live config>
```

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

Expect 21/21. Then dispatch one real `repo_read` job and confirm the terminal
record carries `attempt_id`, `stop_class`, and an artifact digest.

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
