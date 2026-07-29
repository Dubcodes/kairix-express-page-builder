# Dedicated server security and recovery runbook

This runbook is the production design for one Kairix Page Manager deployment serving one business or trusted client group. The application has roles, but it does not implement tenant-level row isolation. One deployment serves one business or one mutually trusted client group.

A host may run multiple independent client instances only when every instance has its own Compose project, volumes, secrets, ports, hostnames, Worker, users, integrations, audit records, and backups. See [MULTI_INSTANCE_CLIENT_DEPLOYMENT.md](MULTI_INSTANCE_CLIENT_DEPLOYMENT.md).

The public customer website and private Page Manager are separate systems:

```text
Client browser
  -> HTTPS <client-slug>.manager.example.com
  -> Cloudflare Access
  -> Cloudflare Tunnel
  -> http://127.0.0.1:8040
  -> Kairix Page Manager container

Public visitor
  -> https://<client-worker>.<account-subdomain>.workers.dev
  -> Cloudflare Workers Static Assets
  -> validated static files only
```

Clients need only a normal browser and email or the configured identity provider. They do not install Tailscale, a VPN, a certificate, an extension, or an application. Tailscale is optional for owner-only administration.

## 1. Security boundaries

- Do not configure router port forwarding or the consumer-router “DMZ host” feature.
- Do not publish the dedicated server's home IP.
- Bind the Page Manager and preview host ports to `127.0.0.1`.
- Run `cloudflared` directly as a Debian system service. Do not add it to the application stack, use host networking, or grant it Docker access.
- Tunnel only `manager.example.com` to `http://127.0.0.1:8040`.
- Never tunnel the preview, Portainer, SSH, Docker API, SQLite, volumes, backup directory, or raw upload storage.
- Keep Page Manager username/password authentication enabled behind Cloudflare Access.
- Do not trust `Cf-Access-Jwt-Assertion` or other identity headers unless a future implementation cryptographically validates the JWT issuer, audience, signature, and expiry. The current application deliberately does not implement Access SSO.

## 2. Dedicated network policy

Place the device in a dedicated VLAN, isolated firewall zone, separate router network, or equivalent segment. Implement this policy at the router/firewall after verifying interface names and maintaining a console rollback path:

| Direction | Policy |
| --- | --- |
| Internet -> dedicated segment | Deny unsolicited inbound |
| Dedicated segment -> ordinary home LAN | Deny |
| Home LAN -> dedicated segment | Deny by default |
| Owner management device -> dedicated server | Allow only explicitly required SSH/Portainer management |
| Dedicated server -> Internet | Allow required outbound DNS, NTP, Debian repositories, GitHub, Cloudflare API/Tunnel, optional official AliExpress APIs, and approved backup control traffic |
| Everything else | Deny |

Do not copy generic firewall commands into production. Docker manipulates packet-filter rules and published container ports can bypass some host-firewall frontends. Design Docker filtering in the `DOCKER-USER` chain with the network administrator. Before any change, record:

```sh
ip -brief address
ip route
sudo nft list ruleset
sudo iptables -S
sudo iptables -S DOCKER-USER
sudo ss -lntup
```

Apply changes from a local console or with an existing SSH session kept open. The rollback is the saved firewall ruleset restored from the console. Never test an unverified deny policy solely through the connection it may block.

## 3. Debian base installation

1. Install the current Debian stable release with only required packages. Use full-disk encryption when the physical/reboot recovery model supports securely unlocking it; otherwise document the physical-access risk and ensure every off-device backup is independently encrypted.
2. Create a named non-root administrator during installation.
3. Apply updates:

   ```sh
   sudo apt update
   sudo apt full-upgrade
   sudo apt install ca-certificates curl gnupg openssh-server unattended-upgrades apt-listchanges
   ```

4. Configure time synchronisation and verify it:

   ```sh
   timedatectl status
   systemctl status systemd-timesyncd
   ```

5. Enable security updates, then inspect rather than assuming:

   ```sh
   sudo dpkg-reconfigure unattended-upgrades
   systemctl list-timers 'apt-*'
   sudo unattended-upgrade --dry-run --debug
   ```

Monitor `/var/log/unattended-upgrades/` and `/var/log/dpkg.log`. Perform major Debian upgrades manually after a tested backup.

## 4. SSH hardening

