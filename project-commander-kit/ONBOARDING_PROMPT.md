# Onboarding prompt

Hand the whole block below to a capable coding agent working in the target
repository, with `project-commander-kit/` already copied in. It is designed to
be self-contained: it assumes no chat history and no prior context.

---

```
You are installing the "project-commander-kit" AI control plane into this
repository. The kit directory is already present. Work autonomously; ask only
when you hit something in the STOP list.

WHAT YOU ARE BUILDING
A GitHub Issue acts as a job queue. A Commander GitHub account posts structured
job comments. A local runner, authenticated as a DIFFERENT Executor GitHub
account, polls that Issue, executes each job in an isolated git worktree pinned
to an exact commit SHA, and posts a terminal record back. State is recovered
from GitHub and repository files, never from chat history.

READ FIRST, IN THIS ORDER
1. project-commander-kit/README.md
2. project-commander-kit/ARCHITECTURE.md
3. project-commander-kit/SECURITY_MODEL.md
4. project-commander-kit/FAILURE_AND_RETRY_POLICY.md
5. project-commander-kit/PROTOCOLS.md
6. project-commander-kit/NEW_PROJECT_BOOTSTRAP.md
Then read this repository's build/test setup to learn its real check commands.

YOUR TASKS
1. Verify the kit is intact:
     python3 -m unittest discover -s project-commander-kit/runner/tests
     python3 project-commander-kit/runner/tests/canary_end_to_end.py
   Expect 146 tests OK and 21/21 canary checks. If not, stop and report.

2. Install the CI workflow from
   project-commander-kit/templates/.github/workflows/ into .github/workflows/,
   and rewrite its steps to run THIS project's real checks (install, typecheck,
   test, build). Keep `permissions: contents: read`. Add no deploy step, no
   environment, and no secrets.
   Make the triggers cover the branches actually used here: every candidate
   branch prefix under push.branches, and every base you open PRs against under
   pull_request.branches. A candidate with no CI is the failure to avoid.

3. Install the PR template and the queue-Issue template from
   project-commander-kit/templates/.github/.

4. Produce a filled-in config at <repo>/.commander/config.json.example, derived
   from project-commander-kit/config/config.example.json, with:
     - real absolute paths for git, gh, python3 and any provider CLI on this host
       (find them with `command -v`)
     - a quality gate whose argv runs this project's real test command
     - enabled_profiles: ["repo_read"] only
     - enabled_operations: [] and wake_pull_request: null
   Do NOT invent GitHub logins, the queue Issue number, or a runner_id — leave
   clear placeholders. Validate it against config/config.schema.json.

5. Write <repo>/.commander/SETUP.md: the exact steps for this specific project,
   including the two-account requirement, the chmod 600 step, the doctor loop,
   and a ready-to-paste canary job comment using this repository's name.

6. Report: what you changed, the test and canary results verbatim, and every
   placeholder a human must still fill in.

HARD CONSTRAINTS
- Never weaken a safety property to make something pass. Specifically: keep the
  Commander/Executor identity split, keep GitHub access limited to the queue
  Issue, keep exact-SHA worktrees, keep shell=False argv execution, keep secret
  redaction fail-closed, and keep delivery path allowlists exact.
- Never widen `enabled_profiles`, `enabled_operations`, or paid-quota
  authorization on your own.
- Do not create GitHub accounts, log in, post to any Issue, open a PR, merge,
  deploy, or contact production.
- Do not print, commit, or log any credential, token, cookie, or private key.
- Do not force-push, and do not delete existing backups, worktrees, or state.

STOP AND ASK if a task requires: creating or authenticating an account; touching
production, a real database, or a payment/third-party provider; spending money;
merging or deploying; or deleting anything you did not create.

DEFINITION OF DONE
Kit tests and canary pass; CI workflow runs this project's real checks with
correct triggers; templates installed; a schema-valid example config exists with
real host paths and honest placeholders; SETUP.md tells a human exactly what
remains. You have created no GitHub state and touched nothing outside this
repository.
```
