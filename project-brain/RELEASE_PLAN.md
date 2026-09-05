# V1.0 release plan
Planning anchor: Day 1 = 2026-09-05, day boundaries for planning only. Dates are targets, not promised launch dates. Freeze remains active.

| Window | Target dates | Deliverable / exit |
|---|---|---|
| D1 | Sep 5 | baseline, control plane, actionable specs and issues |
| D2–3 | Sep 6–7 | P0/P1 security, atomic transactions, fail-closed config |
| D3–4 | Sep 7–8 | CI quality gates passing on exact candidate |
| D4–6 | Sep 8–10 | complete M19–M21 E2E including failure recovery |
| D6–8 | Sep 10–12 | landlord + tenant walkthrough and product polish |
| D8–9 | Sep 12–13 | approved legal wording, watermark and e-sign readiness |
| D9–10 | Sep 13–14 | deployment rehearsal, backup restore, rollback drill |
| D11 | Sep 15 | RC pinned; code freeze; blocker triage |
| D12 | Sep 16 | production deployment and smoke tests if gates pass |
| D13–14 | Sep 17–18 | 3–5 real-tenant pilot, fixes and stabilization |

## Dispatch
1. SEC-001 first. SEC-002 / REL-002 / REL-003 can run independently in isolated branches once assigned. REL-001 overlaps leases service with SEC-001; serialize or assign file ownership to avoid collisions.
2. All five specs must pass independent acceptance before RC. Merge only passing gates; docs bootstrap may be prepared before CI exists but lack of CI is not recorded as PASS.
3. Product polish is mandatory after security repairs. Check existing landlord and tenant journeys, not just new screens.
4. Human actions may progress alongside engineering. Request original contract early; HA-001/002/003 must resolve before real contracts.
5. Rehearse isolated schema/config/file changes. Record actual RC hash, migration manifest, backup, health checks, restore result and rollback triggers.
6. Any missed gate causes reforecast. Preserve two days of real pilot buffer; never compress validation into the last day merely to claim Day 14.

## Reporting
Each checkpoint: readiness changes, evidence, current critical bugs, owner blockers, next acceptance step. No invented percentages. Release handoff pins branch/commit, environment, executed commands, outcomes, open risks and next owner.

