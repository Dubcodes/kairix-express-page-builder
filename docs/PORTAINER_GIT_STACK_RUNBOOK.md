# Portainer Git stack runbook

This runbook deploys Kairix Page Manager on the isolated dedicated Debian host. Approved clients reach only the authenticated Page Manager hostname through Cloudflare Access and an outbound Tunnel. Public customer-site visitors receive only validated Cloudflare Workers Static Assets and never connect to the dedicated server. Portainer, SSH, Docker, volumes, raw storage, and local preview remain owner-only/private. Cloudflare R2 is not used.

Complete [DEDICATED_SERVER_SECURITY_RUNBOOK.md](DEDICATED_SERVER_SECURITY_RUNBOOK.md) before client access.
For multiple isolated client instances on one host, also follow [MULTI_INSTANCE_CLIENT_DEPLOYMENT.md](MULTI_INSTANCE_CLIENT_DEPLOYMENT.md).

## Current live deployment versus future dedicated deployment

The current working instance may continue using its existing LAN binding and environment values while the dedicated server, hostname, Tunnel, and Access policy are prepared. Do not paste the future settings below into that live stack as an exploratory change.

> **Lockout warning:** Do not change the current Page Manager to loopback-only or enable secure proxy cookies until the Cloudflare Tunnel, hostname, and Access policy have been created and tested. Doing so prematurely may lock the operator out.

For a controlled transition, first create and test the client hostname, Access policy, Tunnel route, owner recovery access, and loopback health probe on the dedicated host. Back up the current instance. Only then deploy the client-specific Compose project with loopback binds and secure proxy cookies. The current instance remains unchanged until the replacement passes login, upload, backup, local publish, preview, and Access tests.

If the current live stack is production-mode and deliberately bound to a LAN address, the new binary will reject that bind unless the emergency override is explicit. Before pulling this commit into that transitional stack:

1. Record and back up its current environment and volumes.
2. Keep its existing `ADMIN_BIND_IP`, `ADMIN_BASE_URL`, `TRUST_PROXY`, and `COOKIE_SECURE` values unchanged.
3. Set `ALLOW_INSECURE_ADMIN_BIND=true`.
4. Redeploy from an owner management connection and confirm the prominent critical warning, health, login, and backup.
5. Do not expose the LAN bind through router forwarding.

At the tested dedicated-host cutover, change `ADMIN_BIND_IP=127.0.0.1`, the HTTPS hostname/proxy values, and `ALLOW_INSECURE_ADMIN_BIND=false` together. Do not leave the override enabled after loopback cutover.

## 1. Git stack settings

Create a Portainer stack from a Git repository with these settings:

| Setting | Value |
| --- | --- |
| Stack name | `kairix-<client-slug>` for a new client; preserve the current live stack name |
| Repository URL | `<your-github-repository-url>` |
| Repository reference | `refs/heads/feature/cloudflare-pages-publishing` |
| Compose path | `docker-compose.yml` |
| Repository authentication | Required only when the repository is private; store the credential in Portainer, not in the repository |
| Automatic Git updates | Disabled for the initial rollout; redeploy known commits deliberately |

Portainer clones the repository and builds both images from relative repository paths. Do not pre-build an image, copy the checkout to the server, or install Node.js, npm, Astro, or Wrangler on the host.

## 2. Network bindings

Both published ports must remain on `127.0.0.1`.

- `ADMIN_BIND_IP=127.0.0.1`
- `ADMIN_PORT=8040`
- `PREVIEW_BIND_IP=127.0.0.1`
- `PUBLIC_PREVIEW_PORT=4321`
- `ALLOW_INSECURE_ADMIN_BIND=false`

Host `cloudflared` forwards only `<client-slug>.manager.example.com` to `http://127.0.0.1:<client-admin-port>`. It does not forward the preview. Do not use router port forwarding, host networking, a privileged Tunnel container, or the consumer-router DMZ feature. Production fails on an unsafe preview bind and requires a prominent explicit escape hatch for a non-loopback admin bind.

## 3. Persistent storage

The Compose stack creates named volumes. Their Docker-managed host paths vary by Docker installation; use the volume names and container paths rather than assuming a host filesystem location.

| Volume | Container path | Purpose |
| --- | --- | --- |
| `<stack>_kairix-data` | `/app/data` | SQLite database plus WAL/SHM files and manual backups under `/app/data/backups` |
| `<stack>_kairix-uploads` | `/app/uploads` | Uploaded images, manuals, firmware, installers, and generated bundle ZIPs |
| `<stack>_kairix-generated-site` | `/app/generated-site` | Last promoted preview under `current` and temporary publish jobs under `.publish-staging` |

