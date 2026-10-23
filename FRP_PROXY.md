# FRP proxy gateways

The Panel manages individual TCP and UDP Store proxies on an existing FRPC. Run FRPS on the VPS and a separate FRPC for each node/gateway pair. Install and start them yourself using the guide below. The Panel does not install software, restart services, replace FRPC configuration, or call `/api/reload`.

FRP v0.68.0 introduced the required Store API. The isolated runtime acceptance in `.local/frp-runtime-contract.md` verified that release. Official latest release observed during implementation was v0.71.1. Use a compatible version on both ends. The backend probes authenticated Store capability and rejects older or disabled Store APIs explicitly.

Official references:
- https://github.com/fatedier/frp/releases/tag/v0.68.0
- https://github.com/fatedier/frp/blob/v0.68.0/client/http/controller.go
- https://github.com/fatedier/frp/blob/v0.68.0/client/http/model/proxy_definition.go
- https://github.com/fatedier/frp/blob/v0.68.0/client/http/model/types.go

## Guided setup

1. Create a gateway under administrator integrations. Enter the VPS FRPS host/control port, public hostname, token, and public port pool. Save the token through this form. List/detail responses never include it.
2. Add a node client with its separate local allocation port pool, private FRPC admin URL and Basic authentication credentials. Use a literal loopback, RFC1918, IPv6 private, or Tailscale address. Loopback works only when Panel and FRPC share a network namespace. For a remote node, use its reachable private/Tailscale IP. Each client origin must identify a separate FRPC instance.
3. Download the secret FRPS and FRPC TOML files from the explicit admin-only download buttons. Keep the files private. Install FRPS config at `/etc/voltra-frp/frps.toml` on the VPS and FRPC config at `/etc/voltra-frp/frpc.toml` on the node. FRPC persists Store state at `/var/lib/voltra-frp/frpc-store.json`.
4. Install and start the processes. Allow the FRPS control port and chosen public TCP/UDP pools through the VPS firewall as needed. Restrict FRPC admin access to the Panel over the private network. Never expose or forward the FRPC admin API through a public allocation or FRP tunnel.
5. Select "Test connection and cleanup". Setup completes only after saved configuration comparison, temporary proxy registration, matching running status, and confirmed cleanup. A failed cleanup keeps the temporary proxy name and public port reserved in PostgreSQL. Retry the test to clean that same proxy before attempting another registration.
6. Create routes from allocations assigned to a server on that client node. Select TCP or UDP separately. The public pool is independent of the node's local allocation pool. Omit public_port for concurrency-safe first-free assignment. Explicitly reconcile to apply changes.

A temporary test forwards to `127.0.0.1:9`. FRPC opens its local connection only when traffic arrives, so running status checks FRPS registration and remote bind even if no process listens on port 9. The test does not prove gameplay, public firewall reachability, or game health. `/api/config` describes the saved file, not the credentials of an already-established session. The test compares saved host, control port, token auth method and token privately, then checks current registration. After changing config, start FRPC with the downloaded file before testing. Token files, environment interpolation, OIDC and arbitrary handwritten TOML layouts are not supported by this generated-config verification path.

## Linux installation example

These commands install the pinned acceptance version on Linux amd64. Use `arm64` instead when appropriate. Review the official release assets and checksums before installing.

```sh
version=0.68.0
arch=amd64
curl -fLO "https://github.com/fatedier/frp/releases/download/v${version}/frp_${version}_linux_${arch}.tar.gz"
tar -xzf "frp_${version}_linux_${arch}.tar.gz"
# On the VPS install frps; on each node install frpc.
sudo install -m 0755 "frp_${version}_linux_${arch}/frpc" /usr/local/bin/frpc
sudo install -d -m 0700 /etc/voltra-frp /var/lib/voltra-frp
# Copy the downloaded secret config to /etc/voltra-frp/frpc.toml privately.
sudo chmod 0600 /etc/voltra-frp/frpc.toml
/usr/local/bin/frpc --version
sudo /usr/local/bin/frpc verify -c /etc/voltra-frp/frpc.toml
sudo /usr/local/bin/frpc -c /etc/voltra-frp/frpc.toml
```

The foreground command is useful for initial diagnosis. Stop that foreground instance before enabling a service. Do not run two FRPC processes against the same Store file. Install `/usr/local/bin/frps` on the VPS using the corresponding binary and verify/start `/etc/voltra-frp/frps.toml` there.

Example node service, installed as `/etc/systemd/system/voltra-frpc.service`:

