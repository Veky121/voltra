# Patched Wings and node distribution

Voltra publishes its patched Wings daemon and outbound node connector as separate Linux executables in the same versioned GitHub release at `Veky121/voltra`. The module directory containing this document is the future public repository root. No installer uses a `latest` URL or executes a `curl | bash` pipeline.

## Source and patch inventory

The upstream source is `https://github.com/pterodactyl/wings`, tag `v1.13.3`, exact commit `6987d5e6f0612133e031255a99655e822d30579a`.

The release applies `tools/runtime/wings-failed-install-logs.patch`. It contains all required Wings changes currently present in this repository:

- Installer completion checks Docker's actual exit status. Nonzero exits, wait failures, closed result channels and cancellation report installation failure to the Panel.
- Failed installer logs are captured before removing the installer container. Log failure cannot turn installation failure into success or replace the primary error.
- Log capture and cleanup use independent bounded contexts after cancellation. A stalled response body is closed when its deadline expires.
- Installation log writes use `os.OpenRoot` to confine symlink resolution to the configured log directory.

`tools/wings/install-status.patch` and `apply-install-status.mjs` are older, partial versions of the first change. Do not apply those in addition to the combined patch. `tools/wings/apply-release.mjs` applies the combined patch once and copies `install_wait_test.go.txt` as an additional regression test. It refuses the wrong upstream commit or a dirty checkout. `tools/runtime/nzp-vril-console.patch` modifies a game, not Wings, and is excluded.

The upstream MIT license is copied verbatim into `WINGS-LICENSE` and installed at `/usr/local/share/voltra/WINGS-LICENSE`. Keep that notice with redistributed Wings binaries and patched source. `wings-provenance.json` identifies upstream, the superseded partial patch, and SHA256 hashes of applied inputs. The release workflow adds the Voltra source commit, release version and Go toolchain. Voltra's repository license remains in `LICENSE.md`.

## Release assets

| Asset | Producer |
| --- | --- |
| `voltra-wings-linux-amd64`, `voltra-wings-linux-arm64` | `wings.yml` |
| `WINGS-SHA256SUMS` | `wings.yml`, covers Wings binaries, installer, license and provenance |
| `WINGS-LICENSE`, `wings-provenance.json`, `install-node.sh` | `wings.yml` |
| `voltra-node-linux-amd64`, `voltra-node-linux-arm64` | Global Voltra release workflow |
| `NODE-SHA256SUMS` | Global Voltra release workflow, covers node binaries |

Each manifest has lowercase SHA256 values and two spaces before the exact basename. Independent checksum filenames prevent one workflow from overwriting the other's manifest. The installer requires exactly one valid entry for each downloaded asset. All binaries and notices are verified before installation paths change. HTTPS and the GitHub release are the trust source. These checksums detect corruption; they are not an independent cryptographic publisher signature.

Release steps for a maintainer:

1. Publish an explicit version tag and run the global release workflow to create the release and upload the connector binaries and `NODE-SHA256SUMS`.
2. The global release workflow calls reusable `wings.yml` after publishing, with that exact `version`, such as `v0.1.0-beta.1`, and the matching full 40-character Voltra commit as `ref`. This includes Wings and wizard assets in each complete beta, stable or nightly release. **Patched Wings release** also supports manual dispatch with the same required string inputs. Branch names and arbitrary version strings are rejected. The workflow fetches the version tag and verifies its peeled commit matches `ref` before building.
3. The build fetches only the pinned upstream commit, applies the complete patch, runs `TestVoltraInstall*`, and cross-compiles static amd64 and arm64 executables with Go `1.27.3`, `CGO_ENABLED=0`, `-mod=readonly`, `-trimpath`, `-buildvcs=false`, and an empty build ID. Version text is embedded explicitly. No build timestamp or local absolute source path is embedded.
4. The publish job appends its distinct assets to the existing release. It does not create another release, change latest/prerelease status, or overwrite published asset names. A retry after partial publication fails on collisions. Investigate those assets rather than silently replacing them; use a new version for changed code.
5. Verify both manifests and all required assets exist before announcing the release. Versioned Panel builds embed `-X voltra/internal/panel.NodeReleaseVersion=vVERSION`. The node wizard resolves the newest complete release on the stable channel for stable Panel builds, or the beta channel for development/prerelease builds. `NODE_RELEASE_CHANNEL=stable|beta` overrides the channel. `NODE_RELEASE_VERSION=vVERSION` explicitly pins an operator-selected release. Invalid overrides block installation.