First install and test the owner's SSH public key. Keep the current session open and ensure console access exists.

```sh
install -d -m 0700 ~/.ssh
editor ~/.ssh/authorized_keys
chmod 0600 ~/.ssh/authorized_keys
```

Create a drop-in such as `/etc/ssh/sshd_config.d/50-kairix-hardening.conf`:

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers <dedicated-admin-user>
```

Validate before reload:

```sh
sudo sshd -t
sudo systemctl reload ssh
```

Open a second session and confirm key login before closing the first. If validation or login fails, remove the drop-in from the local console, run `sshd -t`, and reload SSH. Restrict SSH at the network firewall to the owner management device/VLAN or optional owner-only Tailscale interface.

## 5. Docker Engine and daemon protection

Install Docker Engine from Docker's official Debian repository, following the current [Docker Debian installation guide](https://docs.docker.com/engine/install/debian/). Do not use the convenience script for production.

Docker access is equivalent to root access. Keep ordinary client accounts out of the `docker` group. The Page Manager has no Docker socket mount.

Verify the daemon exposes only its Unix socket:

```sh
sudo systemctl cat docker
sudo systemctl cat docker.socket
sudo cat /etc/docker/daemon.json 2>/dev/null || true
sudo ss -lntp | grep -E ':(2375|2376)\b' && echo 'UNSAFE: Docker TCP listener found'
sudo ss -lxnp | grep docker.sock
```

The TCP check must return no listener. Do not add `tcp://` hosts to Docker's systemd unit or `daemon.json`. Docker documents that remote daemon access grants extremely powerful control and must not be exposed casually: [Protect the Docker daemon socket](https://docs.docker.com/engine/security/protect-access/).

## 6. Secret files

Create the host directory with group-readable files for container UID/GID `1000:1000`. Confirm the image UID before first production use with `docker run --rm <image> id`.

```sh
sudo install -d -o root -g 1000 -m 0750 /opt/kairix-express-page-builder/secrets
sudo install -o root -g 1000 -m 0440 /dev/null /opt/kairix-express-page-builder/secrets/session-secret
sudo install -o root -g 1000 -m 0440 /dev/null /opt/kairix-express-page-builder/secrets/encryption-secret
sudo install -o root -g 1000 -m 0440 /dev/null /opt/kairix-express-page-builder/secrets/cloudflare-api-token
```

Generate the two application secrets without printing them:

```sh
openssl rand -base64 48 | sudo tee /opt/kairix-express-page-builder/secrets/session-secret >/dev/null
openssl rand -base64 48 | sudo tee /opt/kairix-express-page-builder/secrets/encryption-secret >/dev/null
sudo chown root:1000 /opt/kairix-express-page-builder/secrets/*
sudo chmod 0440 /opt/kairix-express-page-builder/secrets/*
```

Use `sudoedit /opt/kairix-express-page-builder/secrets/cloudflare-api-token` to enter the token without putting it in shell history. Recheck permissions and confirm only byte counts, never contents:

```sh
sudo stat -c '%U:%G %a %n' /opt/kairix-express-page-builder/secrets/*
sudo wc -c /opt/kairix-express-page-builder/secrets/*
```

Mount the files read-only using `docker-compose.secrets.example.yml` with Docker Compose:

```sh
docker compose -f docker-compose.yml -f docker-compose.secrets.example.yml config
docker compose -f docker-compose.yml -f docker-compose.secrets.example.yml up -d --build
```

For a Portainer Git stack, add the same three read-only bind entries from the example to the admin service in the deployment-owned stack configuration. Do not add secret contents to Git or Portainer logs. Set:

```env
SESSION_SECRET_FILE=/run/kairix-secrets/session-secret
ENCRYPTION_SECRET_FILE=/run/kairix-secrets/encryption-secret
CLOUDFLARE_API_TOKEN_FILE=/run/kairix-secrets/cloudflare-api-token
```

Leave the corresponding value variables empty. A configured file takes precedence; missing, unreadable, or empty files fail safely. File-secret values have only trailing CR/LF characters removed.

Static build subprocesses do not inherit ambient secret/token/password variables. Wrangler receives only the resolved Cloudflare account ID/token plus its controlled non-interactive settings. Do not rely on this boundary as permission to place unrelated credentials in the container.

## 7. Page Manager production configuration