```ini
[Unit]
Description=Voltra FRP node client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frpc -c /etc/voltra-frp/frpc.toml
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/voltra-frp
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now voltra-frpc
sudo systemctl status voltra-frpc
sudo journalctl -u voltra-frpc -n 50 --no-pager
```

A VPS service can use the same template with `frps`, its config path and a distinct service name. These are operator setup commands, never commands executed by reconcile. For multiple gateways on a node, give each FRPC its own config, admin listener, Store directory, and service name. Adjust all paths in the downloaded config and unit consistently.

Generated HTTP admin listeners bind to the private IP in admin_url. HTTPS additionally requires a trusted certificate and key at `/etc/voltra-frp/admin.crt` and `/etc/voltra-frp/admin.key`. TLS validation remains enabled. Restrict access with host firewall/Tailscale rules even for HTTPS. Config and journal access may reveal credentials, so keep them restricted.

## Configuration shape

FRPS download contains:

```toml
bindPort = 7000
auth.method = "token"
auth.token = "replace-through-private-admin-form"
allowPorts = [{ start = 26000, end = 26999 }]
```

Node FRPC download contains:

```toml
serverAddr = "vps.example.com"
serverPort = 7000
auth.method = "token"
auth.token = "replace-through-private-admin-form"
webServer.addr = "100.100.10.20"
webServer.port = 7400
webServer.user = "panel"
webServer.password = "replace-through-private-admin-form"
store.path = "/var/lib/voltra-frp/frpc-store.json"
```

## API and failure behavior

The exact UI contract is `.local/frp-backend-contract.md`. All management endpoints require administrator identity. Secret config downloads use `Cache-Control: no-store`. Tokens and admin credentials are encrypted with the Panel ENCRYPTION_KEY. Changing that key without migrating encrypted values makes them unreadable. Neither raw FRPC error bodies nor config/token contents are returned in errors. Credentials with control characters are rejected to keep generated TOML valid.

Routes begin pending. Reconcile uses Store POST for missing entries and DELETE for explicitly removed entries. A same-named mapping with a different target is never changed or deleted. It also checks runtime status for file-defined collisions before creating a Store entry, because Store would override such a name. Unchanged Store definitions get no write. Applied requires runtime `running`, empty `err`, and matching remote hostname/port. Store acceptance by itself does not mark applied. A starting, disconnected, conflicting or unverifiable mapping reports error and can be retried.

Deleted routes retain their unique gateway/protocol/public-port reservation until Store absence and runtime disappearance are confirmed. Retry after timeouts is safe: persisted Store state is compared again. A failed PostgreSQL commit cannot undo a remote Store mutation; durable desired route/test records allow the next reconcile/test to recover by reading FRPC state. There is no distributed transaction across PostgreSQL and FRPC.

Gateway row locks plus transaction/session advisory locks serialize mutations, reconciliation and wizard tests for one gateway. Database uniqueness enforces gateway/protocol/public-port and node/gateway identity. Database triggers reject referenced allocation owner/IP/port/node changes and server node transfers. Foreign keys restrict deletion until routes are explicitly removed and reconciled. Reconcile also rejects stale allocation targets. Wildcard allocation IPs are rejected with a clear error rather than used as forwarding destinations.

Gateway edits/deletion require removing associated clients first. Client edits/deletion require removing and reconciling routes, and clearing any retained test reservation. Config changes reset setup_complete. Route target/protocol/port fields are immutable. Delete/reconcile/create to replace them. Existing game allocation and startup behavior is unchanged.

The client endpoint `GET /api/client/servers/{server}/proxy-routes` requires allocation.read and returns only id, public_host, public_port, protocol and stored status. Stored status is the latest explicit reconcile result and can become stale if FRPC later disconnects.

## Verification boundary

`TestProxyPrivateTransport` and `TestProxyGatewayIntegration` use a disposable PostgreSQL schema and mock FRPC. They cover encrypted/redacted credentials, TCP/UDP pool independence, concurrent allocation, unchanged mapping preservation, file-name collision rejection, target mutation guards, delete failure/retry, saved token mismatch, private config download, and wizard cleanup reservation/retry. They do not prove real gameplay. Separate runtime-owner evidence in `.local/frp-runtime-contract.md` records real v0.68.0 FRPS/FRPC TCP and UDP traffic plus preservation of an unchanged TCP socket during unrelated CRUD. No live Panel, Wings, game service or database was changed for backend self-checks.
