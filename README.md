# Kairix Express Page Builder

A local demo of a low-cost static product support portal builder for AliExpress/Alibaba-style sellers. Kairix Express Page Builder is the underlying tool/project name. Sellers use the admin interface as their Page Manager, while customers see the generated public support portal. It is not a store, cart, checkout, or marketplace API integration.

## What v1 Does

- First-run setup creates the business/store profile and first Admin user.
- The admin header uses the configured business name, for example `ABC Electronics Page Manager`.
- Admin login uses hashed passwords and HTTP-only session cookies.
- Roles are modeled for Admin, Publisher, Editor, File Manager, Analytics Viewer, and Read Only.
- Admins can create team invites, temporary support access links, approval-required users, and password reset links.
- Admin can create categories, products, media files, downloads, versions, and Software Bundles.
- Products can track publish state, stock display, related products, Software Bundles, and latest linked downloads.
- Software Bundles can auto-generate ZIP files during publish when local files are attached.
- Optional public contact form submissions are stored in the Page Manager, not in the static public site.
- QR codes are generated during publish for product support URLs and marketplace links.
- Publish exports structured content to Astro and builds static files into `generated-site`.
- Public pages are static and do not need the SQLite database at runtime.
- The Page Manager includes CSRF protection for authenticated write requests, audit events for important admin actions, and basic local analytics.
- Local storage and deploy providers exist now, with Cloudflare R2/Pages placeholders for later.

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

That keeps generated links such as Home, Downloads, Support, product pages, category pages, and version-history pages under `/preview/` when served by the admin app. For a future Cloudflare Pages root deployment, use an empty value:

```env
PUBLIC_SITE_BASE_PATH=
```

If the final static site is deployed under a subpath, set `PUBLIC_SITE_BASE_PATH` to that subpath.

## Typical Admin Workflow

1. Complete first-run setup.
2. Set store name, logo, theme, support details, and marketplace label.
3. Create a category.
4. Upload product images and any downloadable files.
5. Create a download object.
6. Add at least one version and mark it latest.
7. Create a Software Bundle and link the download.
8. Create a product, attach images, link the Software Bundle, set stock display, and set publish state to Published.
9. Click Publish.
10. Open the generated static preview.

The Page Manager does not write raw HTML pages. It saves structured content, and Astro templates generate consistent public customer-facing support pages. The public site remains branded as the seller/business name only, not as "Page Manager".

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

The compose stack runs the Page Manager admin/backend plus an optional nginx `public-preview` service for the generated static site.

Ports:

- Page Manager admin/backend: `${ADMIN_PORT:-8080}` -> container `8080`
- Static preview: `${PUBLIC_PREVIEW_PORT:-4321}` -> container `80`

Volumes:

- `kairix-data` stores SQLite.
- `kairix-uploads` stores local uploaded files.
- `kairix-generated-site` stores the generated static website.
- Manual backup ZIPs are written under `data/backups/` inside `kairix-data`.

### Preview URL modes

Mode A: single admin URL with built-in preview

- Expose only the admin service.
- Public preview is served by the admin at `/preview/`.
- Set `PUBLIC_SITE_BASE_PATH=/preview`.
- Set `PUBLIC_BASE_URL` to the admin hostname origin.

Mode B: separate static public preview URL

- Expose `public-preview` separately.
- Set `PUBLIC_SITE_BASE_PATH=` for a root static preview, or `/preview` if the static preview should also live under `/preview/`.
- `docker-compose.yml` intentionally uses `${PUBLIC_SITE_BASE_PATH-/preview}` so an empty value is preserved. Do not change it to `${PUBLIC_SITE_BASE_PATH:-/preview}` unless you want empty values to fall back to `/preview`.
- The nginx preview config serves both `/` and `/preview/`, including `/preview/_astro/...` and `/preview/uploads/...`.

In production, put the Page Manager admin behind HTTPS using Cloudflare Tunnel, a reverse proxy, or another TLS proxy. Set:

```env
NODE_ENV=production
TRUST_PROXY=true
COOKIE_SECURE=true
ADMIN_BASE_URL=https://your-admin-demo.example.com
PUBLIC_BASE_URL=https://your-admin-demo.example.com
PUBLIC_SITE_BASE_PATH=/preview
SESSION_SECRET=replace-with-long-random-secret
ENCRYPTION_SECRET=replace-with-different-long-random-secret
```

`SESSION_SECRET` and `ENCRYPTION_SECRET` are required in production, must be different, and must not use placeholder values. The app fails fast if production secrets are missing or still set to known defaults.

### Temporary client demo via Portainer

1. Push the repo to GitHub.
2. In Portainer, create a Git stack using this repository.
3. Use `docker-compose.yml`.
4. Set the required environment variables from `.env.example`.
5. Deploy.
6. Open the Page Manager admin URL.
7. Complete first-run setup.
8. Create sample/demo content or import safe demo content.
9. Click Publish.
10. Test `/preview/` on the admin URL, or the public-preview URL if exposing it separately.
11. Share only the public preview URL with clients unless they need admin access.
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

## Marketplace Integrations

Settings -> Marketplace Integrations includes an AliExpress connection foundation. App secrets and tokens are stored encrypted with `ENCRYPTION_SECRET` and are never exported to the generated public support portal. Configure official AliExpress/Open Platform OAuth and signed API endpoints before attempting to connect or fetch product candidates.

## Security Notes

- No public admin registration is available after setup.
- Invite links are random, expire, and can be used once.
- Temporary support access links can expire the resulting support account after a configured number of hours.
- Password reset links are random, expire, and can be used once.
- Passwords are hashed with bcrypt.
- Session cookies are HTTP-only and SameSite=Lax.
- Authenticated write requests require a CSRF token.
- User, invite, login, product, bundle, settings, and publish actions are written to an audit log.
- Uploads are stored outside executable code paths.
- The public site is generated static output and has no database credentials.
- `.env.example` documents secrets and Cloudflare placeholders; real secrets must stay in `.env`.

## Cloudflare Future Notes

The v1 publish flow is local only. It is structured so later iterations can add:

- Cloudflare Pages Direct Upload using `CloudflarePagesDeployProvider`.
- Cloudflare R2 download storage using `R2StorageProvider`.
- Settings placeholders for account IDs, project name, API token, bucket, access key, and secret key.

Later generated static files from `generated-site` can be uploaded to Cloudflare Pages, and downloads can move from local filesystem uploads to R2 without changing the public template model.