These values are for a new dedicated-client instance. They are not an immediate migration instruction for the current live LAN deployment.

> **Lockout warning:** Do not change the current Page Manager to loopback-only or enable secure proxy cookies until the Cloudflare Tunnel, hostname, and Access policy have been created and tested. Doing so prematurely may lock the operator out.

If the current production-mode stack uses a LAN bind, it must explicitly set `ALLOW_INSECURE_ADMIN_BIND=true` before being updated to this hardened revision or startup will be rejected. Preserve its existing URL/proxy/cookie settings during that transitional redeploy. The critical warning is expected. Change to loopback and set the override back to `false` together only after the dedicated Tunnel path is tested.

Use placeholders unique to the client:

```env
NODE_ENV=production
ADMIN_BIND_IP=127.0.0.1
ADMIN_PORT=8040
PREVIEW_BIND_IP=127.0.0.1
PUBLIC_PREVIEW_PORT=4321
ALLOW_INSECURE_ADMIN_BIND=false

ADMIN_BASE_URL=https://<client-slug>.manager.example.com
ADMIN_HOSTNAME=<client-slug>.manager.example.com
TRUST_PROXY=true
COOKIE_SECURE=true
SESSION_LIFETIME_HOURS=12

DEPLOY_PROVIDER=cloudflare-workers
PUBLIC_BASE_URL=https://<client-worker>.<account-subdomain>.workers.dev
PUBLIC_SITE_BASE_PATH=
PUBLIC_HOSTNAME=
CLOUDFLARE_WORKER_NAME=<client-worker>
```

`PORT=8080` remains the internal container port. Compose publishes it only on host loopback at port 8040. Production rejects wildcard/external preview binds and rejects an external admin bind unless the prominent emergency `ALLOW_INSECURE_ADMIN_BIND=true` escape hatch is deliberately used. That override is unsuitable for the normal Tunnel architecture.

The application trusts proxy metadata only from loopback, link-local, or private peers. `ADMIN_HOSTNAME` rejects misdirected hosts. Invitation, password-reset, and AliExpress callback URLs are generated only from `ADMIN_BASE_URL`, never from request `Host`.

## 8. Cloudflare Tunnel on Debian