The workflow never installs a daemon, deploys the Panel, restarts services or accesses production game data. Nothing in these instructions publishes automatically from a local checkout.

## Local isolated build

Use Linux with Git, Bash, Node.js 22 and Go `1.27.3`. Run from the Voltra module root. Build output and the upstream checkout must be separate from the source repository:

```bash
git init /tmp/voltra-wings-source
git -C /tmp/voltra-wings-source remote add origin https://github.com/pterodactyl/wings.git
git -C /tmp/voltra-wings-source fetch --depth=1 origin 6987d5e6f0612133e031255a99655e822d30579a
git -C /tmp/voltra-wings-source checkout --detach FETCH_HEAD
bash tools/wings/build-release.sh /tmp/voltra-wings-source /tmp/voltra-wings-dist v0.1.0-beta.1
cd /tmp/voltra-wings-dist
sha256sum -c WINGS-SHA256SUMS
./voltra-wings-linux-amd64 version
```

The build script expects a clean checkout and intentionally refuses a second patch application. For another complete build, create another clean checkout. Rebuilding identical patched source, Go toolchain and version with the same flags produces deterministic binary output. Local provenance describes inputs; the CI workflow additionally records its validated Voltra commit. Executing `version` does not run the daemon. Do not run an arm64 executable on an amd64 host without an emulator.

## New node installation

The node must run systemd Linux on amd64 or arm64, have at least enough storage for Docker images and its game servers, and provide Docker, curl, sha256sum and ordinary core utilities. Install prerequisites through the distribution's package manager and configure Docker before running the installer. The installer does not install packages, start Docker, change firewall rules, reboot, or alter game allocations. Outbound HTTPS must reach GitHub release downloads and the Panel. The Panel uses HTTPS; literal loopback HTTP remains available for local development.

In the node wizard, create an enrollment and wait for the latest Linux installer check, then copy **Run installer** into the Linux terminal. The Panel checks uploaded assets for both supported architectures, canonical download addresses, GitHub asset digests, and matching Wings/connector checksum manifests. Partial releases are skipped; failed integrity checks block the command. Checks are cached for one minute. The command pins the selected version even if a newer release appears afterward. The installer detects amd64 or arm64 automatically.

This command downloads `install-node.sh` and `WINGS-SHA256SUMS` from that immutable release into a private temporary directory. It validates the script checksum before running it with sudo. You can use **Download Linux installer** to inspect the selected script first. Enrollment credentials stay in the separate hidden setup prompt and never enter the command. The Panel also serves the checked-out script source at `/install/node.sh`; that endpoint does not choose a version or carry credentials.

The node release contains a matched Voltra-patched Wings daemon and connector. It does not mix the newest stock upstream Wings executable with an older connector. Node Maintenance currently excludes the node from new server placement; it does not update Wings or stop games. Scheduled updates with an all-servers-stopped gate are a separate feature, not enabled by the installer.

For manual installation, download `install-node.sh` and `WINGS-SHA256SUMS` from one explicit release using HTTPS, inspect the source, and verify its exact entry before execution:

