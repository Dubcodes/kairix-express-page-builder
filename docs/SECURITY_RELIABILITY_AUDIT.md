# Security and reliability audit

Audit date: 2026-07-17. Scope: authentication, sessions, CSRF, settings/content CRUD, uploads, AliExpress OAuth and imports, static export, local preview, Cloudflare publishing, backups, CSV, analytics, audit logs, health/error handling, Docker startup/shutdown, and generated output.

## Confirmed findings fixed

| Severity | Component | Evidence and fix |
| --- | --- | --- |
| High | Public hosting boundary | Cloudflare-root output embedded `/api/track` and `/api/contact-submissions`, which either broke on Pages or encouraged routing to the private server. Cloudflare exports now disable runtime API scripts/forms; local mode retains them. Static-only scans reject these references. |
| High | Publish command execution | The old build runner used `shell: true` on Windows, captured unlimited output, and had no timeout. All build/Wrangler execution now uses argument arrays with `shell: false`, bounded output, timeout/cancellation, and direct installed CLI paths. |
| High | Publish integrity | The old flow emptied the live preview before deployment and deployed unvalidated mutable output. Each job now uses a unique staging tree, validates it, deploys that immutable tree, and atomically promotes it only after success. |
| High | Generated secret/file leakage | No final-tree validation existed. Publishing now rejects traversal, symlinks, special entries, `.env`, databases/WAL/SHM, backups, logs, sessions, keys, source maps, Git data, `node_modules`, server manifests/source, sensitive patterns, unsafe ZIP members, excessive files, and excessive sizes. |
| High | AliExpress integration authorization/SSRF | Any role with generic write permission could change endpoints and cause stored credentials to be posted outward. Integration configuration and operations are now Admin-only; production endpoints must be HTTPS on official AliExpress hostnames; calls have a 15-second timeout. |
| High | OAuth state replay | OAuth state remained valid after callback. State is now age-limited to 10 minutes, compared in constant time, and atomically consumed before token exchange. |
| High | First-run setup race | Two concurrent setup requests could both pass the pre-check and create Admin users. The authoritative user-count check and initial writes now run in one transaction, with rate limiting and upload cleanup. |
| High | Backup consistency | Backups read the live SQLite main file while WAL mode was active. Backups now use SQLite's online backup API, atomic archive rename, CRC inspection, and a SHA-256 database manifest check. Backup access is Admin-only. |
| Medium | Error information leakage | The global handler returned internal error messages as `details` on HTTP 500 responses. Production/internal failures now return concise safe messages; server diagnostics redact the Cloudflare token. |
| Medium | Upload spoofing/active SVG | Extension and MIME were independently allowlisted, permitting mismatched pairs; bytes were not checked. Uploads now require an extension-specific MIME and basic magic/content validation. SVGs reject active constructs and are served with a sandbox CSP. |
| Medium | Session fixation hygiene | Login created a new session but retained any existing presented session. The old session is destroyed before issuing the new random session. |
| High | Session/invite/reset expiry | ISO timestamps were compared lexically with SQLite `datetime('now')`, which could extend validity on the same calendar day. All expiry predicates now compare parsed Julian dates. |
| Medium | Public write DoS | Analytics lacked a rate limiter and accepted large arbitrary nested metadata. Analytics/contact writes are rate-limited with bounded, scalar metadata and field sizes. |
| Medium | URL-based generated XSS | Stored external/contact/asset values could retain active or credential-bearing URL schemes. Export now permits HTTP(S) links without URL credentials, validates email/telephone values, and restricts packaged assets to safe `/uploads/` paths. |
| Medium | SQLite contention/query cleanup | No explicit busy timeout and several cleanup/history lookups lacked indexes. Startup now sets a five-second busy timeout and creates session-expiry, publish-time, and analytics-time indexes. |
| Medium | Runtime/container privileges | The image ran as root with build tools installed. A multi-stage image now runs as the unprivileged `node` user, drops Linux capabilities in Compose, uses no-new-privileges, has owned writable paths, an init process, health check, and graceful publish cancellation. |

## Risk-by-risk review