Vite's disposable build cache uses `/tmp/kairix-vite-site`. Wrangler uses `/tmp/kairix-wrangler/config` and `/tmp/kairix-wrangler/cache`. npm/home state is also under `/tmp`. These paths use the existing size-limited node-writable tmpfs, are recreated automatically, and must not be persistent volumes.

The database, uploads, backups, and last generated preview survive image replacement and normal stack redeployment. Publish staging and the live preview share one volume so final promotion is an atomic directory rename. Failed/current job directories are removed in the publish `finally` path and stale `publish-*` directories are removed at application startup.

Each publish writes exported content and its managed public-upload tree only inside the unique `/app/generated-site/.publish-staging/publish-*/` job. The read-only application source tree is never modified at runtime. Application logs go to bounded/rotated container stdout/stderr. Configuration and credentials belong in Portainer environment or read-only host secret files, not in Git.

Public upload export is allowlisted by the application-managed `files` database records. Generated software bundles are recorded before export, so their nested `bundles/` paths remain included. Unrecorded files, hidden files, editor backups, temporary/partial files, filesystem metadata, symlinks, and special entries are not copied into the public site. Excluded or missing entry counts are written to the publish logs without exposing filesystem paths. Orphaned files remain in the uploads volume until an explicit cleanup workflow is run; publishing never deletes them.

Before upgrades, create an in-app backup and separately back up all three Docker volumes. The in-app ZIP is not a complete volume backup.

## 4. Dedicated production values

Use Portainer environment values based on `.env.example`. Values shown in angle brackets are placeholders:

```env
NODE_ENV=production
ADMIN_BIND_IP=127.0.0.1
ADMIN_PORT=8040
PREVIEW_BIND_IP=127.0.0.1
PUBLIC_PREVIEW_PORT=4321
ALLOW_INSECURE_ADMIN_BIND=false
DEPLOY_PROVIDER=cloudflare-workers
ADMIN_BASE_URL=https://<client-slug>.manager.example.com
ADMIN_HOSTNAME=<client-slug>.manager.example.com
PUBLIC_BASE_URL=https://<client-worker>.<account-subdomain>.workers.dev
PUBLIC_SITE_BASE_PATH=
PUBLIC_HOSTNAME=
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_WORKER_NAME=<client-worker>
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_API_TOKEN_FILE=/run/kairix-secrets/cloudflare-api-token
TRUST_PROXY=true
COOKIE_SECURE=true
SESSION_SECRET=
SESSION_SECRET_FILE=/run/kairix-secrets/session-secret
SESSION_LIFETIME_HOURS=12
ENCRYPTION_SECRET=
ENCRYPTION_SECRET_FILE=/run/kairix-secrets/encryption-secret
ENABLE_SAMPLE_DATA_TOOLS=false
MAX_UPLOAD_MB=25
PUBLISH_MAX_FILES=20000
PUBLISH_MAX_TOTAL_MB=500
PUBLISH_MAX_FILE_MB=25
VITE_CACHE_DIR=/tmp/kairix-vite-site
XDG_CONFIG_HOME=/tmp/kairix-wrangler/config
XDG_CACHE_HOME=/tmp/kairix-wrangler/cache
CLOUDFLARE_DEPLOY_TIMEOUT_MS=600000
CLOUDFLARE_PREFLIGHT_TIMEOUT_MS=15000
```

Mount the three host secret files from `docker-compose.secrets.example.yml` read-only. For a Portainer Git stack, reproduce those exact bind entries in the deployment-owned stack configuration. File variables take precedence over legacy values.

Deploy and verify:

1. Deploy the Git stack and wait for `admin` to become healthy; `public-preview` starts only after that health check succeeds.
2. Before enabling the Tunnel route, test locally on the host with the expected Host header: `curl -fsS -H 'Host: <client-slug>.manager.example.com' http://127.0.0.1:<client-admin-port>/healthz`.
3. Configure Cloudflare Tunnel and deny-by-default Access using the dedicated-server runbook.
4. Open `ADMIN_BASE_URL` through Access and complete first-run administrator setup.
5. Create representative content. Keep sample-data tools disabled unless temporary demo content is explicitly required.
6. Inspect logs for startup, publish, validation, permission, bind, or secret-file errors.
7. In the container console, confirm the process is non-root, root is read-only, and approved paths are writable:

   ```sh
   id
   test "$(id -u)" -ne 0
   for path in /app/data /app/uploads /app/generated-site /app/generated-site/.publish-staging; do
     stat -c '%U:%G %a %n' "$path"
     test -w "$path"
   done
   node -p "require('./node_modules/wrangler/package.json').version"
   test ! -w /app
   ```

