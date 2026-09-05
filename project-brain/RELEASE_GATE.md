# Release gates
Decision at initialization: NO-GO. States: PENDING / PASS / FAIL / BLOCKED. A PASS needs dated evidence, exact candidate commit, environment, command or walkthrough, result and reviewer. Historical PASS cannot be silently reused after affected code changes.

| Gate | Acceptance | Initial state |
|---|---|---|
| Security | SEC-001/002 accepted; old PDF URLs denied through actual proxy; tenant isolation; active landlord checks; no known P0/P1 security issue | BLOCKED |
| Data integrity | REL-001 failure injection and concurrent approvals; no duplicate lease/bill/settlement; external failures recover visibly | BLOCKED |
| Configuration | REL-002 rejects missing/unsafe real/prod settings before side effects | BLOCKED |
| CI | REL-003 all six steps pass exact candidate; no production credentials or deployment; enforcement evaluated | BLOCKED |
| Feature completeness | M19–M21 acceptance matrix closed; all required journey steps reachable | PENDING |
| UX completeness | both full mobile walkthroughs and failure states accepted | PENDING |
| Integrations | real WeChat binding/OAuth/payment/cancel/retry/callback; e-sign failure/manual confirmation/download verified with approved test identities | PENDING |
| Legal | HA-001/002 approved verbatim; HA-003 production certification/watermark decision resolved | BLOCKED |
| E2E | current candidate regression executed; critical paths pass, skipped tests justified; mock vs real evidence separated | PENDING |
| Deployment | backup restore and rollback rehearsed, environment isolation and proxy rules verified; deploy hash confirmed | PENDING |
| Pilot | HA-005/007 complete, 3–5 selected tenants, two-day observation target, no open P0/P1 | PENDING |

## Required walkthrough matrix
Tenant: follow service account → OAuth → binding → lease → bill → WeChat payment → contract → authenticated download → repair → repair status → termination → transfer → notification.
Landlord: login/whitelist → portfolio/buildings/rooms → create/renew/end lease → tenant binding → e-sign preview/manual confirmation/download → bills/manual entries/reminders → deposits/expenses/reports → repair/termination/transfer approvals → announcements and delivery result.
For each relevant step record happy path, loading, empty/error state, duplicate submission, cancellation, authorization, network failure, navigation/copy/mobile layout and recovery. Payment cancellation and e-sign failure are explicit cases.

## Release decision
Commander assembles concrete GO/NO-GO packet with release commit, exact deploy plan, evidence, costs, blast radius, backups and rollback. Only then escalate irreversible production actions or material owner decisions. No unknown critical gate, failing CI or unresolved P0/P1 may be waived to hit a date.
Staging success != deployed success. Signed PDF availability != proof tenant signed; preserve approved manual confirmation process and verify its business acceptance separately.

