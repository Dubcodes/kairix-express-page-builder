# Portainer Git stack runbook

This runbook deploys the private Kairix Page Manager on a Linux Docker host while publishing only validated static output to Cloudflare Pages or Cloudflare Workers Static Assets. Public visitors must never connect to Portainer, the Page Manager, its local preview, or its volumes. Cloudflare R2 is not used.

## 1. Git stack settings

Create a Portainer stack from a Git repository with these settings:

| Setting | Value |
| --- | --- |
| Stack name | `kairix-page-manager` (recommended) |
| Repository URL | `<your-github-repository-url>` |
| Repository reference | `refs/heads/feature/cloudflare-pages-publishing` |
| Compose path | `docker-compose.yml` |
| Repository authentication | Required only when the repository is private; store the credential in Portainer, not in the repository |
| Automatic Git updates | Disabled for the initial rollout; redeploy known commits deliberately |

Portainer clones the repository and builds both images from relative repository paths. Do not pre-build an image, copy the checkout to the server, or install Node.js, npm, Astro, or Wrangler on the host.

## 2. Network bindings

Both published ports default to `127.0.0.1` and are therefore inaccessible from other LAN devices until explicitly configured.

- Set `ADMIN_BIND_IP=<linux-server-lan-ip>` to expose the authenticated Page Manager only on that LAN interface.
- Keep `ADMIN_PORT=8080`, or choose another unused host port.
- Keep `PREVIEW_BIND_IP=127.0.0.1` unless a separate LAN-only nginx preview is required.
- Keep `PUBLIC_PREVIEW_PORT=4321`, or choose another unused host port.
- Do not use router port forwarding, public firewall rules, or an inbound Cloudflare Tunnel for either port.
- Do not expose Portainer publicly. Do not weaken Page Manager authentication because it is LAN-only.

If the Linux server is multi-homed, use its specific trusted-LAN address instead of `0.0.0.0`. The built-in preview remains available at `/preview/` through the Page Manager in local mode.

## 3. Persistent storage

The Compose stack creates named volumes. Their Docker-managed host paths vary by Docker installation; use the volume names and container paths rather than assuming a host filesystem location.

| Volume | Container path | Purpose |
| --- | --- | --- |
| `<stack>_kairix-data` | `/app/data` | SQLite database plus WAL/SHM files and manual backups under `/app/data/backups` |
| `<stack>_kairix-uploads` | `/app/uploads` | Uploaded images, manuals, firmware, installers, and generated bundle ZIPs |
| `<stack>_kairix-generated-site` | `/app/generated-site` | Last promoted preview under `current` and temporary publish jobs under `.publish-staging` |

Vite's disposable build cache uses `/tmp/kairix-vite-site`. Wrangler uses `/tmp/kairix-wrangler/config` and `/tmp/kairix-wrangler/cache`. These paths use the existing node-writable tmpfs, are recreated automatically, and must not be persistent volumes.

The database, uploads, backups, and last generated preview survive image replacement and normal stack redeployment. Publish staging and the live preview share one volume so final promotion is an atomic directory rename. Failed/current job directories are removed in the publish `finally` path and stale `publish-*` directories are removed at application startup.

Each publish writes its exported content JSON only inside the unique `/app/generated-site/.publish-staging/publish-*/input/` job. Public uploads under `site/public/uploads` are reconstructed from SQLite-managed file records and the uploads volume. Neither build input requires separate persistence. Application logs go to container stdout/stderr. Configuration and Cloudflare credentials belong in Portainer environment/secret storage, not in volumes or Git.

Public upload export is allowlisted by the application-managed `files` database records. Generated software bundles are recorded before export, so their nested `bundles/` paths remain included. Unrecorded files, hidden files, editor backups, temporary/partial files, filesystem metadata, symlinks, and special entries are not copied into the public site. Excluded or missing entry counts are written to the publish logs without exposing filesystem paths. Orphaned files remain in the uploads volume until an explicit cleanup workflow is run; publishing never deletes them.

Before upgrades, create an in-app backup and separately back up all three Docker volumes. The in-app ZIP is not a complete volume backup.

## 4. First deployment: local mode

Use Portainer environment values based on `.env.example`. Values shown in angle brackets are placeholders:

```env
NODE_ENV=production
ADMIN_BIND_IP=<linux-server-lan-ip>
ADMIN_PORT=8080
PREVIEW_BIND_IP=127.0.0.1
PUBLIC_PREVIEW_PORT=4321
DEPLOY_PROVIDER=local
ADMIN_BASE_URL=http://<linux-server-lan-ip>:8080
ADMIN_HOSTNAME=
PUBLIC_BASE_URL=http://<linux-server-lan-ip>:8080
PUBLIC_SITE_BASE_PATH=/preview
PUBLIC_HOSTNAME=
TRUST_PROXY=false
COOKIE_SECURE=false
SESSION_SECRET=<random-value-at-least-32-characters>
ENCRYPTION_SECRET=<different-random-value-at-least-32-characters>
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

Leave all `CLOUDFLARE_*` credential/project values empty in local mode. Keep the two application secrets different. If an HTTPS reverse proxy is later added for private admin access, set the final `https://` admin URL, `TRUST_PROXY=true`, and `COOKIE_SECURE=true` together.

