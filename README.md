# Kairix Express Page Builder

A local demo of a low-cost static product support portal builder for AliExpress/Alibaba-style sellers. Kairix Express Page Builder is the underlying tool/project name. Sellers use the admin interface as their Page Manager, while customers see the generated public support portal. It is not a store, cart, checkout, or marketplace API integration.

## What v1 Does

- First-run setup creates the business/store profile and first Admin user.
- The admin remains clearly identified as Kairix Page Manager while customer branding is applied only to generated public sites.
- Admin login uses hashed passwords and HTTP-only session cookies.
- Roles are modeled for Admin, Publisher, Editor, File Manager, Analytics Viewer, and Read Only.
- Admins can create team invites, temporary support access links, approval-required users, and password reset links.
- Admin can create categories, products, media files, downloads, versions, and Software Bundles.
- Products can track publish state, stock display, related products, Software Bundles, and latest linked downloads.
- Software Bundles can auto-generate ZIP files during publish when local files are attached.
- Optional contact-form submissions and local analytics work only in private local-preview mode; Cloudflare output has no private runtime API dependency.
- QR codes are generated during publish for product support URLs and marketplace links.
- Publish exports structured content to Astro and builds static files into `generated-site`.
- Public pages are static and do not need the SQLite database at runtime.
- The Page Manager includes CSRF protection for authenticated write requests, audit events for important admin actions, and basic local analytics.
- Local preview, Cloudflare Pages Direct Upload, and Cloudflare Workers Static Assets deploy providers are available. Cloudflare R2 remains intentionally inactive.

## Project Structure

```text
admin/          Express admin/backend app
site/           Astro static website templates
data/           SQLite database target
uploads/        Local uploaded files
generated-site/ Astro build output
data/backups/   Manual backup ZIP output
docker-compose.yml
.env.example
```

## Local Windows Development

