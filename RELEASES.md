# Voltra releases

The public repository is `Veky121/voltra`, a public fork of `pterodactyl/panel`. Its root is the contents of this Go module. Do not publish the parent workspace, reference Laravel checkout, `.local`, session files, databases, or development artifacts. The first public beta is `v0.1.0-beta.1`; a local commit message is not a release version.

## Versions and channels

| Channel | Tag | Feed carrier | Default |
| --- | --- | --- | --- |
| Stable | `v1.2.3` | `update-stable` | Yes |
| Beta | `v1.2.3-beta.1` | `update-beta` | Opt in |
| Nightly | `v1.2.3-nightly.20261023.1` | `update-nightly` | Opt in |

Use increasing SemVer tags. Beta sequence numbers start at 1. Nightly tags include the UTC date and an increasing run number. Nightlies can be published by pushing an explicit nightly tag or dispatching against an existing tag. A daily 03:23 UTC schedule is disabled by default. The repository owner opts in by setting the Actions variable `VOLTRA_NIGHTLY_ENABLED` to the exact value `true`. Remove it or set it to `false` to disable future scheduled runs. Already-running jobs are not cancelled by changing a variable. The schedule reads the stable base from `VERSION`, builds the default-branch commit, then creates `v<base>-nightly.<UTC date>.<GitHub run number>` only in the write-enabled publication job after all builds pass. It never changes the stable feed. GitHub may delay scheduled runs. App users separately opt into the Nightly channel; repository scheduling does not opt any client in. Tag commits must be ancestors of `main`. Tags and their version assets must never be moved or replaced. Protect `main` and `v*` tags with repository rules and restrict release-environment access to trusted maintainers.

Every desktop starts on stable, including beta builds. Changing the channel is a deliberate local setting in `updates.json` in the desktop configuration directory. It contains no session token and survives unlinking. Each check requests only that channel. Stable accepts only a stable manifest and a SemVer without a prerelease. Beta and nightly feeds never notify stable users. Switching channels clears the available offer and requires another check. Switching to stable does not downgrade an installed prerelease; the next higher stable version will be offered.

The UI uses Wails beta.34's supported custom-UI operations: `Check` shows availability, `DownloadAndInstall` downloads, verifies and stages after the user clicks Download and install, and `Restart` swaps the binary after Restart to apply update. Checks never download or restart. There is no automatic background installation. Wails `CheckAndInstall` and `CheckInterval` are intentionally unused because beta.34's interval calls `CheckAndInstall`. Check errors and no-update results are shown in the desktop controls, available before and after linking an account. Pairing is unchanged.

## Signing setup, performed by the repository owner

From the future repository root, generate keys only into the ignored directory:

```powershell
go run ./tools/release keygen .local/updater-keys
Get-Content -Raw .local/updater-keys/private-key.b64 | gh secret set VOLTRA_UPDATER_PRIVATE_KEY --repo Veky121/voltra
Get-Content -Raw .local/updater-keys/public-key.b64 | gh variable set VOLTRA_UPDATER_PUBLIC_KEY --repo Veky121/voltra
```

The private secret is standard padded base64 of a **64-byte raw Ed25519 private key**. The public variable is standard padded base64 of its **32-byte raw public key**. No PEM, DER, JSON, or seed-only encoding. Key generation refuses to overwrite existing files and prints no key material. On Windows, restrict the ignored key directory's ACL to the owner before generation. Keep a protected offline backup; remove local key files after secure setup. Never paste the private key into chat, commit it, or pass its value in command-line arguments. The pipeline sends file contents only to `gh` stdin. Create the GitHub environment `release` and configure any desired required reviewers before dispatching.

The Windows build pins the decoded raw public key into the EXE. Publication checks that the public variable matches the private secret, computes SHA-256 of the exact EXE, and signs the **32 raw digest bytes** using Ed25519. The manifest stores both digest and signature as base64. Wails requires a valid signature under the pinned key before staging; missing, altered or mismatched signatures fail closed. Local CI builds without updater settings have updates disabled. The release key does not provide Windows Authenticode signing, so SmartScreen reputation is a separate concern.

Do not rotate the key by simply replacing the variable: already-installed clients trust the old key. Plan and test a transition release signed by the old key that embeds the new key, and retain an old-key feed long enough for users to transition.

## Wails manifest protocol

