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
| D-010 / Sep 6 | Finish the Commander control system first; Haitao will then assist connecting Kiro CLI, Copilot CLI and Claude Code for spec-driven execution | Haitao owner instruction; external subscriptions/tools are not assumed callable until that handoff |
| D-011 / Sep 6 | Accept Kiro 2.21.1, Copilot 1.0.82 and Claude Code 2.1.263 as bounded workers under ORG-001; each task still requires explicit Spec permissions and independent review | Successful isolated read-only bootstrap tests with clean repository invariants |
| D-012 / Sep 6 | Route standard coordination to Kiro, mechanical work to Copilot and difficult security/integration work to Claude; conserve monthly Kiro/Copilot and weekly Claude quota | Haitao delegated tool/model selection to Commander; observed CLI capability and quota cycles |

All future records include status (proposed/accepted/superseded), decision maker, reasoning and affected specs. Entries above are accepted except explicitly pending owner choices. Historical design.md sections can be older than tasks.md; inspect code and latest decision rather than reinstating obsolete behavior.