8. Upload a representative image/download, create an in-app backup, and publish. Verify the Workers site and the host-only preview separately.
9. Record one harmless content change, redeploy without deleting volumes, and confirm the user, content, uploads, backup, and preview remain.

Expected health is `healthy` after the start period. The admin restarts `unless-stopped`, receives an init process, and has 45 seconds to complete graceful shutdown.

## 5. Cloudflare Workers Static Assets for the existing Worker target

After the dedicated client instance and access path are ready, use these provider-specific values to preserve the existing `xpress-01` Worker target. This section does not authorize a deployment or an immediate mutation of the current LAN stack:

```env
DEPLOY_PROVIDER=cloudflare-workers
CLOUDFLARE_ACCOUNT_ID=<32-character-account-id>
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_API_TOKEN_FILE=/run/kairix-secrets/cloudflare-api-token
CLOUDFLARE_WORKER_NAME=xpress-01
CLOUDFLARE_DEPLOY_TIMEOUT_MS=600000
CLOUDFLARE_PREFLIGHT_TIMEOUT_MS=15000
PUBLIC_BASE_URL=https://xpress-01.jaydenlee-dcm.workers.dev
PUBLIC_SITE_BASE_PATH=
PUBLIC_HOSTNAME=
XDG_CONFIG_HOME=/tmp/kairix-wrangler/config
XDG_CACHE_HOME=/tmp/kairix-wrangler/cache
```

Do not change bindings, named volumes, or secret files as part of a provider-only change. On the future dedicated host, the preview is owner-only on its assigned loopback preview port and is not tunneled.

1. Preserve the working user-owned custom API token with Workers Scripts Edit. Do not replace it with an account-owned token known to be rejected by this installation.
2. Do not add R2, KV, Pages, Workers Routes, Containers, Observability, Builds, Tunnel, DNS, or unrelated permissions.
3. Save the token only in the read-only secret file, apply the values above, then **Pull and redeploy** without removing volumes.
4. Confirm the admin container is healthy and diagnostics show `cloudflare-workers`, Worker `xpress-01`, and configured credentials.
5. Publish once only during an explicitly approved deployment window. Preflight lists Workers in the configured account and safely reports whether `xpress-01` already exists; a missing Worker may be created by the authenticated Wrangler deployment.
6. Verify the result shows **Cloudflare Workers**, `xpress-01`, the public URL, and a Version ID when Wrangler returns one.
7. Inspect source and browser network requests. Confirm there are no `/preview/`, `/api/track`, `/api/contact-submissions`, private hostnames, secrets, or requests to the home server.
8. Verify pages, images, downloads, favicon, sitemap, `mailto:`, `tel:`, support, and marketplace links at the domain root.
9. Confirm the private `/preview/` still serves the promoted last-known-good site.

To retain Pages instead, use `DEPLOY_PROVIDER=cloudflare-pages`, set `CLOUDFLARE_PAGES_PROJECT` and `CLOUDFLARE_PAGES_BRANCH`, and follow the Pages section in `CLOUDFLARE_PAGES_RUNBOOK.md`.

Wrangler is installed from the repository lockfile and invoked directly with Node using an argument array and `shell: false`; publishing cannot invoke `npx`. The resolved token is child-environment-only. Workers deployment uses `wrangler deploy --assets <validated-site> --name xpress-01`, disables autoconfiguration, runs outside the validated asset directory, and writes disposable state only below `/tmp`. Upload failure occurs before atomic local-preview promotion, so it cannot replace the last-known-good site.

## 6. Production cutover gate

Do not cut production over until all of these are recorded as passing on the Linux host and staging project:

- Images build from the Portainer Git checkout.
- Containers become healthy and the Page Manager runs as non-root.
- Named-volume ownership and write tests pass.
- Local publishing and preview assets work.
- Data survives a controlled stack redeploy.
- Cloudflare staging preflight and the selected Pages/Workers upload work.
- The returned staging URL, public links, and assets work.
- Public output and network requests contain no private API calls or private hostnames.
- Secrets are absent from generated output and redacted logs.
- The token has only the minimum account-level permission for the selected provider.
- A staging rollback has been tested.
- Full and production-only npm audits pass.

After production cutover, public users receive only the Cloudflare Pages or Workers static site. Keep the Page Manager, Portainer, SQLite, uploads, backups, generated-site volume, and local preview private.
