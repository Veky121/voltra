# Outbound node

See [WINGS.md](../../WINGS.md) for public `Veky121/voltra` versioned releases,
the complete patched Wings build, verified installer and existing-node maintenance.
`./tools/node/build.ps1` still emits Linux connector binaries and SHA256SUMS
under `artifacts/node` for local development. Public releases use the separate
`NODE-SHA256SUMS` manifest. Panel serves `tools/install/node.sh` at
`/install/node.sh`; `tools/node/install.sh` forwards to it for local source use.

Set `NODE_RELEASE_VERSION` on the Panel to a published version. The wizard
provides a command that verifies the pinned release script before running it.
The installer takes `vVERSION https://panel.example.com`, never a pairing token.
It opens setup automatically on a fresh node. Paste the connection string at
its hidden prompt. Input comes from `/dev/tty`. Do not pipe downloads into bash.
An unattended session without a terminal fails before making
changes. Match the printed verification code in the Panel
before approving. Setup waits for approval, saves private files under
`/etc/voltra`, acknowledges receipt, and enables `voltra-wings.service` and
`voltra-node.service`. Both restart on failure. Interrupted setup can be retried;
saved credentials and pending Wings configuration allow completion recovery.
Service startup is reported to the Panel using the new connector credential.
Only the Panel's authenticated Wings health probe can declare the node Ready.

To reconnect an existing node, create its reconnect request in the Panel and run
`sudo voltra-node setup --reconnect` using the existing installed connector.
This prompts even when a completed node config
exists. Only a recovery enrollment is accepted and admin approval is required.
The approved Wings UUID must match the existing private Wings YAML and any UUID
recorded in node.json. Recovery replaces Wings authentication, Panel URL and the
private API listener. It keeps data directories, SFTP, Docker/network settings,
unknown operator settings and the node UUID. Existing Pterodactyl installations
are never adopted. Recovery saves both the old and approved YAML privately until
the approved replacement and enrollment acknowledgment finish. Retries refuse
concurrent operator edits instead of overwriting them. `setup` and `run` resume
pending acknowledgments automatically, including a lost successful response.
If recovery was interrupted before the service restart, `run` restarts Wings
with the new credentials before connecting. Setup restarts the two Voltra services
so running processes use the rotated credentials.

The installer requires systemd Linux on amd64 or arm64. Install curl, Docker
and core utilities through your distribution package manager first. All release
binaries are checksum-verified before installation. Existing Wings or Voltra
state stops a normal installation. Explicit stopped-node binary replacement is
documented in WINGS.md and never starts or restarts services. Stock Wings is
never downloaded as a fallback.
The script does not configure game allocations, host firewall rules, public
addresses, or DNS. SFTP starts on loopback; an operator must configure its bind
address and firewall deliberately to expose it. The installer does not reboot
or alter kernel/GRUB.

`nodeagent.Run(ctx, Config{PanelURL, Token, WingsAddress}) error` maintains the
connector. `RunSaved(ctx, path)` loads private JSON, recovers a pending completion,
and runs it. `Setup(ctx, SetupOptions)` supports isolated setup tests. Wings
management is bound to `127.0.0.1:8080`; control requests cannot choose a remote
destination. The connector opens no listener. Up to 64 simultaneous streams are
allowed, with 10-second dial/handshake timeouts and 1-to-30-second reconnect
backoff. Control/data WebSockets use ping/pong deadlines. Invalid credentials
stop Run with an error; systemd restarts it after five seconds.

TLS uses system certificate verification. Plain HTTP is permitted only for
literal loopback addresses or localhost during development. On a separate node,
localhost refers to that node, so it cannot reach a Panel on another machine.
The pairing token only enrolls. A unique request Bearer polls approval; only an
approved request receives the connector and Wings secrets. Completion must be
idempotent for retries after a lost response, while completed polling must never
return credentials. The private JSON temporarily keeps the request token until
completion succeeds. Tokens never appear in service command lines or logs.

`nodetunnel.NewConn(*websocket.Conn) net.Conn` owns the WebSocket, chunks binary
writes at 64 KiB, hides message boundaries, rejects text messages, and closes
blocked I/O. It serializes reads/writes independently. Like Gorilla WebSocket,
a read/write deadline timeout makes that direction unusable; close and reconnect
after a timeout. There is no TCP half-close on this protocol, so EOF closes both
directions. Panel must read each stream continuously to process pong frames.

Verification commands: `go test ./internal/nodeagent ./cmd/node`,
`go vet ./internal/nodeagent ./cmd/node`, `python3 tools/node/test_install.py`
on Linux, and `./tools/node/build.ps1`. Linux Go tests use real pseudo-terminals
for hidden input/cancellation and fake systemctl executables for service failures
and independent activity checks. The Python tests execute the actual installer
with disposable paths, fake host command tools and a controlling terminal.
They cover both architectures, release checksums, setup entry, existing binaries,
explicit replacement and actionable failures. These checks do not establish production
systemd/Docker deployment or a live Panel Ready result.
