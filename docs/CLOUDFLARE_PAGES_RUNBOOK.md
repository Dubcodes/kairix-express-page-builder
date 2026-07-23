# Cloudflare Pages publishing runbook

For the Git repository, Portainer stack, persistent-volume, and first-deployment procedure, start with [PORTAINER_GIT_STACK_RUNBOOK.md](PORTAINER_GIT_STACK_RUNBOOK.md). This document covers the Cloudflare-specific publishing stage.

## Architecture

The Page Manager, SQLite database, uploads volume, backups, and local preview stay on the private home server. A publish builds a complete static site in a unique staging directory, validates it, and makes an outbound HTTPS Direct Upload to Cloudflare Pages. Public visitors use Cloudflare Pages only. They do not connect to the Page Manager, its preview route, the home network, or a Cloudflare Tunnel to the private server.

Cloudflare mode removes the local analytics and contact-form API calls from the generated site. Use the exported email, telephone, marketplace, or support links for customer contact. R2 is intentionally not part of this version; uploads and downloadable assets are packaged into each Pages deployment.

## 1. Create the Direct Upload project

1. In Cloudflare, open **Workers & Pages** and create a Pages application using **Direct Upload**. Do not connect the repository through Git integration for this workflow.
2. Choose the final project name. It must match `CLOUDFLARE_PAGES_PROJECT` and this application accepts only 1-58 lowercase letters, numbers, and hyphens.
3. Set or record the production branch, normally `main`. Direct Upload production-branch changes are managed through Cloudflare's project API, so settle this value before production.
4. Do not rely on Wrangler to create the project during a Page Manager publish. The Page Manager performs a non-interactive project lookup and stops before building if the project is missing or inaccessible.

Cloudflare's current Direct Upload instructions and limits are documented at [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/). Wrangler uploads currently support up to 20,000 files with a 25 MiB per-file limit; the Page Manager also applies its configured local limits before upload.

## 2. Create the least-privilege token