```bash
# In a private working directory containing those two downloaded files:
awk '$2 == "install-node.sh" && length($1) == 64 && $1 !~ /[^0-9a-f]/ { print; n++ } END { if (n != 1) exit 1 }' WINGS-SHA256SUMS > script.sha256
sha256sum -c script.sha256
sudo bash ./install-node.sh v0.1.0-beta.1 https://panel.example.com
```

Use the same version for script downloads and the installer argument. The installer downloads the architecture-specific binaries and verifies both manifests. It installs Wings as `/usr/local/bin/wings`, the connector as `/usr/local/bin/voltra-node`, and license/provenance under `/usr/local/share/voltra`.

Setup opens automatically on a fresh node. Paste the wizard's connection string into the hidden terminal prompt. Never put a pairing token in an argument, environment variable, URL download, service unit or shell history. Compare the printed verification code with the request in the wizard and approve it. Only approval permits private configuration creation and service startup. Saved files live under `/etc/voltra`; the existing setup implementation creates and enables `voltra-wings.service` and `voltra-node.service`.

After approval:

```bash
sudo systemctl status voltra-wings voltra-node
sudo systemctl enable voltra-wings voltra-node
sudo journalctl -u voltra-wings -u voltra-node -n 100
```

The first command checks current service state. The second enables startup on boot. If setup was interrupted, run `sudo voltra-node setup` again using the existing wizard enrollment. Panel Ready still requires its authenticated health probe; successful binary installation alone is not proof of a healthy node.

Management binds to loopback through the outbound connector. SFTP and public game ports require deliberate operator configuration; this installer does not expose them.

## Existing installations and maintenance

Normal installation refuses any existing Wings or connector binary in PATH, standard binary locations, Pterodactyl configuration, Voltra state directory, or Wings/Voltra systemd unit. Nothing is replaced and no existing service is stopped or restarted.

To replace binaries deliberately:

1. Schedule maintenance for the node and back up its executables, private configuration and service units. Record the current unit `ExecStart` paths and game state. Changing daemon binaries may affect every game when Wings next starts.
2. Stop the applicable Wings and connector services yourself after deciding how to handle running games. The installer never issues a stop or restart. It refuses replacement while any of `wings.service`, `voltra-wings.service` or `voltra-node.service` is active.
3. Run the reviewed, checksum-verified installer with the explicit version and `--replace-existing`. Type `REPLACE STOPPED NODE BINARIES` at its terminal prompt. Without that exact acknowledgement it exits before downloads or writes.
4. The installer saves old `/usr/local/bin/wings` and `/usr/local/bin/voltra-node` binaries in a private `/usr/local/share/voltra/binary-backup.*` directory, then replaces only those standard binary paths. It retains all configuration/data and exits without setup or service startup. A custom path such as `/usr/bin/wings` is retained; review your unit paths yourself. If installation fails partway, restore the saved binaries before starting services.
5. Review compatibility, service paths and configuration, then choose when to start the applicable services yourself. For rollback while stopped, restore the backed-up executables and any operator-managed configuration backups.

This does not adopt an existing Pterodactyl node into Voltra. Use a separate fresh node or an independently planned migration. Existing Voltra enrollment recovery uses `sudo voltra-node setup --reconnect` with an approved recovery enrollment, without downloading or replacing binaries. Recovery may restart Voltra services to rotate approved credentials; perform it during an appropriate maintenance window.

## Verification boundaries

```bash
python3 tools/install/test_node.py
go test ./internal/panel -run TestNodeInstallCommand -count=1
# The complete build also runs the patched upstream server tests:
# go test ./server -run 'TestVoltraInstall' -count=1
```

The Python tests execute the real installer with real Bash, temporary paths, controlling terminals and real SHA256 validation. Host commands and release downloads are fixtures. They cover both supported architectures, corrupt/missing/duplicate checksum data, missing releases, wrong executable headers, Docker failure, unsupported versions/platforms, terminal requirements and explicit existing-node replacement. They cannot establish production systemd startup, arm64 execution, live enrollment or game behavior.
