# Shared public artifact cache

`cache-artifact.mjs` uses the Docker Desktop host directory
`/var/lib/voltra-batch-20261023/cache`. The cache is outside game volumes,
root-owned, and never mounted writable into game servers. Docker already reuses
image layers across containers.

All publishers share a blocking POSIX `cache/.capacity.lock`. The public artifact
helper holds it through download and atomic publication and counts the entire
cache root, including other namespaces and in-flight files, against 20 GiB.
Steam game content publishers use the same lock and may evict only their own
complete objects. Public artifacts have no automatic eviction. Cache hits remain
readable when the cache is already over capacity; new downloads fail without
publishing partial files. Utility/probe scratch belongs under the separate
`/var/lib/voltra-batch-20261023/utility` directory. `cache-steamcmd.py` staging
does not recursively acquire this lock: a game-cache caller holds the outer lock
while it stages independent program copies.

Seed a public artifact that was downloaded and inspected by a game owner:

```
node tools/runtime/cache-artifact.mjs --sha256 <64-character digest> --source .local/game/archive.zip
```

Fetch a digest-pinned public artifact once and materialize a working copy:

```
node tools/runtime/cache-artifact.mjs --sha256 <trusted digest> --url https://publisher.example/release.zip --destination .local/game/archive.zip
```

The destination parent must exist. Existing ordinary destination files are
atomically replaced. Each output is writable and independent, using Linux
reflinks when available and a byte copy otherwise. Cache hits verify the full
digest. Concurrent same-digest requests serialize on `flock`, publish only after
verification, and discard incomplete or incorrect downloads. The default limit
is 8 GiB, configurable with `--max-bytes`.

The wrapper uses an already-present `python:3.13-slim` image by resolved local
image ID and never pulls it implicitly. Source seeding runs without networking.
The underlying Python helper can also run directly on Linux.

Only public artifacts belong here. Credentialed URLs, URL query strings and
non-HTTPS redirects are rejected. Do not seed credentials, user saves, mutable
Steam installation trees, Steam login state, or private-branch content. A digest
computed after a first download establishes its byte identity, not publisher
authenticity; retain the publisher source and independent verification evidence.

GitHub's public release downloads may redirect to signed public asset CDN URLs.
Those ephemeral query strings are accepted only on redirects to the exact GitHub
release asset CDN hosts. The original requested URL still cannot contain a query,
and the resulting bytes must match the supplied SHA-256. No credentials, cookies
or authorization headers are sent or cached.

For batch-node installer reuse, create an owned server with `skip_scripts:true`,
wait for that skipped installation to finish, and keep it stopped. Run:

```
node tools/runtime/cache-volume-seed.mjs <server-private-receipt.json> <digest> [<digest>...]
```

This copies only verified public blobs into `.voltra/public-cache/<digest>` in
that server's volume. The shared native-release downloader can use these local
copies after its own digest validation. Then PATCH the application startup API
with `skip_scripts:false` and request reinstall once. Reinstall alone does not
clear the stored skip flag. Never seed a running installer or server volume.

SteamCMD bootstrap acquisition and staging are separate:

```
node tools/runtime/cache-steamcmd-acquire.mjs
node tools/runtime/cache-steamcmd-stage.mjs <server-private-receipt.json>
```

Acquisition downloads the existing official HTTPS bootstrap once and writes its
digest and provenance to `.local/cache-steamcmd/acquisition.json`. This records
byte identity, not a publisher signature. Staging verifies that digest again,
checks safe archive paths, creates an absent `.voltra/steamcmd` atomically and
records provenance. Existing directories are never replaced. The ordinary
SteamCMD launcher still self-updates, refreshes app metadata and installs the
game with normal manifest validation. Report this as a warm shared bootstrap.
It does not reuse game depots or claim a cold bootstrap download. These tools
support only the owned batch node 202 and reject active containers or installs.

Updated public SteamCMD caching is explicit:

```
node tools/runtime/cache-steamcmd-updated-prepare.mjs
node tools/runtime/cache-steamcmd-updated-publish.mjs
node tools/runtime/cache-steamcmd-updated-verify.mjs
node tools/runtime/cache-steamcmd-stage.mjs <server-private-receipt.json> --updated
```

Preparation runs a fresh official launcher with `+quit` only, in a bounded
512 MiB utility container. It never logs in or reads a game volume. Publication
includes reviewed ELF programs, launcher, package metadata, and public resources
listed in the native updater's installed catalogs. Resource sizes and CRCs must
match those catalogs. Native SteamCMD processes Valve's package metadata; this
tool does not independently verify Valve's signature cryptography. Every
published file additionally has a SHA256, mode and timestamp in the local
manifest. Configuration, logs, accounts, userdata, appcache, package ZIP caches
and metrics are excluded. Unknown files require review. No user installation is
an acceptable preparation source.

Staging validates the entire archive before writing, rejects links and unknown
members, and creates independent writable copies. The seven day bundle lifetime
forces periodic fresh preparation; normal publisher checks remain enabled on
every launch. For refresh, preserve the old `.local/cache-steamcmd-updated`
directory under a dated evidence name, then run the sequence again. Existing
receipts are never overwritten automatically. The default stage command keeps
using the original official bootstrap until `--updated` is requested.

Measured native version 1792617903: the original bootstrap's fresh preparation
took 19.740 seconds and reported 41,429/41,370 KiB update phases. A development
bundle omitting locale/UI resources still downloaded 41,429 KiB on each launch
(8.144/8.450 seconds). The complete public bundle contains 174 files in a
61,758,781 byte archive. Two fresh private copies launched and quit in
3.118/5.048 seconds, each with a publisher update check and no reported package
download. Their native binaries had different inodes and the shared archive
remained unchanged. This measures launcher preparation only, not game install
speed or cold game acceptance. Evidence is in
`.local/cache-steamcmd-updated/{preparation,verification,public-manifest}.json`.

Focused archive and bootstrap regressions:

```
python3 tools/runtime/cache-steamcmd-public-test.py
python3 tools/runtime/cache-steamcmd-test.py
```

Offline tests:

```
docker run --rm --network none --mount type=bind,source=<repo>,target=/workspace,readonly -w /workspace python:3.13-slim python3 tools/runtime/cache-test.py
```