Exact beta.34 primary sources are `pkg/updater/providers/endpoint/endpoint.go`, `pkg/updater/verify.go`, `pkg/updater/updater.go` and `pkg/updater/config.go` in the pinned module, also available in the [official Wails source](https://github.com/wailsapp/wails/tree/v3.0.0-beta.34/v3/pkg/updater). `tools/release` emits this schema:

```json
{
  "schemaVersion": 1,
  "version": "0.1.0-beta.1",
  "channel": "beta",
  "name": "Voltra 0.1.0-beta.1",
  "publishedAt": "2026-10-23T00:00:00Z",
  "artifacts": [{
    "platform": "windows", "arch": "amd64",
    "url": "https://github.com/Veky121/voltra/releases/download/v0.1.0-beta.1/Voltra-windows-amd64.exe",
    "filename": "Voltra-windows-amd64.exe", "filetype": "exe", "size": 123,
    "digestAlgo": "sha256", "digest": "BASE64_SHA256",
    "signatureAlgo": "ed25519", "signature": "BASE64_SIGNATURE"
  }]
}
```

Those placeholder digest and signature values are documentation, not valid release inputs. The real generator reads the actual artifact and private key. Tests check schema decoding against the real endpoint provider and confirm the Ed25519 signature signs the digest rather than the entire EXE.

The fixed URL is `https://github.com/Veky121/voltra/releases/download/update-{{channel}}/manifest.json`. Each carrier is a prerelease with `latest=false`; it holds only the mutable manifest and references a version-tagged EXE. The publication job uploads and verifies all version assets before replacing the carrier manifest. It refuses to move a feed backward or overwrite differing version assets, and retries can reuse byte-identical assets. Stable version releases alone can become GitHub latest. Configure the repository to allow carrier assets to be updated; repository-wide immutable-release enforcement is incompatible with these mutable carrier releases. Version immutability is enforced by tooling and tag rules in this design.

Wails signs artifact bytes, not manifest metadata. HTTPS, repository permissions and protected publication remain necessary for feed integrity. The client additionally enforces channel/version agreement, SHA-256 plus Ed25519, and HTTPS artifact URLs under the exact version's `Veky121/voltra` release path. There is no cryptographic metadata signature or transparency log in this Wails protocol. Keep repository write access restricted.

## Workflows and assets

`voltra-ci.yml` runs on PRs and main pushes with contents-read permission, no signing key, and no publication. It type-checks/builds the frontend, tests the release tool and node agent, builds panel/node, tests desktop and builds an unsigned Windows CI EXE. Third-party actions are pinned to full revisions.

`voltra-release.yml` runs on `v*` tags or manual dispatch with an existing strict version tag. Plan validates the tag and main ancestry. Builds use the resolved commit SHA. Only the final `publish` job has contents-write permission and access to the signing key, via the `release` environment. It publishes:

- `Voltra-windows-amd64.exe`, `DESKTOP-SHA256SUMS`, `manifest.json`
- `voltra-node-linux-amd64`, `voltra-node-linux-arm64`, `NODE-SHA256SUMS`
- `voltra-panel-linux-amd64`, `voltra-panel-linux-arm64`, `voltra-web.tar.gz`, `PANEL-SHA256SUMS`

Panel builds embed the full release tag through `-X voltra/internal/panel.NodeReleaseVersion=$VERSION`, where VERSION is the validated tag, including `v`, such as `v0.1.0-beta.1`. This pins the wizard installer without manual environment setup. `NODE_RELEASE_VERSION` still overrides it; development builds leave the fallback empty and fail closed until configured. Panel binaries require the web archive and normal panel configuration; this workflow does not deploy them. The node installer owner consumes the exact node names and checksum file above. `wings.yml` independently uses the same explicit tag and owns `voltra-wings-linux-{amd64,arm64}`, `WINGS-SHA256SUMS`, `WINGS-LICENSE`, `wings-provenance.json`, and `install-node.sh`. No generic `SHA256SUMS` is shared. The Voltra workflow creates the version release first; Wings appends only its own assets to that existing release. The update carrier is gated on this workflow's desktop/panel/node builds; installer readiness also requires the independent Wings workflow to succeed. After Voltra publication succeeds, dispatch Wings with `version` set to that same tag and `ref` set to its exact 40-character commit. Scheduled nightly tags created with GITHUB_TOKEN do not trigger additional workflows; Wings remains a separate dispatch until its owner adds a reusable workflow interface. This does not affect desktop nightly updates. Uploads never replace another owner's assets.

Repository owner publication sequence:

1. Review the exported module-root checkout, keys, environment and repository rules. Run local checks below.
2. Push the reviewed source to `main`. Tag its commit `v0.1.0-beta.1` and push that tag, or dispatch both workflows against the existing tag.
3. Require both workflows to pass. Download node assets and verify `NODE-SHA256SUMS`; inspect Wings provenance separately.
4. Test an older disposable Windows install opting into beta. Check must show availability without downloading. Install must reject corrupted bytes or wrong signatures. A verified install must wait for Restart. Confirm stable cannot see the beta. Repeat with nightly before offering nightlies to users.

Do not retag or overwrite a broken published version. Publish a higher version. A failed publication can be retried only with identical existing assets; if rebuilding changes bytes, use a fresh version tag. Carrier feeds never decrease their offered SemVer. Back up release state before changing these policies.

## Local checks

```powershell
go test ./tools/release ./internal/nodeagent
python -m unittest discover -s tools/release -p 'test_*.py'
go -C desktop test ./...
go -C desktop vet ./...
npm run check --prefix web
./desktop/build.ps1 -Version 0.1.0-beta.1
```

Cross-build both Linux architectures with `CGO_ENABLED=0`, `GOOS=linux`, and `GOARCH=amd64` or `arm64`. A successful build and fixture tests do not prove a remote GitHub publication, Windows binary swap, or live installer. Those require the owner-run release and disposable-machine acceptance above. No secret generation, GitHub publication or service restart is part of local verification.
