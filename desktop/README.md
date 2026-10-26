# Voltra desktop

Connect to your own Voltra panel to manage games hosted on your hardware with friends. The desktop app is a client, not a rented game server or a public hosting service.

Windows desktop client built with Wails v3.0.0-beta.34 and the panel's existing
React/Vite frontend. The executable embeds the UI and connects to a running
Voltra panel. Server management still runs on the panel and Wings.

## Build and run

From the repository root, with Go 1.27.3 and Node/npm installed:

```powershell
npm.cmd ci --prefix web
.\desktop\build.ps1
.\desktop\bin\Voltra.exe
```

The script compiles the shared frontend with `VITE_DESKTOP=true`, then embeds
the result into `desktop/bin/Voltra.exe`. It does not need a globally installed
Wails CLI. Windows needs the Microsoft Edge WebView2 runtime.

The same build embeds the Voltra multi-resolution Windows icon resource, so
Explorer, shortcuts and the taskbar use the shared V mark. The application/about
icon is embedded from assets/app.png. Sources, exports and regeneration steps
are documented in ../branding/README.md. assets/app.icns is ready for future
macOS packaging; this script builds the Windows application only.

1. In the web app, open **Account → Desktop apps**.
2. Create a pairing code.
3. In Voltra.exe, enter the panel address, code, and computer name.

Codes expire after ten minutes and work once. Generating another replaces the
previous pending code for that account. The desktop opens the same account,
servers, and admin tools as the web app. Membership and permission changes are
checked by the panel on every request.

Sessions last 90 days. Revoke a device from Account → Desktop apps, or use
Unlink in the desktop toolbar. Unlink removes the local credential and attempts
remote revocation. When offline, revoke the device separately from the web app.
Unlink panel is available in the title bar and on the Panel unavailable screen.
App & updates also opens locally while a saved panel is offline, so update and
connection controls remain available without contacting that panel.
Revocation rejects new API requests and socket connections. An already open
console connection is closed when the desktop unlinks or exits, or when its
upstream connection ends. It is not forcibly terminated by remote revocation.

## Connection and storage

The Go host proxies HTTP, streamed files, and console WebSockets. The bearer
credential is added in Go and is never returned to React, localStorage, or the
WebView cookie store. The panel keeps only its hash.

Windows DPAPI encrypts the saved connection for the current Windows user in
`%APPDATA%\Voltra\connection.dat`. The WebView profile is in the adjacent
`WebView2` directory. `VOLTRA_DESKTOP_CONFIG_DIR` can select a separate data
directory for development or testing. Protected connections remain tied to the
Windows account even when a custom directory is used.

An ephemeral loopback HTTP listener serves the embedded UI and supports native
WebSocket forwarding. A random HttpOnly launch cookie, strict origin checks,
and a local Host check protect it from unrelated browser pages. Only one app
instance runs at a time. A second launch focuses the existing window.

Remote panels require HTTPS. HTTP is allowed only for loopback development.
Web account login stays with the panel. No Google or Cloudflare credentials
are copied into the desktop. If Cloudflare Access protects the entire origin,
its interactive login can intercept the native API calls. Configure Access to
let the panel authenticate desktop exchange/API/socket requests itself, or use
a panel origin reachable directly over HTTPS. This client does not create or
configure tunnels or bypass Cloudflare Access.

## Updates and GitHub setup later

Local builds include the official GitHub channel feed and pinned Ed25519 public
key. Use `build.ps1 -DisableUpdates` only for deliberately offline builds.

Channels are Release, Beta and Nightly. Release uses the stable feed and never
offers prereleases. A release on Beta or Nightly does not appear on Release.
Local `-dev` builds can adopt a signed published build even when their development
label would sort above it under SemVer. Checks run on launch and hourly; Check
now ignores that timer and refreshes the feed. Check, Install and Restart remain
separate actions. An update is never installed by an automatic check.

```powershell
.\desktop\build.ps1 -Version 0.1.0 `
  -UpdateManifestURL 'https://github.com/Veky121/voltra/releases/download/update-{{channel}}/manifest.json' `
  -UpdatePublicKey 'BASE64_RAW_ED25519_PUBLIC_KEY'
```

Both update parameters are required together. A configured public key makes
signatures mandatory. Unsigned artifacts cannot downgrade verification to
checksum-only mode. Feed checks bypass HTTP caches. Native code signing and
GitHub publishing remain separate release tasks.

Use the pinned Wails CLI for publishing tools:

```powershell
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.34
wails3 updater genkey -out .local/release-keys/updater.key
```

Keep the private key outside version control. The command prints the raw
base64 public key used by `-UpdatePublicKey`. Build a release executable, name
the uploaded asset `Voltra-windows-amd64.exe`, then use `wails3 updater manifest`
to describe and sign it. Run `wails3 updater verify` before uploading the
manifest and executable. Preserve the signing key across versions.

The manifest provider uses Wails' standard update protocol and can also point
at a static HTTPS host. GitHub's generic Releases provider does not attach
artifact signatures, so this app uses a signed manifest hosted on Releases.
Old executables without a feed or trust key need a one-time manual replacement.

## Checks

```powershell
Set-Location desktop
go test ./... -count=1
go vet ./...
```

Tests cover Windows DPAPI persistence, corrupt credential recovery, panel URL
validation, account linking, browser isolation, credential/header handling,
streamed uploads/downloads, bidirectional console sockets, route reloads,
upstream errors, sign-out, and remote revocation on unlink. The panel's
PostgreSQL-backed `TestDesktopPairingAndRevocation` covers account boundaries,
concurrent one-use exchange, expiry, disabled users, admin permissions, and API
key escalation protection.

`TestDesktopLivePanel` is opt-in through `VOLTRA_DESKTOP_TEST_PANEL`. It requires
an isolated loopback development panel seeded with its test administrator. It
checks real pairing, native proxy account loading, and persistence. Set
`VOLTRA_DESKTOP_TEST_CONFIG_DIR` only when deliberately retaining its fixture
connection for a native window check. Ordinary tests use temporary directories.

References: [Wails updater](https://v3.wails.io/guides/updater/) and
[Wails application API](https://v3.wails.io/reference/application/).
