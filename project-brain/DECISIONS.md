# Decisions
| ID / date | Decision | Authority / reason |
|---|---|---|
| D-001 / Sep 5 | V1.0 is a production-quality release with feature freeze, not MVP | Haitao handoff |
| D-002 / Sep 5 | Commander owns routine product/engineering choices; only stated owner boundaries escalate | Haitao handoff; supersedes older blanket questions.md approval rule |
| D-003 / Sep 5 | GitHub control plane + assigned specs are bootstrap source; old milestone records remain historical evidence | Haitao handoff |
| D-004 / Sep 5 | Repair security before whole dev deployment; main remains baseline | Haitao handoff |
| D-005 / Sep 5 | Alipay stays outside critical path pending HA-004; keep disabled behavior, no real integration work | Commander scheduling decision; final V1 exclusion pending owner |
| D-006 / Sep 5 | Keep monolith/local private storage; defer unrelated schema and infrastructure debt | Haitao handoff |
| D-007 / Sep 5 | SEC-001 uses existing active-landlord shared access and strict tenant ownership | Existing schema + guards; avoids changing business permissions |
| D-008 / Sep 5 | Current Work engineering agents may execute specs; Kiro/Claude integrations not assumed available | Environment capability check |
| D-009 / Sep 5 | Preserve e-sign manual confirmation and latest authType=1 decision; do not revert to old design's polling/authType=2 | Historical M19.11/M20.5 plus code; no new legal/business decision |

All future records include status (proposed/accepted/superseded), decision maker, reasoning and affected specs. Entries above are accepted except explicitly pending owner choices. Historical design.md sections can be older than tasks.md; inspect code and latest decision rather than reinstating obsolete behavior.