Install `cloudflared` from Cloudflare's signed stable package repository. Recheck [Cloudflare's package repository](https://pkg.cloudflare.com/) for the current Debian codename before installation.

```sh
sudo install -d -m 0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared <debian-codename> main' \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update
sudo apt install cloudflared
cloudflared --version
```

Create a locally managed named tunnel as the owner:

```sh
cloudflared tunnel login
cloudflared tunnel create kairix-manager
cloudflared tunnel list
cloudflared tunnel route dns kairix-manager manager.example.com
```

Move the generated tunnel credential JSON to root-owned `/etc/cloudflared/` and create `/etc/cloudflared/config.yml`:

```sh
sudo install -d -o root -g root -m 0755 /etc/cloudflared
sudo mv "$HOME/.cloudflared/<tunnel-uuid>.json" /etc/cloudflared/
sudo chown root:root /etc/cloudflared/<tunnel-uuid>.json
sudo chmod 0600 /etc/cloudflared/<tunnel-uuid>.json
sudoedit /etc/cloudflared/config.yml
```

```yaml
tunnel: <tunnel-uuid>
credentials-file: /etc/cloudflared/<tunnel-uuid>.json

ingress:
  - hostname: manager.example.com
    service: http://127.0.0.1:8040
  - service: http_status:404
```

Protect the configuration:

```sh
sudo chown -R root:root /etc/cloudflared
sudo chmod 0755 /etc/cloudflared
sudo chmod 0644 /etc/cloudflared/config.yml
sudo chmod 0600 /etc/cloudflared/*.json
sudo cloudflared --config /etc/cloudflared/config.yml tunnel ingress validate
sudo cloudflared --config /etc/cloudflared/config.yml tunnel run kairix-manager
```

The last command is a foreground test. Stop it with `Ctrl+C` after confirming the route. Install the system service using the explicit config path:

```sh
sudo cloudflared --config /etc/cloudflared/config.yml service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -n 100 --no-pager
```

Cloudflare documents the service workflow at [Run as a service on Linux](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/linux/) and hostname routing at [Tunnel routing](https://developers.cloudflare.com/tunnel/routing/).

Rollback: stop and disable the service, remove the `manager.example.com` tunnel route in Cloudflare, and leave the loopback-only Page Manager running for local owner diagnostics:

```sh
sudo systemctl disable --now cloudflared
```

Do not add preview, SSH, Portainer, or catch-all proxy ingress rules.

## 9. Cloudflare Access

Create a **Self-hosted/private** Access application for exactly `manager.example.com`. Access provides clientless browser access; clients do not install WARP or `cloudflared`.

For initial client onboarding:

1. In Zero Trust, add the **One-time PIN** identity provider if it is not already configured. New 2026 organizations may default to Cloudflare's identity provider instead of OTP.
2. Set a practical application session duration, initially 8 hours or shorter for sensitive clients.
3. Create a client Allow policy whose **Include** selector lists exact approved email addresses. Domains are acceptable only when every account in that domain is trusted.
4. Create a separate owner/admin policy using the owner's stronger identity provider and MFA where available.
5. Do not use **Include Everyone**.
6. Do not create a policy that merely includes the login method “One-time PIN”; Cloudflare warns that this permits every valid email user. Exact email/domain selectors are the authorization boundary.
7. Keep the Page Manager login enabled. Access is the outer gate, not a replacement for application authentication.

Client instructions:

1. Open `https://manager.example.com`.
2. Enter the approved email address at the Cloudflare Access page.
3. Open the email from Cloudflare and enter the one-time PIN.
4. Sign in to Kairix Page Manager with the provided Page Manager username and password.

Cloudflare documents OTP setup and its ten-minute, single-use PIN behavior at [One-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/). See [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/) for deny-by-default policy behavior.

Operational policy:

- Review Access authentication logs and Page Manager audit events.
- Remove a client's email from Access and disable their Page Manager user for emergency revocation.
- Use short sessions for temporary support.
- Test denial with an unapproved email.
- Review policies quarterly and after staff/client changes.
- Never use an Access Bypass policy for the Page Manager hostname.

Cloudflare Access/WAF rate limits supplement, rather than replace, the application limits. Apply conservative edge limits to login, invite/reset acceptance, upload, publish, and integration paths after observing normal traffic. Exclude only health checks that are not publicly routed.

The application does not emit HSTS from its internal HTTP origin. After `manager.example.com` HTTPS and recovery access are proven, enable HSTS at the Cloudflare edge with a short initial maximum age. Increase it gradually. Do not enable `includeSubDomains` or preload unless every affected hostname is permanently HTTPS and the recovery consequences are understood.

Page Manager, invite, and reset documents have a strict CSP, clickjacking protection, MIME sniffing protection, no-referrer policy, restricted browser permissions, and `no-store` for sensitive responses. Generated customer pages retain compatible inline behavior; do not claim a strict generated-site CSP until public inline scripts have been migrated and tested through Workers.

## 10. Portainer

Clients never receive Portainer access. Do not add Portainer to the client-facing Tunnel.

Allow Portainer only from an owner management VLAN/computer or optional owner-only Tailscale. Prefer loopback or a dedicated management interface binding. Do not publish it on the ordinary home LAN or dedicated client segment. Use a unique administrator password and MFA if supported, and keep repository credentials in Portainer rather than the repository.

Verify:

```sh
sudo ss -lntp
sudo docker inspect kairix-page-manager-admin-1 --format '{{json .HostConfig.Binds}}'
sudo docker inspect kairix-page-manager-admin-1 --format '{{.HostConfig.Privileged}} {{.HostConfig.NetworkMode}}'
```

The Page Manager must have no `/var/run/docker.sock`, device mount, privileged mode, or host network.

## 11. Container limits and read-only verification

The stack uses read-only root filesystems, all capabilities dropped, no-new-privileges, PID/CPU/memory limits, size-limited tmpfs, health checks, log rotation, init processes, and graceful shutdown. Runtime writes are limited to:

- `/app/data`
- `/app/uploads`
- `/app/generated-site`
- `/tmp`

Verify on the Linux host:

```sh
docker compose config
docker compose up -d --build
docker compose ps
docker inspect <admin-container> --format 'readonly={{.HostConfig.ReadonlyRootfs}} pids={{.HostConfig.PidsLimit}} memory={{.HostConfig.Memory}} nano_cpus={{.HostConfig.NanoCpus}}'
docker exec <admin-container> id
docker exec <admin-container> sh -c 'touch /app/should-fail'
docker exec <admin-container> sh -c 'for p in /app/data /app/uploads /app/generated-site /tmp; do test -w "$p" || exit 1; done'
```

The root write probe must fail; approved path checks must pass. Then test login, upload, backup, publish, Workers result display, and local preview. If unusually large sites exhaust resources, increase `mem_limit`, `cpus`, or `/tmp` size in small measured steps, redeploy, and repeat the full publish/backup test. Do not remove the limits blindly.

## 12. Backups

The in-app backup contains a consistent SQLite snapshot and non-secret settings. It intentionally excludes uploads, generated output, environment variables, secret files, and decrypted marketplace credentials. Treat it as a short-lived operational snapshot on the encrypted dedicated disk, not an off-device disaster backup. Never copy it to another system without encryption. Uploaded ZIP files are stored and served as downloads; the application never extracts them onto the server filesystem.

Use two layers:

1. Frequent in-app database backups before changes.
2. Encrypted full disaster-recovery backups pulled by a trusted backup server.

The dedicated server must not receive broad write access to the home LAN. The trusted backup system initiates the SSH connection and pulls a stream. Use a dedicated backup SSH key restricted by source address and a root-owned forced-command script. The export procedure should:

1. Gracefully stop the stack for a short maintenance window.
2. Archive the three existing named-volume data directories and `/opt/kairix-express-page-builder/secrets`.
3. Include `/etc/cloudflared/config.yml`, the tunnel UUID reference, stack environment variable names, repository URL, branch, and deployed commit.
4. Exclude or separately encrypt the tunnel credential JSON if it can be recreated.
5. Restart the stack in a trap even if archive streaming fails.

After confirming the actual Compose project name with `docker compose ls` and volume names with `docker volume ls`, install a reviewed root-owned stream script. For the recommended stack name, `/usr/local/sbin/kairix-backup-stream` is:

```sh
#!/bin/sh
set -eu

STACK_DIR=/opt/kairix-express-page-builder/stack
cd "$STACK_DIR"

restart_stack() {
  /usr/bin/docker compose start >&2 || true
}
trap restart_stack EXIT HUP INT TERM

/usr/bin/docker compose stop >&2
/usr/bin/tar --numeric-owner --xattrs --acls -C / -cpf - \
  var/lib/docker/volumes/kairix-page-manager_kairix-data/_data \
  var/lib/docker/volumes/kairix-page-manager_kairix-uploads/_data \
  var/lib/docker/volumes/kairix-page-manager_kairix-generated-site/_data \
  opt/kairix-express-page-builder/secrets \
  etc/cloudflared/config.yml
```

The names above are examples, not assumptions. A wrong volume name makes the backup incomplete. Validate them, run the script once from a console, list the streamed archive on the trusted backup host, and only then assign it as a forced SSH command. Protect it:

```sh
sudo chown root:root /usr/local/sbin/kairix-backup-stream
sudo chmod 0750 /usr/local/sbin/kairix-backup-stream
```

Create a dedicated `kairix-backup` account with no interactive use. Permit only this script in a validated `/etc/sudoers.d/kairix-backup` entry, and force the key command to `sudo /usr/local/sbin/kairix-backup-stream`. Validate sudoers with `sudo visudo -cf /etc/sudoers.d/kairix-backup`. A representative `authorized_keys` prefix is:

```text
from="<trusted-backup-ip>",restrict,command="sudo /usr/local/sbin/kairix-backup-stream" ssh-ed25519 <backup-public-key>
```

Do not give the backup account general Docker-group or unrestricted sudo access.

On the trusted backup server, encrypt the incoming stream immediately with `age`, GPG, or an equivalently reviewed backup tool:

```sh
ssh -i <restricted-backup-key> kairix-backup@<dedicated-server> \
  | age -r <offline-recovery-public-key> \
  > kairix-$(date -u +%Y%m%dT%H%M%SZ).tar.age
sha256sum kairix-*.tar.age > kairix-checksums.txt
```

Do not implement the forced command until the exact Compose project/volume names are confirmed. Test it locally, review it as root-owned non-writable code, and restrict its `authorized_keys` entry with `from=`, `restrict`, and `command=`. Keep at least daily, weekly, and monthly retention appropriate to client data. Store one tested copy off-device and offline/off-account.

### Restore to replacement hardware

1. Isolate the replacement device and install the same supported Debian/Docker baseline.
2. Verify the encrypted backup checksum before decryption.
3. Decrypt into an owner-only staging directory on the trusted backup system; list and inspect paths before transfer.
4. Check that the archive contains only the expected three volume payloads, secret files, and configuration references.
5. Clone the repository at the recorded commit.
6. Create the stack once so Docker creates the existing volume names, then stop it.
7. Back up any newly created target data.
8. Restore each payload into its matching volume without renaming or replacing the volume.
9. Restore secrets as `root:1000` mode `0440`.
10. Restore or recreate the Tunnel credential/config and Access policy.
11. Start the stack, inspect health/logs, run SQLite integrity inspection through an in-app backup, and test login/upload/backup/local publish.
12. Only then enable the Tunnel and test Access with owner and client accounts.
13. Perform one deliberate Workers publish only after the restored data and target are confirmed.

Never restore over a running stack. Never delete the current volumes until the restored system passes and the old encrypted backup remains available.

Exact restore mechanics for a clean replacement:

```sh
# On the trusted backup host
sha256sum -c kairix-checksums.txt
age -d -o kairix-restore.tar kairix-<timestamp>.tar.age
tar -tvf kairix-restore.tar

# On the replacement, first clone the recorded commit and create the same stack/volumes
docker compose create
docker compose stop

# After verifying that the target volumes are new/empty, stream from the trusted host
cat kairix-restore.tar \
  | ssh <owner>@<replacement-server> 'sudo tar --numeric-owner --xattrs --acls -C / -xpf -'

# On the replacement
sudo chown -R root:1000 /opt/kairix-express-page-builder/secrets
sudo chmod 0750 /opt/kairix-express-page-builder/secrets
sudo chmod 0440 /opt/kairix-express-page-builder/secrets/*
docker compose up -d
docker compose ps
```

This is destructive to matching target paths. Use it only on isolated replacement hardware with new/empty target volumes and a verified archive. Delete the plaintext restore tar from the trusted host after the recovery test according to secure-erasure capabilities and policy.

### Disaster-recovery test

Quarterly, restore the latest backup to an isolated replacement/test device with no production Tunnel route or Cloudflare token. Record:

- checksum verification;
- restore duration;
- SQLite and application health;
- user/login test;
- file count and sampled upload hashes;
- local static publish;
- backup creation;
- exact missing configuration;
- operator and date.

Destroy the test copy securely after acceptance.

## 13. Monitoring and maintenance

Weekly:

- `docker compose ps`
- failed health/restarts and bounded Docker logs;
- `journalctl -u cloudflared`;
- Access authentication events;
- Page Manager audit events;
- disk usage/inodes with `df -h` and `df -i`;
- backup completion, size trend, and off-device replication;
- NTP state.

Monthly:

- Debian/Docker/cloudflared updates after backup;
- `npm audit` in a trusted development checkout;
- test client login and revocation;
- review owner/admin accounts and temporary support access;
- verify no listeners on public/LAN addresses, especially 22, Portainer ports, 2375, 2376, 4321, and 8040;
- rotate client passwords when personnel or risk changes justify it.

Rotate Cloudflare and tunnel credentials after suspected exposure, administrator departure, or according to the organization's policy. Update secret files atomically, restart, test preflight, then revoke old credentials.

## 14. Incident response

For suspected Page Manager compromise:

1. Remove/disable the Access application route or affected email policy.
2. Disable affected Page Manager users and revoke sessions.
3. Stop `cloudflared`; do not delete evidence.
4. Preserve logs, database/WAL, audit events, container/image IDs, deployed commit, and Cloudflare audit events.
5. Rotate Page Manager, Cloudflare, Tunnel, marketplace, repository, and backup credentials from a clean device according to exposure.
6. Restore to replacement hardware from a known-good encrypted backup rather than trusting an altered host.
7. Verify the public Worker separately. A stopped Page Manager must not affect the already deployed static site.

TOTP for Page Manager administrators is recommended future work, but is deliberately deferred until enrollment, recovery codes, encrypted storage, clock handling, reset/revocation, audit, and automated tests can be implemented as a complete feature.