From `J:\projects\express-page-builder`:

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Open the Page Manager admin at [http://localhost:8080](http://localhost:8080).

The first visit shows setup. Create the first Admin account, then log in.

To serve the generated static site locally after publishing:

```powershell
npm run publish
npm run preview --workspace site
```

Astro preview runs on [http://localhost:4321](http://localhost:4321). The admin also serves the last generated site at `/preview/`.

The generated public site is base-path aware. Local Page Manager preview uses:

```env
PUBLIC_SITE_BASE_PATH=/preview
```

That keeps generated links such as Home, Downloads, Support, product pages, category pages, and version-history pages under `/preview/` when served by the admin app. For Cloudflare Pages or Workers Static Assets at the domain root, use an empty value:

```env
PUBLIC_SITE_BASE_PATH=
```

If the final static site is deployed under a subpath, set `PUBLIC_SITE_BASE_PATH` to that subpath.

## Typical Admin Workflow

1. Complete first-run setup.
2. Set store name, logo, theme, support details, and marketplace label.
3. Create a category.
4. Upload product images inside the product editor, or upload shared media files from Settings -> Media Library.
5. Create a download object.
6. Add at least one version and mark it latest.
7. Create a Software Bundle and link the download.
8. Create a product, attach images, link the Software Bundle, set stock display, and set publish state to Published.
9. Click Publish.
10. Open the generated static preview.

The Page Manager does not write raw HTML pages. It saves structured content, and Astro templates generate consistent public customer-facing support pages. The public site remains branded as the seller/business name only, not as "Page Manager".

### Product states

- Draft: hidden from the customer site preview.
- Not ready: hidden from the customer site preview and useful for incomplete/review-needed products.
- Published: visible on the customer site preview after the site is published.
- Archived: hidden from normal admin lists and hidden from the customer site preview until restored.

## Client-ready deployment checklist

This project supports a hardened single-business deployment. One deployment serves one business or one mutually trusted client group. Multiple independent clients use separate Compose projects, volumes, secrets, users, backups, hostnames, and Workers; the application is not a shared multi-tenant service.

- Put the dedicated Page Manager hostname behind Cloudflare Access and Tunnel before sharing admin access.
- For explicitly non-production local LAN testing only, use `COOKIE_SECURE=false`, `TRUST_PROXY=false`, and the documented insecure-bind override.
- Dedicated production uses loopback binds, `COOKIE_SECURE=true`, and `TRUST_PROXY=true` behind host `cloudflared`.
- Set real, different `SESSION_SECRET` and `ENCRYPTION_SECRET` values.
- Keep `ENABLE_SAMPLE_DATA_TOOLS=false` before sharing with clients.
- Publish before sharing `/preview/`; the preview shows the last successfully published customer site.
- Share `/preview/` for viewing only.
- Give clients normal browser-only HTTPS access; do not require client VPN/Tailscale software.
- Create a limited Page Manager user and independently allow the client's exact email in Cloudflare Access.
- For client editing tests, prefer `Editor` or `Publisher`. Do not give `Admin` unless necessary.
- `File Manager` can upload files, `Publisher` can publish, and `Read Only` can view but not edit.
- Back up Docker volumes before upgrades. The in-app backup is not a complete Docker volume backup.
- Upload only trusted files.
- Do not use real customer data in early demos unless the client approves.

Before sharing generated output, run:

```powershell
npm run check
npm run scan:public
```

## GitHub Push Workflow

```powershell
git init
git add .
git commit -m "Initial Kairix Express Page Builder demo"
git branch -M main
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```

Do not commit `.env`, SQLite files, uploaded customer files, or generated build output.

## Docker Compose / Portainer Git Stack

The compose stack runs the Page Manager admin/backend plus an optional nginx `public-preview` service for the generated static site. The preview service builds a small nginx image from `docker/nginx-preview.Dockerfile`, so no host bind mount is required for the nginx config.

Ports:

- Page Manager admin/backend: `${ADMIN_BIND_IP:-127.0.0.1}:${ADMIN_PORT:-8040}` -> container `8080`
- Static preview: `${PREVIEW_BIND_IP:-127.0.0.1}:${PUBLIC_PREVIEW_PORT:-4321}` -> container `8080`

Both ports are loopback-only in production. `cloudflared` runs directly on the dedicated Debian host and forwards only the client's exact manager hostname to that client's loopback admin port. Do not port-forward either service, expose the preview, or add cloudflared to the application stack.

Volumes:

- `kairix-data` stores SQLite.
- `kairix-uploads` stores local uploaded files.
- `kairix-generated-site` stores the generated static website.
- Manual backup ZIPs are written under `data/backups/` inside `kairix-data`.

### Local preview and Cloudflare production

Local mode (`DEPLOY_PROVIDER=local`) updates the private generated-site preview. Use `PUBLIC_SITE_BASE_PATH=/preview` for the built-in Page Manager preview. Compose binds the optional nginx preview to `127.0.0.1` so it is not a production public endpoint.

Cloudflare Pages mode (`DEPLOY_PROVIDER=cloudflare-pages`) uploads the validated root site to an existing Direct Upload project. Cloudflare Workers mode (`DEPLOY_PROVIDER=cloudflare-workers`) deploys the same validated root site as official Workers Static Assets using `wrangler deploy --assets`. Both use the exact-pinned installed Wrangler CLI non-interactively, authenticate only through server environment variables, and atomically update the private last-known-good preview only after deployment succeeds. Set `PUBLIC_SITE_BASE_PATH=` and leave `PUBLIC_HOSTNAME=` empty.

For the current Worker:

```env
DEPLOY_PROVIDER=cloudflare-workers
CLOUDFLARE_WORKER_NAME=xpress-01
PUBLIC_BASE_URL=https://xpress-01.jaydenlee-dcm.workers.dev
PUBLIC_SITE_BASE_PATH=
PUBLIC_HOSTNAME=
```

The Workers publishing provider does not need Git integration, Wrangler login, a Docker socket, inbound Cloudflare access, or a Tunnel. The separate client-facing Page Manager architecture uses its own outbound host `cloudflared` service.

The dedicated-server production model exposes the authenticated Page Manager through Cloudflare Access and an outbound-only Tunnel while keeping its Docker host binding on loopback. The Page Manager retains its own login. Set `TRUST_PROXY=true`, `COOKIE_SECURE=true`, `ADMIN_HOSTNAME` to the exact manager hostname, and `ADMIN_BASE_URL` to its final HTTPS origin. Production secrets can be supplied through read-only files and must be different random values of at least 32 characters.

The Git-to-Portainer deployment and staged rollout are in [docs/PORTAINER_GIT_STACK_RUNBOOK.md](docs/PORTAINER_GIT_STACK_RUNBOOK.md). The Cloudflare project/token setup, diagnostics, rollback, rotation, emergency-disable steps, and checklist are in [docs/CLOUDFLARE_PAGES_RUNBOOK.md](docs/CLOUDFLARE_PAGES_RUNBOOK.md). Security/reliability findings and remaining risks are in [docs/SECURITY_RELIABILITY_AUDIT.md](docs/SECURITY_RELIABILITY_AUDIT.md).
Dedicated Debian, VLAN/firewall policy, Cloudflare Tunnel/Access, secret files, backup/restore, monitoring, and incident response are in [docs/DEDICATED_SERVER_SECURITY_RUNBOOK.md](docs/DEDICATED_SERVER_SECURITY_RUNBOOK.md).
Repeatable single-tenant client instance naming, ports, isolation, updates, restoration, offboarding, and incident isolation are in [docs/MULTI_INSTANCE_CLIENT_DEPLOYMENT.md](docs/MULTI_INSTANCE_CLIENT_DEPLOYMENT.md).

> **Current live deployment warning:** Do not change the current Page Manager to loopback-only or enable secure proxy cookies until its Cloudflare Tunnel, exact hostname, and Access policy have been created and tested. Doing so prematurely may lock the operator out. The hardened values in `.env.example` are defaults for new dedicated-client instances, not an instruction to mutate the existing live stack immediately.

Do not expose Portainer publicly. Keep `ENABLE_SAMPLE_DATA_TOOLS=false` in production. For a clean demo rebuild, create an in-app backup, use a separate stack name/volumes, and never edit SQLite by hand.

### Temporary client demo via Portainer

1. Push the repo to GitHub.
2. In Portainer, create a Git stack using this repository.
3. Use `docker-compose.yml`.
4. Set the required environment variables from `.env.example`.
5. Deploy.
6. Open the Page Manager admin URL.
7. Complete first-run setup.
8. Create sample/demo content manually, import safe demo content, or temporarily enable `ENABLE_SAMPLE_DATA_TOOLS=true` and use "Add demo sample batch".
9. Click Publish.
10. Test `/preview/` on the admin URL or localhost-only `public-preview` as an operator.
11. In Cloudflare mode, share only the Cloudflare Pages, Workers, or custom-domain URL with clients.
12. If sharing admin access, create a temporary demo user and remove or disable it afterward.

Warnings:

- Do not use default or placeholder secrets.
- Do not expose the admin without HTTPS.
- Do not use real client/customer data in a demo.
- The in-app backup is not a full Docker volume backup unless explicitly extended. Back up Docker volumes for SQLite, uploads, generated site output, and manual backup ZIPs.

## Backups

Use Settings -> Import / Export / Backups to create a manual backup ZIP before larger imports or upgrades. Back up these volumes before upgrades:

- SQLite database: `data/kairix.sqlite`
- Manual backups: `data/backups/`
- Uploads: `uploads/`
- Generated site: `generated-site/` if you want a copy of the last build

The generated site can always be rebuilt from the database and uploads.

CSV exports for products, downloads, and Software Bundles are available from the same Settings area.

## Client Update Discipline

Before updating a client stack:

1. Create an in-app backup.
2. Back up Docker volumes for SQLite, uploads, generated site output, and backups.
3. Test the change on a demo stack first.
4. Tag known-good releases when appropriate:

```powershell
git tag v0.1-client-demo
git push origin v0.1-client-demo
```

Do not push untested `main` changes directly to a real client deployment.

After redeploying, run a quick smoke test:

- Log in.
- Create or edit a product.
- Upload an image.
- Publish.
- Open the preview.
- Open a product page.
- Open Support.
- Test a missing preview route.

## Marketplace Integrations

Settings -> Marketplace Integrations includes an AliExpress connection foundation. App secrets and tokens are stored encrypted with `ENCRYPTION_SECRET` and are never exported to the generated public support portal. Configure official AliExpress/Open Platform OAuth and signed API endpoints before attempting to connect or fetch product candidates.

## Security Notes

- No public admin registration is available after setup.
- Invite links are random, expire, and can be used once.
- Temporary support access links can expire the resulting support account after a configured number of hours.
- Password reset links are random, expire, and can be used once.
- Passwords are hashed with bcrypt.
- Session cookies are HTTP-only and SameSite=Lax.
- Session lifetime is configurable with a 12-hour production default.
- Authenticated write requests require a CSRF token.
- User, invite, login, product, bundle, settings, and publish actions are written to an audit log.
- Uploads are stored outside executable code paths.
- Production rejects external/wildcard preview binding and requires an explicit critical-warning override for a non-loopback admin binding.
- Runtime containers use read-only roots, limited tmpfs, resource limits, dropped capabilities, and log rotation.
- `SESSION_SECRET_FILE`, `ENCRYPTION_SECRET_FILE`, and `CLOUDFLARE_API_TOKEN_FILE` take precedence over legacy value variables.
- The public site is generated static output and has no database credentials.
- `.env.example` documents variable names only; real secrets must stay in private environment/Portainer secret configuration.

## Cloudflare deployment and deferred R2

Cloudflare Pages Direct Upload is implemented through `CloudflarePagesDeployProvider`. Workers Static Assets is implemented through `CloudflareWorkersDeployProvider` with the official `wrangler deploy --assets <validated-directory> --name <worker>` mechanism. Wrangler is exact-pinned as a runtime dependency; publish never downloads a CLI dynamically. Cloudflare credentials are server environment values and never browser-editable settings.

Cloudflare R2 is deliberately deferred. `R2StorageProvider` is an inactive placeholder; uploads, downloads, and generated Software Bundle ZIPs continue to be packaged into the validated static deployment.
