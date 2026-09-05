# SEC-001 secure rollout and rollback

Status: implementation prepared; **not deployed, no real files migrated**. P0 remains open until actual proxy/app denial and authenticated downloads pass. Migration fixtures are not real integration evidence.

## Preconditions

- Obtain explicit approval before production deployment or production data mutation. Rehearse in isolated dev first. Do not run these instructions automatically.
- Identify each PM2 backend's actual `cwd`, upload directory, app user/group, and loaded Nginx site configuration. Do not assume the Git checkout root equals runtime `cwd`. The private target is `<backend cwd>/data/private/contracts`; it must not be beneath any public alias/root. Inspect symlinks and mount configuration.
- Use Python 3.11+ on POSIX. Run as the backend file owner (not a different owner that would leave mode-0600 PDFs unreadable). Stop contract writers and keep them stopped throughout migration; the script is an offline migration, not a concurrent filesystem mutation protocol. Untrusted users must have no write permission to these directories.
- Capture a protected backup of the relevant upload/private directories and database metadata. Keep backup outside all public roots. Record checksums securely. Audit previously exposed URLs/access logs and any proxy/CDN caches without putting personal information in GitHub.

## Order of operations

1. First deploy the Nginx denial in both HTTPS server blocks, preserving it through all later steps. Inspect actual location precedence: case-insensitive contract regex must precede competing regex locations, and `/uploads/` must not be `^~`. Nginx matches decoded, normalized URIs. Non-contract uploads stay available, but symlink-backed uploads are intentionally denied. Validate `nginx -t`, reload, and confirm the active configuration. Stop the old backend or install the app denial immediately as well; ensure its port is not publicly exposed. Do not leave the old application reachable while waiting for migration.
2. Place affected contract journeys into maintenance and stop backend contract writers. Confirm there are no old workers/instances still writing public PDFs.
3. From the approved checkout, run dry-run only, separately for each environment:

   ```bash
   python3 scripts/migrate-contract-files.py --root /EXACT/BACKEND/CWD
   ```

   Review every planned filename/count and SHA-256. No files/directories are created by dry-run. Unknown contract-prefixed names abort for manual investigation. Source/destination symlinks and hardlinks abort. Differing destinations abort before any migration writes. Resolve discrepancies from protected originals; do not overwrite or delete a conflicting PDF automatically.
4. After review and authorized maintenance start, apply with the same exact root:

   ```bash
   python3 scripts/migrate-contract-files.py --root /EXACT/BACKEND/CWD --apply
   python3 scripts/migrate-contract-files.py --root /EXACT/BACKEND/CWD
   ```

   Apply copies files with mode 0600, fsyncs and SHA-256 verifies the destination and unchanged source before removing the public source. Matching destinations are verified and reused. Repeated application is safe. A failure midway may leave some already migrated files and a partial private destination; public source for the failed copy is retained. Keep maintenance/denial active, investigate against backup and rerun only after resolving the private partial file. No DB metadata is changed by this script.
5. Deploy the new backend and both H5 builds with the denial retained. Verify the backend can access the private files as its runtime user and legacy metadata resolves only to private authenticated reads. Start the backend, then reopen affected journeys after smoke checks.

## Required real-environment evidence

Using a known existing **fixture contract** in each environment, record HTTP status, content type and absence of PDF bytes for:

- Anonymous direct `/uploads/contract-<id>-signed.pdf` and preview URLs.
- Mixed case `CONTRACT-<id>-SIGNED.PDF`, percent-encoded `/%75ploads/%63ontract-<id>-signed.pdf`, encoded slash `/uploads%2fcontract-<id>-signed.pdf`, duplicate slashes, normalized dot segments, and nested upload paths. Use `curl --path-as-is` so the client does not hide traversal cases. Test both external proxy and direct backend. Old paths must disclose no PDF even when a fixture public file still exists.
- Unauthenticated/invalid-token/wrong-tenant/disabled-landlord API download attempts; no provider call or PDF read should occur for denied users.
- Valid active landlord preview and signed downloads; own tenant signed download including a historic lease; tenant preview denied. Confirm `application/pdf`, attachment disposition, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`.
- Legitimate repair-image upload URLs still work. Private filesystem paths never work as public URLs.
- Real WeChat mobile browser landlord and tenant download/open behavior, loading/error recovery, payment and e-sign journeys unaffected.

Check any upstream cache for previously cached PDFs and purge it using the approved provider procedure. Origin denial does not erase a previously distributed copy. Do not copy contract contents or bearer tokens into evidence. Production remains gated until these checks are actually performed.

## Rollback invariant

**Never restore public contract serving or copy PDFs back into uploads.** Keep Nginx denial and backend network isolation. Roll back only to a build containing access control; if unavailable, disable contract functionality and keep it in maintenance while repairing. Retain private originals and metadata backup. Restoring database state requires separate production approval and must not reopen URLs. A UI rollback may temporarily remove contract buttons but cannot bypass the authenticated API.

## Local verification

`python3 -m unittest discover -s scripts -p 'test_migrate_contract_files.py'`: 10 fixture tests passed (dry-run, idempotence, matching/conflicting destination, source/destination and directory symlinks, hardlinks, case normalization, unexpected names, non-contract preservation). Nginx binary is unavailable in the implementation environment: syntax/load and real proxy bypass tests remain pending. No dev/prod data migration or deployment has been performed.

Independent review additionally reproduced an innocuously named public symlink exposing a private PDF through the direct backend. The application now rejects symlinked ancestors/files and multi-link files using the once-decoded static pathname, while repeated decoding protects legacy-name denial. Nginx `disable_symlinks` does not reject hardlinks: inspect the complete public upload tree for unexpected links before opening traffic and preserve trusted-directory/no-untrusted-writers controls. Full local results are in SEC-001-VERIFICATION.md.
