# Portainer Git stack runbook

This runbook deploys the private Kairix Page Manager on a Linux Docker host while publishing only validated static output to Cloudflare Pages. Public visitors must never connect to Portainer, the Page Manager, its local preview, or its volumes. Cloudflare R2 is not used.

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

The database, uploads, backups, and last generated preview survive image replacement and normal stack redeployment. Publish staging and the live preview share one volume so final promotion is an atomic directory rename. Failed/current job directories are removed in the publish `finally` path and stale `publish-*` directories are removed at application startup.

Generated `site/src/data/content.json` and `site/public/uploads` inside the application container are build inputs reconstructed from SQLite and the uploads volume; they do not require separate persistence. Application logs go to container stdout/stderr. Configuration and Cloudflare credentials belong in Portainer environment/secret storage, not in volumes or Git.

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

## 5. Second stage: Cloudflare Pages staging

1. In Cloudflare, create a separate Pages **Direct Upload** staging project. Do not connect it to Git for this workflow.
2. Create an API token restricted to the correct account with **Pages Write** only.
3. In Portainer, add `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT`, `CLOUDFLARE_PAGES_BRANCH`, and `CLOUDFLARE_API_TOKEN` without printing them in logs or committing them.
4. Set `DEPLOY_PROVIDER=cloudflare-pages`.
5. Set `PUBLIC_BASE_URL=https://<staging-project>.pages.dev` and set `PUBLIC_SITE_BASE_PATH` to an empty value.
6. Keep `PUBLIC_HOSTNAME` empty and redeploy the stack.
7. Confirm the admin container is healthy and diagnostics show the expected provider, project, branch, and credential-ready boolean.
8. Publish one test site and verify the returned Cloudflare deployment URL and deployment ID when present.
9. Inspect the public source and browser network requests. Confirm there are no `/api/track`, `/api/contact-submissions`, private hostnames, `/preview/` links, secrets, or requests to the home server.
10. Verify pages, images, downloads, `mailto:`, `tel:`, support, and marketplace links.
11. In Cloudflare, identify the previous deployment and verify the rollback control is available. Perform a staging rollback test before production cutover.

Wrangler is installed from the repository lockfile in the runtime image and invoked directly with Node using an argument array and `shell: false`; publishing cannot invoke `npx`. The token is passed only in the child-process environment. The application validates the existing Pages project before building, bounds child output, applies timeouts/cancellation, removes structured-output files with the job directory, and promotes the local preview only after deployment succeeds. No inbound Cloudflare access is required.

## 6. Production cutover gate

Do not cut production over until all of these are recorded as passing on the Linux host and staging project:

- Images build from the Portainer Git checkout.
- Containers become healthy and the Page Manager runs as non-root.
- Named-volume ownership and write tests pass.
- Local publishing and preview assets work.
- Data survives a controlled stack redeploy.
- Cloudflare staging preflight and Direct Upload work.
- The returned staging URL, public links, and assets work.
- Public output and network requests contain no private API calls or private hostnames.
- Secrets are absent from generated output and redacted logs.
- The Pages token has only the minimum account-level Pages Write permission.
- A staging rollback has been tested.
- The documented Wrangler/Miniflare/Sharp audit finding has either been cleared by an upstream update or explicitly reviewed and accepted for the staging-to-production decision; do not force a dependency override.

After production cutover, public users receive only the Cloudflare Pages static site. Keep the Page Manager, Portainer, SQLite, uploads, backups, generated-site volume, and local preview private.