- Authentication bypass and authorization: authenticated routes consistently use role/permission middleware; sensitive backup, diagnostics, user, and marketplace integration functions are Admin-only. No bypass was found.
- Sessions/cookies: random 256-bit opaque tokens are HMAC-hashed in SQLite, expire after 12 hours, are revoked on disable/reset, and use HttpOnly/SameSite=Lax. Production validation requires secure-cookie/proxy consistency for HTTPS.
- CSRF: authenticated state changes require matching cookie/header tokens using constant-time comparison. Login/setup/invite/reset and the two intentional public-write endpoints are rate-limited or otherwise bounded.
- XSS/HTML: rich content is sanitized before storage/export; Astro escapes template values; exported URLs/assets are scheme/path validated. Admin rendering predominantly uses `escapeHtml`.
- SQL injection: dynamic filters use fixed allowlists and bound parameters. No user-controlled identifier interpolation was found in SQL statements.
- Command injection: provider/account/project/branch values are validated; child arguments are arrays; no shell is used; the token is environment-only.
- Path traversal/symlinks: uploaded filenames are generated, deletion is root-contained, backup names are basenames/allowlisted, staging and output roots are resolved within the project, and deploy trees/ZIPs reject traversal and symlinks.
- Uploads: request/file-count/size limits, extension-specific MIME, signature checks, non-executable storage, `nosniff`, SVG CSP, publish-tree validation, and ZIP inspection are active.
- SSRF/OAuth: production AliExpress hosts are allowlisted, external calls time out, OAuth state is expiring/one-use, and redirect URI comes only from `ADMIN_BASE_URL`.
- Credential encryption/redaction: AliExpress secrets/tokens use AES-256-GCM under `ENCRYPTION_SECRET`; browser responses expose only boolean presence. Cloudflare tokens are never browser settings, CLI arguments, audit fields, or structured results.
- Backup exposure/integrity: backup routes are authenticated Admin-only, archives are outside static/upload roots, online snapshots include integrity metadata, and public validation rejects backups/databases.
- Cloudflare isolation: Pages receives only the validated static tree. No database, server code, source map, runtime form, local analytics endpoint, or inbound home-server dependency is included in Cloudflare mode.
- Dependency state: `npm audit --omit=dev` and the full runtime audit are part of verification; Wrangler is exact-pinned in the lockfile.

## Reliability behavior

- Database/migration failure: startup is fail-fast; `/healthz` performs a database query and reports readiness without secrets.
- Concurrent publish: a process-level lock returns HTTP 409 and always releases in `finally`; the UI also disables double submit.
- Build/deploy failure: staging is deleted, live preview is preserved, and Cloudflare is never automatically retried after upload starts.
- Timeout/shutdown: build and deployment processes receive TERM then forced kill; SIGTERM/SIGINT stop new requests and cancel the active publish.
- Cloudflare unavailable/invalid/missing: configuration validates before build; preflight retries transient network/429/5xx failures only and never retries authentication, authorization, validation, or missing-project responses.
- Empty/oversized/unsafe output: validation requires `index.html`, files, allowlisted types, and configured count/size ceilings.
- Restart during publish: unique `publish-*` staging directories are cleaned on startup. Cloudflare may have accepted an interrupted upload, so operators must inspect deployments before retrying.
- Backup writes: SQLite online backup and temporary archive rename avoid partial final archives.

## Remaining risks and follow-up

| Severity | Component | Evidence/recommendation | Reason not fixed here |
| --- | --- | --- | --- |
| Medium | Data restore | There is no restore endpoint or operator workflow; only create/inspect/download exists. Implement an offline, Admin-only restore command with pre-restore backup, manifest/hash/schema validation, database close/reopen, rollback, and explicit confirmation. | Adding a destructive live restore without maintenance-mode orchestration would reduce safety and exceeds the Pages publishing change. |
| Medium | Log/data retention | `audit_events`, `analytics_events`, and contact submissions can grow indefinitely. Add configurable retention/export and scheduled pruning with documented compliance requirements. | Retention policy is a product/operator decision; silent deletion would be unsafe. |
| Medium | Admin CSP | Helmet security headers are active, but a strict global CSP is disabled because invite/reset pages still contain inline scripts and preview pages intentionally contain inline static scripts. Move inline admin scripts to versioned assets, then apply route-specific CSPs. | Requires a separate UI asset refactor and careful preview compatibility testing. |
| Medium | Backup memory use | JSZip creates and inspects archives in memory. Move to a streaming ZIP implementation and configured maximum database/archive sizes for very large installations. | Current single-server data set and the 1 GiB inspection ceiling make this operationally bounded but not ideal. |
| Low | File-content identification | Magic checks cover supported common formats but are not a full antivirus or content-disarm system. Scan uploads with an external malware service before serving client-supplied executables. | Requires a new service and operational policy. |
| Low | Single-process lock | The lock does not coordinate multiple Page Manager replicas. Keep one admin replica, or add a shared lease before scaling horizontally. | The required architecture is a single private server/process. |
| Low | Live Cloudflare integration | Automated tests mock Cloudflare and Wrangler; no real deployment was performed. Complete the runbook checklist against a non-production Pages project first. | No credentials or clearly safe test project were available. |
| Low | Cloudflare token blast radius | Account-scoped Pages Write can affect Pages projects allowed by Cloudflare's resource scope. Restrict the token to the intended account, use IP/TTL restrictions where workable, rotate regularly, and monitor Cloudflare audit logs. | Cloudflare does not provide an application-level per-project secret in this workflow. |
| Informational | R2 | `R2StorageProvider` remains an explicitly inactive placeholder and no R2 variables are used. | R2 is intentionally deferred; normal assets remain in the static Pages upload. |
