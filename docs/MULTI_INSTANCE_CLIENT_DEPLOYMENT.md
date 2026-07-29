# Multi-instance client deployment

This is the owner operating model for running more than one isolated Kairix client instance on a dedicated host.

> One deployment serves one business or one mutually trusted client group.

The application does not provide shared-database tenant isolation. Do not put unrelated clients in one Page Manager, database, Compose project, volume set, secret directory, backup archive, or Worker. Multi-instance means multiple independent single-tenant deployments.

## 1. Isolation inventory

Assign and record these values before provisioning:

| Resource | Required client-specific value |
| --- | --- |
| Client slug | Lowercase DNS-safe identifier, for example `<client-slug>` |
| Compose project | `kairix-<client-slug>` |
| Page Manager hostname | `<client-slug>.manager.example.com` |
| Admin host port | One unused loopback port, for example `<client-admin-port>` |
| Preview host port | One different unused loopback port, for example `<client-preview-port>` |
| Worker | One unique Worker such as `kairix-<client-slug>` |
| Public origin | That Worker's `workers.dev` URL or client-specific custom hostname |
| Volumes | The three volumes created under that Compose project |
| Secrets | A client-specific host directory and unique values |
| Access policy | Exact client hostname and approved client identities |
| Backup destination | `/backups/kairix/<client-slug>/` on the trusted backup system |

For every new instance, use a host layout equivalent to:

```text
/opt/kairix/clients/<client-slug>/
├── compose/
├── env/
├── secrets/
│   ├── session-secret
│   ├── encryption-secret
│   └── cloudflare-api-token
└── backup-metadata/
```

The trusted backup system stores encrypted archives separately:

```text
/backups/kairix/<client-slug>/
```

Do not make one client's directory, volumes, secret files, backup directory, or environment file visible inside another client's container.

## 2. Existing instance compatibility

Do not rename, migrate, recreate, or delete the current live instance's volume definitions:

- `kairix-data:/app/data`
- `kairix-uploads:/app/uploads`
- `kairix-generated-site:/app/generated-site`

Compose applies the project prefix to actual Docker volume names. New client projects get separate actual volumes, such as:

```text
kairix-client-name_kairix-data
kairix-client-name_kairix-uploads
kairix-client-name_kairix-generated-site
```

The suffixes and container mount points remain unchanged. Never explicitly attach another project's actual volume name.

> **Current live deployment warning:** Do not change the current Page Manager to loopback-only or enable secure proxy cookies until the Cloudflare Tunnel, hostname, and Access policy have been created and tested. Doing so prematurely may lock the operator out.

The current working LAN deployment may retain its existing environment while the replacement is prepared. Migrate only through the tested sequence in section 11.

If that production-mode stack is already bound to a LAN address, set `ALLOW_INSECURE_ADMIN_BIND=true` before its first redeploy on this hardened revision, without changing its other network/cookie values. Confirm the critical startup warning and application health. This is an explicit temporary compatibility state, not the final design. At dedicated-host cutover, set the admin bind to `127.0.0.1` and the override to `false` in the same reviewed change.

## 3. Port and hostname allocation

Every Page Manager and preview binds to host loopback. Therefore, each client needs unique host ports. Maintain an owner-only registry:

| Client | Admin port | Preview port | Manager hostname | Worker |
| --- | ---: | ---: | --- | --- |
| `<client-a>` | `8041` | `4321` | `<client-a>.manager.example.com` | `kairix-<client-a>` |
| `<client-b>` | `8042` | `4322` | `<client-b>.manager.example.com` | `kairix-<client-b>` |

Before assigning a port:

```sh
sudo ss -lntp
docker compose ls
```

Record the assignment before deployment. Do not use `0.0.0.0`, `::`, host networking, router port forwarding, or the router's DMZ-host feature. Preview ports are owner-only and never appear in Tunnel ingress.

The environment template for one new client is:

```env
COMPOSE_PROJECT_NAME=kairix-<client-slug>
KAIRIX_SECRETS_DIR=/opt/kairix/clients/<client-slug>/secrets

NODE_ENV=production

ADMIN_BIND_IP=127.0.0.1
ADMIN_PORT=<client-admin-port>
ADMIN_BASE_URL=https://<client-slug>.manager.example.com
ADMIN_HOSTNAME=<client-slug>.manager.example.com

PREVIEW_BIND_IP=127.0.0.1
PUBLIC_PREVIEW_PORT=<client-preview-port>

TRUST_PROXY=true
COOKIE_SECURE=true
ALLOW_INSECURE_ADMIN_BIND=false
SESSION_LIFETIME_HOURS=12

DEPLOY_PROVIDER=cloudflare-workers
PUBLIC_BASE_URL=https://<client-worker>.<account-subdomain>.workers.dev
PUBLIC_SITE_BASE_PATH=
PUBLIC_HOSTNAME=

CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_WORKER_NAME=<client-worker>
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_API_TOKEN_FILE=/run/kairix-secrets/cloudflare-api-token

SESSION_SECRET=
SESSION_SECRET_FILE=/run/kairix-secrets/session-secret
ENCRYPTION_SECRET=
ENCRYPTION_SECRET_FILE=/run/kairix-secrets/encryption-secret
```

Store the environment file owner-only. It contains configuration references and may contain identifiers even when secret values are file-backed.

## 4. Per-client secrets

Generate a different session secret and encryption secret for every client. Never copy either value from an existing instance. Use a separate working user-owned Cloudflare custom token for each instance where operationally possible.

Prepare the directory:

```sh
sudo install -d -o root -g 1000 -m 0750 /opt/kairix/clients/<client-slug>/secrets
sudo install -o root -g 1000 -m 0440 /dev/null /opt/kairix/clients/<client-slug>/secrets/session-secret
sudo install -o root -g 1000 -m 0440 /dev/null /opt/kairix/clients/<client-slug>/secrets/encryption-secret
sudo install -o root -g 1000 -m 0440 /dev/null /opt/kairix/clients/<client-slug>/secrets/cloudflare-api-token
openssl rand -base64 48 | sudo tee /opt/kairix/clients/<client-slug>/secrets/session-secret >/dev/null
openssl rand -base64 48 | sudo tee /opt/kairix/clients/<client-slug>/secrets/encryption-secret >/dev/null
sudo chown root:1000 /opt/kairix/clients/<client-slug>/secrets/*
sudo chmod 0440 /opt/kairix/clients/<client-slug>/secrets/*
```

Enter the Cloudflare token with `sudoedit`, not a command-line argument. Mount only this client's files using `docker-compose.secrets.example.yml` and `KAIRIX_SECRETS_DIR`.

AliExpress credentials, backup encryption recipients/keys, and any future integration secrets must also be client-specific. Do not put secret values in Git, generated sites, ordinary application backup downloads, screenshots, support tickets, or the owner registry.

## 5. Cloudflare Worker isolation

Normally assign exactly one Worker to one client:

```text
kairix-<client-slug>
```

Set `CLOUDFLARE_WORKER_NAME` and `PUBLIC_BASE_URL` from that assignment. Before the first allowed deployment:

1. Compare the recorded client, account, Worker, and public URL.
2. Confirm the Page Manager diagnostics show that exact Worker.
3. Run local publish and generated-output scans.
4. Run provider preflight.
5. Have a second operator review the target when practical.

Use the minimum working permission, currently Workers Scripts Edit for the selected account. Do not add R2, KV, Pages, Routes, Containers, Observability, Workers Builds, DNS, or unrelated permissions.

Cloudflare may scope Workers Scripts Edit at account level rather than to one Worker. If the dashboard cannot constrain a token to one Worker, separate tokens plus application configuration reduce operational mistakes but do not form a cryptographic per-Worker boundary. For stronger isolation, use separate Cloudflare accounts where feasible. Record this limitation and protect owner/Portainer access accordingly.

Verify isolation by checking that:

- every client environment has a different Worker name and token file;
- no environment or backup references another client's Worker;
- provider tests construct only the configured Worker target;
- the Cloudflare audit log shows the expected actor and Worker;
- a staging credential cannot access an unintended account before production use.

To suspend publishing, revoke or remove that client's token and restart only that client instance. This does not remove the already published static site. To suspend the public site, disable its route/custom hostname or archive/delete the Worker only with explicit client-owner approval.

For rollback, use a known-good generated build and the Cloudflare Worker deployment/version rollback facilities after verifying the target. Do not republish another client's archive. Preserve deployment identifiers and the application publish audit event.

## 6. Tunnel routing

The practical initial default is one host-level, non-containerized Cloudflare Tunnel with an explicit route per client:

```yaml
ingress:
  - hostname: <client-a>.manager.example.com
    service: http://127.0.0.1:8041
  - hostname: <client-b>.manager.example.com
    service: http://127.0.0.1:8042
  - service: http_status:404
```

