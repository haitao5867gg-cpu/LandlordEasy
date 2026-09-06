# UX-001 — Landlord and Tenant Product Polish
Priority P1 quality gate. Status READY AFTER QA-001 FIRST PASS. Owner: frontend/QA workers; acceptance: Commander.

## Objective
Make the frozen V1 journeys feel complete and trustworthy on mobile. Fix defects and severe friction only; new business features go to post-launch backlog.

## Review dimensions
For every landlord and tenant journey in `project-brain/RELEASE_GATE.md`, inspect loading, empty, success, validation, authorization, network error, cancellation, duplicate submission, recovery, navigation/back behavior, copy, touch targets, safe areas, keyboard overlap, long text, small screens and WeChat WebView behavior.

## Required walkthroughs
- Tenant: follow/OAuth/bind → lease → bills/payment → contract/download → repair/status → termination/transfer → notifications.
- Landlord: whitelist/login → portfolio/rooms → lease lifecycle → binding/signing/manual confirmation → bills/payments/reminders → deposits/expenses/reports → request approvals → announcements.

## Rules
Reuse the current Vant/design patterns. Do not change contract wording, commercial rules, payment semantics or authorization to make UX tests easier. Every fix needs before/after evidence and affected automated regression. Accessibility and error copy must not expose PII, provider payloads or internal paths.

## Acceptance
Commander completes both walkthroughs on representative phones/viewports with no open release-blocking UX defect. All changed frontends pass `vue-tsc -b`, production build and real-browser interaction checks; cumulative CI is green. Non-blocking ideas are filed in `POST_LAUNCH_BACKLOG.md`.