Deploy and verify:

1. Deploy the Git stack and wait for `admin` to become healthy; `public-preview` starts only after that health check succeeds.
2. From the trusted LAN, open `ADMIN_BASE_URL` and complete first-run administrator setup.
3. Create representative content. Keep sample-data tools disabled unless temporary demo content is explicitly required.
4. Publish and verify the built-in `/preview/` pages, images, downloads, product links, support links, and missing-page handling.
5. Inspect logs for startup, publish, validation, permission, or secret-redaction errors.
6. In the container console, confirm the process is non-root and the mounted paths are writable:

   ```sh
   id
   test "$(id -u)" -ne 0
   for path in /app/data /app/uploads /app/generated-site /app/generated-site/.publish-staging; do
     stat -c '%U:%G %a %n' "$path"
     test -w "$path"
   done
   node -p "require('./node_modules/wrangler/package.json').version"
   ```

7. Create an in-app backup. Record one harmless content change, redeploy the same stack without deleting volumes, and confirm the user, content, uploads, backup, and preview remain.

Expected health is `healthy` after the start period. The admin restarts `unless-stopped`, receives an init process, and has 45 seconds to complete graceful shutdown.

## 5. Second stage: Cloudflare Workers Static Assets

Use these exact Portainer values for the current Worker, retaining the existing private admin/network/volume values:

```env
DEPLOY_PROVIDER=cloudflare-workers
CLOUDFLARE_ACCOUNT_ID=<32-character-account-id>
CLOUDFLARE_API_TOKEN=<workers-scripts-edit-token>
CLOUDFLARE_WORKER_NAME=xpress-01
CLOUDFLARE_DEPLOY_TIMEOUT_MS=600000
CLOUDFLARE_PREFLIGHT_TIMEOUT_MS=15000
PUBLIC_BASE_URL=https://xpress-01.jaydenlee-dcm.workers.dev
PUBLIC_SITE_BASE_PATH=
PUBLIC_HOSTNAME=
XDG_CONFIG_HOME=/tmp/kairix-wrangler/config
XDG_CACHE_HOME=/tmp/kairix-wrangler/cache
```

Do not change `ADMIN_BASE_URL`, `ADMIN_BIND_IP`, `ADMIN_PORT`, `PREVIEW_BIND_IP`, `PUBLIC_PREVIEW_PORT`, named volumes, `SESSION_SECRET`, or `ENCRYPTION_SECRET`. The private preview remains at its existing LAN URL, such as `http://192.168.0.238:8040/preview/`.

1. Create an account-scoped API token with Workers Scripts Edit and no DNS, R2, Tunnel, or Pages permission unless separately needed.
2. Save the token only in Portainer, apply the values above, then **Pull and redeploy** without removing volumes.
3. Confirm the admin container is healthy and diagnostics show `cloudflare-workers`, Worker `xpress-01`, and configured credentials.
4. Publish once. Preflight lists Workers in the configured account and safely reports whether `xpress-01` already exists; a missing Worker may be created by the authenticated Wrangler deployment.
5. Verify the result shows **Cloudflare Workers**, `xpress-01`, the public URL, and a Version ID when Wrangler returns one.
6. Inspect source and browser network requests. Confirm there are no `/preview/`, `/api/track`, `/api/contact-submissions`, private hostnames, secrets, or requests to the home server.
7. Verify pages, images, downloads, favicon, sitemap, `mailto:`, `tel:`, support, and marketplace links at the domain root.
8. Confirm the private `/preview/` still serves the promoted last-known-good site.

To retain Pages instead, use `DEPLOY_PROVIDER=cloudflare-pages`, set `CLOUDFLARE_PAGES_PROJECT` and `CLOUDFLARE_PAGES_BRANCH`, and follow the Pages section in `CLOUDFLARE_PAGES_RUNBOOK.md`.

Wrangler is installed from the repository lockfile and invoked directly with Node using an argument array and `shell: false`; publishing cannot invoke `npx`. The token is child-environment-only. Workers deployment uses `wrangler deploy --assets <validated-site> --name xpress-01`, disables autoconfiguration, runs outside the validated asset directory, and writes disposable configuration/cache state only below `/tmp`. Upload failure occurs before atomic local-preview promotion, so it cannot replace the last-known-good site.

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
