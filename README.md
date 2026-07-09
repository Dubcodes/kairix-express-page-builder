# Kairix Express Page Builder

A local demo of a low-cost static product support portal builder for AliExpress/Alibaba-style sellers. Kairix Express Page Builder is the underlying tool/project name. Sellers use the admin interface as their Page Manager, while customers see the generated public support portal. It is not a store, cart, checkout, or marketplace API integration.

## What v1 Does

- First-run setup creates the business/store profile and first Admin user.
- The admin header uses the configured business name, for example `ABC Electronics Page Manager`.
- Admin login uses hashed passwords and HTTP-only session cookies.
- Roles are modeled for Admin, Publisher, Editor, File Manager, Analytics Viewer, and Read Only.
- Admin can create categories, products, files, download objects, versions, and support packs.
- Products can link support packs and render latest linked downloads on the product page.
- QR codes are generated during publish for product support URLs and marketplace links.
- Publish exports structured content to Astro and builds static files into `generated-site`.
- Public pages are static and do not need the SQLite database at runtime.
- Local storage and deploy providers exist now, with Cloudflare R2/Pages placeholders for later.

## Project Structure

```text
admin/          Express admin/backend app
site/           Astro static website templates
data/           SQLite database target
uploads/        Local uploaded files
generated-site/ Astro build output
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
7. Create a support pack and link the download object.
8. Create a product, attach images, link the support pack, and set status to Published.
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

1. Push the repo to GitHub.
2. In Portainer, create a Git stack using this repository.
3. Use `docker-compose.yml`.
4. Configure stack environment variables from `.env.example`.
5. Deploy.

Ports:

- Page Manager admin/backend: `8080`
- Static preview: `4321`

Volumes:

- `kairix-data` stores SQLite.
- `kairix-uploads` stores local uploaded files.
- `kairix-generated-site` stores the generated static website.

In production, put the Page Manager admin behind HTTPS using Cloudflare Tunnel, a reverse proxy, or another TLS proxy. Set:

```env
TRUST_PROXY=true
COOKIE_SECURE=true
ADMIN_BASE_URL=https://admin.example.com
PUBLIC_BASE_URL=https://support.example.com
```

## Backups

Back up these volumes before upgrades:

- SQLite database: `data/kairix.sqlite`
- Uploads: `uploads/`
- Generated site: `generated-site/` if you want a copy of the last build

The generated site can always be rebuilt from the database and uploads.

## Security Notes

- No public admin registration is available after setup.
- Invite links are random, expire, and can be used once.
- Passwords are hashed with bcrypt.
- Session cookies are HTTP-only and SameSite=Lax.
- Uploads are stored outside executable code paths.
- The public site is generated static output and has no database credentials.
- `.env.example` documents secrets and Cloudflare placeholders; real secrets must stay in `.env`.

## Cloudflare Future Notes

The v1 publish flow is local only. It is structured so later iterations can add:

- Cloudflare Pages Direct Upload using `CloudflarePagesDeployProvider`.
- Cloudflare R2 download storage using `R2StorageProvider`.
- Settings placeholders for account IDs, project name, API token, bucket, access key, and secret key.

Later generated static files from `generated-site` can be uploaded to Cloudflare Pages, and downloads can move from local filesystem uploads to R2 without changing the public template model.