This is simpler to patch and monitor than one tunnel service per client. Its trade-off is a shared host-level routing component: a tunnel credential or configuration compromise can affect several Page Manager routes. Separate tunnels can be adopted for higher-risk clients without changing the application.

For the shared model:

- map every exact hostname to exactly one recorded loopback port;
- keep the final catch-all `http_status:404`;
- never use a wildcard hostname route for Page Managers;
- never route preview, Portainer, SSH, Docker, databases, volumes, or backups;
- keep the configuration root-owned and backed up;
- review and audit every route change;
- validate ingress before reloading `cloudflared`;
- test mismatched Host headers receive HTTP 421.

The application's `ADMIN_HOSTNAME` check is a second boundary. Changing the hostname must require coordinated environment, Tunnel, DNS, and Access changes.

## 7. Cloudflare Access isolation

Create a separate Access application or an equivalently isolated exact-hostname policy for each client Page Manager.

Recommended policy:

- an owner/admin policy may cover all Page Manager hostnames and requires the owner's stronger identity provider and MFA;
- each client policy covers only that client's exact hostname;
- client Include rules list exact approved email addresses, or an intentionally trusted domain;
- deny by default;
- use browser-only one-time email PIN or an approved identity provider;
- avoid Include Everyone, wildcard application hostnames, and Bypass rules;
- keep Access sessions short enough for the client's risk;
- audit Access events and Page Manager audit events.

Removing access requires both removing/disabling the identity in Access and disabling the Page Manager account. Keep Page Manager authentication enabled. The application does not consume Cloudflare identity headers and must not do so unless the signed Access JWT is fully validated.

Changing the browser hostname must not provide access to another client: Access policy, Tunnel mapping, unique host port, and `ADMIN_HOSTNAME` must all agree.

## 8. Resource limits and diagnosis

Default limits are per instance:

| Container | Memory | CPU | PID limit | Writable tmpfs | Docker logs |
| --- | ---: | ---: | ---: | ---: | --- |
| Page Manager | 2 GiB | 2 CPUs | 256 | 512 MiB | 5 files × 10 MiB |
| Preview nginx | 128 MiB | 0.5 CPU | 64 | 16 MiB `/tmp`, 16 MiB cache, 1 MiB run | 5 files × 10 MiB |

These limits leave practical headroom for SQLite, uploads, backups, Astro/Vite builds, image/file handling, and Wrangler. Docker was unavailable during development verification, so reliable idle and peak resident-memory figures have not been measured. Measure them on the Linux staging host:

```sh
docker stats --no-stream
docker compose -p kairix-<client-slug> ps
docker inspect <container> --format 'oom={{.State.OOMKilled}} restarts={{.RestartCount}}'
docker logs --tail 200 <container>
df -h
df -i
```

Signs of exhaustion include OOMKilled, exit 137, repeated health failures, ENOSPC, tmpfs write failures, Wrangler/build termination, or publish timeouts. Increase one client's `mem_limit`, `cpus`, PID limit, or `/tmp` size in measured increments, recreate only that project, and repeat upload, backup, local publish, Workers dry-run, and health checks. Do not remove limits host-wide.

## 9. Per-client backups and restore

An in-app backup belongs to exactly one instance because it is created from that instance's database and configuration. It excludes plaintext secret files, uploads, and full generated-site state, so it is not a complete disaster-recovery archive.

The trusted backup system should pull one encrypted archive per client into:

```text
/backups/kairix/<client-slug>/
```

For each archive:

- stop only that client's Compose project for the volume snapshot;
- include only that project's SQLite/data volume, uploads volume, and generated-site volume;
- include its environment/configuration references and deployed commit;
- back up secret and tunnel recovery material only in a separately controlled encrypted recovery set;
- encrypt before persistent storage;
- use limited pull credentials;
- record checksums;
- retain daily, weekly, and monthly copies according to client policy;
- test restoration quarterly.

Never combine unrelated clients into one application-level archive. A host-wide encrypted infrastructure recovery set may contain multiple separately named client archives, but access controls and restore procedures must preserve the boundaries.

To restore one client:

1. Isolate a clean replacement/test instance.
2. Verify the selected client's checksum and archive manifest.
3. Confirm every path and recorded project name belongs to that client.
4. Create that client's new empty Compose volumes.
5. Stop only that project.
6. Restore each payload into its matching empty volume.
7. Restore or recreate only that client's secret files with `root:1000`, directory `0750`, files `0440`.
8. Start without a production Tunnel route or publishing token.
9. Check SQLite integrity, login, users, uploads, backup inspection, local publish, preview, and audit records.
10. Reattach the exact client hostname and Access policy.
11. Restore the client-specific publishing token and run preflight.
12. Republish only after the generated output and target are confirmed.

Do not overwrite another project's volumes, reuse its ports, or modify its Tunnel route during restoration.

## 10. Sequential client updates

Update clients one at a time by default. Maintain an owner-only registry containing project, compose directory, current commit/image, ports, hostname, Worker, last backup, and health.

For each client:

1. Run `docker compose ls` and select the exact project.
2. Record the running image digest or Git commit and current health.
3. Create and verify that client's in-app and encrypted volume backups.
4. Fetch the tested image/source revision in that client's deployment context.
5. Validate the rendered Compose configuration.
6. Recreate only that client's containers without removing volumes.
7. Wait for health checks.
8. Test Access, Page Manager login, upload retrieval, backup inspection, local publish, preview, and expected hostname rejection.
9. If validation fails, restore only that client's previous image/revision; restore data only if a reviewed migration requires it.
10. Record the result before continuing to the next client.

Representative owner commands must always include the project or its compose directory:

```sh
docker compose -p kairix-<client-slug> --env-file /opt/kairix/clients/<client-slug>/env/production.env config
docker compose -p kairix-<client-slug> --env-file /opt/kairix/clients/<client-slug>/env/production.env up -d --build
docker compose -p kairix-<client-slug> ps
```

Do not run fleet-wide parallel upgrades by default. A failed client upgrade stops the sequence for review but does not stop or recreate other client projects.

## 11. Controlled transition from the live stack

1. Leave the live stack and Worker unchanged.
2. Prepare the isolated Debian host and owner recovery access.
3. Assign the client project, ports, hostname, Worker target, directories, and secrets.
4. Create a final verified backup of the live client data.
5. Restore/copy data only through the documented replacement procedure.
6. Start the dedicated instance on loopback with the Tunnel route still disabled.
7. Test its health locally with the exact Host header.
8. Create the exact-hostname Access application and deny-by-default policy.
9. Start the Tunnel route and test owner Access, client Access, denial, Page Manager login, and logout.
10. Test upload, backup, local publish, preview, and provider preflight without a real deployment.
11. Schedule cutover and make the old instance read-only/offline only after acceptance.

`ALLOW_INSECURE_ADMIN_BIND=true` is an emergency transitional override. It produces a critical warning and must not become the steady-state dedicated configuration. Preview binding has no external-bind override.

## 12. Client offboarding

Offboarding is a reviewed, non-automatic workflow:

1. Disable that client's Cloudflare Access policy.
2. Disable that client's Page Manager Tunnel route.
3. Create and verify a final encrypted client backup.
4. Export any client-owned data required by contract or policy.
5. Stop only that client's Compose project.
6. Retain its volumes for the defined recovery period.
7. Revoke client-specific Cloudflare, application, integration, and backup credentials.
8. Disable or archive the client Worker with explicit approval.
9. Remove client DNS records only after confirmation.
10. Delete client data only after retention expires and explicit approval is recorded.

Do not use `docker compose down -v` during ordinary offboarding. Verify other client projects, routes, Workers, policies, ports, and volumes are unchanged.

## 13. Incident isolation

For one suspected compromised client:

1. Disable that client's Access policy.
2. Disable that client's Tunnel route.
3. Stop only that client's Compose project.
4. Revoke that client's Cloudflare publishing token.
5. Preserve its logs, environment references, volumes, audit records, image IDs, and deployed version.
6. Keep other client projects running.
7. Rebuild the affected instance using clean containers on an isolated replacement.
8. Restore from a verified client-specific backup.
9. Rotate all of that client's secrets and credentials.
10. Validate generated public output and the Worker target before any republish.

The already-published static Worker site can remain online when only the Page Manager is suspected. Disable it separately if its content, Worker credential, or Cloudflare account is implicated.

## 14. Future owner control plane

A future owner-only control plane may manage a client registry, host placement, Compose project names, ports, domains, Worker names, versions, health, backups, upgrades, suspension, and credential rotation.

It must manage independent deployments. It must not combine client products, users, uploads, integrations, audit records, or business data into one shared customer database. It must not require Docker socket access inside any Page Manager container. This control plane is future work and is not implemented by this repository.