Create a Cloudflare API token scoped to the correct account with the account permission **Pages Write** only. Do not add DNS, Workers, R2, Account Settings, or API-token permissions. Cloudflare describes the permission at [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) and its token-creation workflow at [Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

Copy the token once into Portainer's secret environment configuration. Never put it in Git, a browser-editable Page Manager setting, a Dockerfile, a Compose file value, screenshots, tickets, or shell history.

## 3. Obtain the account ID

In Cloudflare, open **Workers & Pages** and copy the account ID from **Account details**, or use the account overview menu. See [Find account and zone IDs](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/). The value is a 32-character hexadecimal ID and is not the zone ID.

## 4. Portainer production variables

Set these values on the `admin` service or Portainer stack. Values below are descriptions, not real credentials.

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DEPLOY_PROVIDER` | `cloudflare-pages` |
| `CLOUDFLARE_ACCOUNT_ID` | `<32-character-account-id>` |
| `CLOUDFLARE_PAGES_PROJECT` | `<existing-direct-upload-project>` |
| `CLOUDFLARE_PAGES_BRANCH` | `main` or the project's actual production branch |
| `CLOUDFLARE_API_TOKEN` | `<pages-write-token>` |
| `CLOUDFLARE_DEPLOY_TIMEOUT_MS` | `600000` initially |
| `CLOUDFLARE_PREFLIGHT_TIMEOUT_MS` | `15000` initially |
| `PUBLIC_BASE_URL` | `https://<public-pages-custom-domain>` |
| `PUBLIC_SITE_BASE_PATH` | empty value, not `/preview` |
| `ADMIN_BASE_URL` | `https://<private-admin-hostname>` |
| `ADMIN_HOSTNAME` | `<private-admin-hostname>` when host guarding is wanted |
| `PUBLIC_HOSTNAME` | empty; Pages must not route public traffic to this server |
| `TRUST_PROXY` | `true` only when the private admin is behind a trusted LAN HTTPS reverse proxy |
| `COOKIE_SECURE` | `true` for HTTPS admin access |
| `SESSION_SECRET` | `<different-random-value-at-least-32-characters>` |
| `ENCRYPTION_SECRET` | `<different-random-value-at-least-32-characters>` |
| `ENABLE_SAMPLE_DATA_TOOLS` | `false` |
| `PUBLISH_MAX_FILES` | `20000` or lower |
| `PUBLISH_MAX_TOTAL_MB` | operational limit, default `500` |
| `PUBLISH_MAX_FILE_MB` | `25` to align exactly with the current Pages per-file limit |

Compose supplies `GENERATED_SITE_DIR=/app/generated-site/current` and `PUBLIC_BUILD_TEMP_DIR=/app/generated-site/.publish-staging`. Both are on the same volume so the validated local preview can be promoted by directory rename. Do not point either path outside `/app` or at a symlink.

The `public-preview` port is bound to `PREVIEW_BIND_IP`, which defaults to `127.0.0.1`. Keep the default unless a LAN-only standalone preview is specifically required. It is an operator preview, not the production website.

## 5. Test local publishing first

1. Set `DEPLOY_PROVIDER=local`.
2. For the built-in preview, set `PUBLIC_BASE_URL` to the Page Manager origin and `PUBLIC_SITE_BASE_PATH=/preview`.
3. Restart the stack, save representative content, and use **Publish**.
4. Confirm the UI says **Local preview**, then check Home, category, product, downloads, version-history, support, images, and downloadable files.
5. Run `npm test`, `npm run scan:public`, and `npm run check:links` in a development checkout.

Local mode requires no Cloudflare variables and does not contact Cloudflare.

## 6. Switch to Cloudflare

1. Create an in-app backup and confirm it can be inspected.
2. Add the Cloudflare variables, change `DEPLOY_PROVIDER=cloudflare-pages`, set `PUBLIC_SITE_BASE_PATH` to an empty value, and set the final HTTPS `PUBLIC_BASE_URL`.
3. Leave `PUBLIC_HOSTNAME` empty and restart the admin container.
4. Confirm `/healthz` is healthy and **Advanced diagnostics** reports `cloudflare-pages`, the correct project/branch, no production-safety issues, and only a boolean credential-ready state. The API token is never returned.
5. Publish once. Do not double-submit or automatically retry a timeout.

A successful publish shows **Cloudflare production**, a public URL, deployment ID when returned by Wrangler, file count, byte count, and build duration. Audit events record the job ID, start/build/deploy phases, and durations without credentials or raw Wrangler output.

## 7. Diagnose failures safely

- Configuration errors happen before the expensive build. Check account-ID format, project name, branch, root base path, and required variables.
- `CLOUDFLARE_AUTH_FAILED`: token/account mismatch or missing Pages Write access.
- `CLOUDFLARE_PROJECT_NOT_FOUND`: project is absent or inaccessible. Create/fix it in Cloudflare; the app will not prompt or create one.
- `CLOUDFLARE_PREFLIGHT_TIMEOUT` or network failure: no upload started; check outbound HTTPS/DNS and retry deliberately.
- `CLOUDFLARE_DEPLOY_TIMEOUT`: an upload may have completed. Inspect Cloudflare deployments before any retry.
- `SITE_VALIDATION_FAILED`: inspect the server's redacted diagnostic and remove the forbidden file, symlink, oversized asset, unsafe ZIP entry, or sensitive material.
- `PUBLISH_IN_PROGRESS`: wait for the active single-process job. The server-side lock is authoritative.

Wrangler stdout/stderr are bounded and never sent raw to the browser. The API token is supplied only in the child environment and is redacted from controlled errors.

## 8. Roll back

In Cloudflare, open the Pages project, select **Deployments**, open the actions menu for an earlier successful production deployment, and choose **Rollback to this deployment**. Cloudflare documents this at [Pages rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/). Preview deployments are not rollback targets.

The local generated preview is independent of a Cloudflare rollback. A later Page Manager publish creates a new production deployment; it does not erase Cloudflare's previous successful deployment.

## 9. Rotate or disable publishing

To rotate the token:

1. Create a new Pages Write token.
2. Replace only `CLOUDFLARE_API_TOKEN` in Portainer and restart the admin container.
3. Confirm preflight with one deliberate publish.
4. Revoke the old token in Cloudflare.

To disable Cloudflare publishing immediately, set `DEPLOY_PROVIDER=local`, remove `CLOUDFLARE_API_TOKEN` from Portainer, and restart the admin container. Revoking the token in Cloudflare provides immediate external revocation. Existing Pages content remains online until rolled back, replaced, or the Pages project/domain is disabled.

## 10. Pre-production checklist

- [ ] Direct Upload Pages project exists; project name and production branch are confirmed.
- [ ] Token has account-scoped Pages Write only and is stored only in Portainer.
- [ ] `SESSION_SECRET` and `ENCRYPTION_SECRET` are different random values of at least 32 characters.
- [ ] Admin uses HTTPS, secure cookies, trusted proxy configuration, and access controls.
- [ ] `PUBLIC_BASE_URL` is the final Pages/custom-domain HTTPS origin.
- [ ] `PUBLIC_SITE_BASE_PATH` and `PUBLIC_HOSTNAME` are empty.
- [ ] Local preview remains private and its port is bound to localhost only.
- [ ] Backup was created and integrity inspection says `verified`.
- [ ] Local-mode publish and root/subpath static builds pass link and secret scans.
- [ ] Cloudflare publish UI identifies production and returns a deployment URL/ID.
- [ ] Cloudflare Pages site works while the Page Manager and home internet route are unavailable.
- [ ] Rollback and token-rotation operators know this runbook.
- [ ] No R2 variables are enabled; assets remain packaged with the static deployment.
