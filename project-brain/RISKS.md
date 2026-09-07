# Risks
As of 2026-09-07 UTC. Rehearsal candidate: `104de1521cf194c9dc76ccca52741f05a75f1180`. "Mitigated in rehearsal candidate" means the fix is present in that candidate and its CI Quality Gate passed; it is not "verified in rehearsal" (proven against a pinned running environment) and not "deployed to Production" (merged/live on `main`) unless stated.

| ID | Severity | Risk / evidence | Mitigation / owner | Status |
|---|---|---|---|---|
| R-001 | P0 | Contract files public via Nest and Nginx; code VERIFIED | SEC-001; engineering + Commander | Mitigated in rehearsal candidate; not yet verified in rehearsal; not deployed to Production |
| R-002 | P1 | Payment report cross-tenant write; handoff, verify code | SEC-002 | Mitigated in rehearsal candidate; not yet verified in rehearsal; not deployed to Production |
| R-003 | P1 | Termination/transfer partially committed; handoff | REL-001 | Mitigated in rehearsal candidate; not yet verified in rehearsal; not deployed to Production |
| R-004 | P1 | JWT dev-secret fallback in real/prod; handoff | REL-002 | Mitigated in rehearsal candidate; not yet verified in rehearsal; not deployed to Production |
| R-005 | P1 | No CI; no .github workflow in pinned tree; branches unprotected | REL-003 | CI Quality Gate passed on rehearsal candidate; branch protection / required-check enforcement still pending |
| R-006 | Release blocker | Contract fourth/fifth clauses and safety appendix not verbatim approved | HA-001/002 | Unresolved human blocker; not addressed by rehearsal candidate |
| R-007 | Release blocker | E-sign test watermark/certification unresolved | HA-003 | Unresolved human blocker; not addressed by rehearsal candidate |
| R-008 | Release blocker | Current full journeys and production rehearsal not verified | RELEASE_GATE.md | Open; OPS-001 isolated rehearsal and M19–M21 E2E still pending |
| R-009 | Schedule | Real-provider credentials/identities and original contracts require owner/third party | Request focused decisions early | Open |
| R-010 | Verification | Historical test success and dev deploy do not prove current production readiness | commit/environment-specific evidence | Open; standing verification rule |
| R-011 | Access | Work can access GitHub; no production runtime access established | use available execution; retain runtime gates | Partially addressed: ORG-002 Commander Runner (baseline `77487255a60502ae5cef9f753380629289ba39e1`) provides scoped, least-privilege Kiro/Copilot/Claude development execution with human-approved delivery; production runtime access remains unestablished and out of scope |

Do not infer compromise from exposure alone. No production logs/data have been audited this session. Any actual exposure investigation must minimize personal data and remain scoped.

