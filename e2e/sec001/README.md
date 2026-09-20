# SEC-001 frontend browser acceptance

This isolated suite starts only two local Vite servers. Playwright intercepts API calls using synthetic leases, sessions, task metadata and PDF bytes. It never starts a backend, accesses a database, or invokes WeChat/Weiqian. It tests actual Vue interactions in Chromium; it does not prove server authorization or real WeChat WebView download support.

Run from repository root after locked dependency install and installing Playwright Chromium:

```sh
pnpm exec playwright test -c e2e/sec001.config.ts
```

When a system Chromium/headless-shell executable is needed:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/headless_shell pnpm exec playwright test -c e2e/sec001.config.ts
```

The five cases cover landlord CREATED preview and SIGNED download, authentication headers with no URL token, unchanged preview status/no signing mutation request, received PDF bytes and filenames, in-flight duplicate prevention, download failure and retry, tenant historic signed-contract discovery, list failure/retry, empty state, and rejected non-PDF response. Screenshots and failure traces are generated under ignored `e2e/test-results/sec001/`; viewport is 390 × 844. API fixture ownership is not evidence that actual cross-tenant authorization is enforced (covered separately by backend HTTP tests).

Both frontend production builds include the required `vue-tsc -b` gate:

```sh
pnpm --filter landlord-h5 build
pnpm --filter tenant-h5 build
```

2026-09-05 local execution: five cases passed on SEC-001 working changes atop `a166fa0`; both builds/typechecks passed. Headless shell 1187 ran successfully; full Chromium was unavailable due container Unix socket restrictions. Initial screenshots exposed missing CJK fonts in the execution runtime. Installed official Noto Sans CJK SC Regular from `notofonts/noto-cjk` into runtime user fonts (no repository font change), refreshed font cache, and reran all five cases: PASS (12.5 seconds). Inspected all four resulting screenshots: Chinese labels render correctly, changed contract controls and tenant historic/empty states are readable, and no horizontal overflow occurs at 390 pixels. Real WeChat-browser verification remains a release gate. Full-page landlord screenshots include the existing fixed global property selector; the changed contract controls remain reachable and unobscured during actual button interaction.
