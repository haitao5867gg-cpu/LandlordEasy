# Risks
| ID | Severity | Risk / evidence | Mitigation / owner |
|---|---|---|---|
| R-001 | P0 | Contract files public via Nest and Nginx; code VERIFIED | SEC-001; engineering + Commander |
| R-002 | P1 | Payment report cross-tenant write; handoff, verify code | SEC-002 |
| R-003 | P1 | Termination/transfer partially committed; handoff | REL-001 |
| R-004 | P1 | JWT dev-secret fallback in real/prod; handoff | REL-002 |
| R-005 | P1 | No CI; no .github workflow in pinned tree; branches unprotected | REL-003 |
| R-006 | Release blocker | Contract fourth/fifth clauses and safety appendix not verbatim approved | HA-001/002 |
| R-007 | Release blocker | E-sign test watermark/certification unresolved | HA-003 |
| R-008 | Release blocker | Current full journeys and production rehearsal not verified | RELEASE_GATE.md |
| R-009 | Schedule | Real-provider credentials/identities and original contracts require owner/third party | Request focused decisions early |
| R-010 | Verification | Historical test success and dev deploy do not prove current production readiness | commit/environment-specific evidence |
| R-011 | Access | Work can access GitHub; no Kiro/Claude CLI or production runtime access established | use available execution; retain runtime gates |

Do not infer compromise from exposure alone. No production logs/data have been audited this session. Any actual exposure investigation must minimize personal data and remain scoped.

