# Pristine anonymous Steam payload reuse

These tools never boot a game or change the Panel. They acquire public `public`
branch content with an anonymous SteamCMD utility, refresh publisher metadata,
run `app_update ... validate`, and require primary native `StateFlags=4`.
Private/password branches and account credentials are unsupported. Existing
operator or booted game volumes cannot be imported as acquisition sources.

`steam-game-cache-prepare.mjs` prepares app90/cstrike in a new private utility.
The utility is limited to 512 MiB RAM, one CPU and 1.8 GiB observed working data;
the 2 GiB admission headroom includes the independently copied SteamCMD client.
Larger acquisitions need an explicitly coordinated resource budget and a
reviewed bound; do not disable this check. Network/time/resource failures leave
no published cache index. Retain their receipts for inspection.

The key contains app, public branch, native build, platform, app90 mod and all
selected depot manifest IDs. Shared app/depot dependencies are resolved from
their native appmanifests; shared-only native state 68 is distinct from primary
state 4. ValvePython/vdf 3.4 is vendored under the MIT license from the PyPI wheel
SHA256 `68c1a125cc49e343d535af2dd25074e9cb0908c6607f073947c4a04bbe234534`.
This parses native text metadata; it does not independently verify/decrypt
Valve's binary depot cryptography. Publisher verification remains SteamCMD's.

The immutable local manifest records every public payload file's SHA256, size,
mode and acquisition provenance. Only files from the isolated fresh native
acquisition qualify, including publisher-shipped default configuration. Steam
client state, account ownership IDs, userdata, logs, dumps and generated private
directories are excluded. Links, special files, ambiguous case/path names and
unknown appmanifest fields fail closed, leaving ordinary downloads available.
Sanitized public appmanifest metadata remains provenance only: staging deploys
payload files without cached Steam application/account state. Native Steam
reconstructs that state during the required ordinary install/validation.

Objects live at `cache/steam-games/objects/<manifest-sha256>`; keys are immutable
selection hashes with atomic index replacement. Source/verification utilities
live under private `cache/steam-games/work/<UUID>`; incomplete publication lives
under `.staging`. The shared blocking `cache/.capacity.lock` serializes capacity
checks, publication, private staging and GC with the existing public artifact
CAS. The 20 GiB limit counts the entire shared root, including other public blobs
and in-flight work. This namespace's GC only removes its own expired-key,
unreferenced objects; it never deletes another cache owner's blobs. Games never
mount cache objects, and completed staging uses independent writable copies.

Stage a known immutable object into an empty, stopped, owned node202 volume:

```powershell
node tools/runtime/steam-game-cache-stage.mjs <private-server-receipt> <object-sha256>
```

This reuses `cache-owned-server.mjs` UUID/node/stopped native+installer checks,
requires the exact volume mount and numeric game UID/GID, checks an active
lease when the receipt has one, and refuses nonempty volumes. Copy/hash checks
finish before committing top-level payload directories. No hardlinks are used;
partial staging rolls back. A local `game-content-cache-stage.json` records warm
provenance. Always run the ordinary installer metadata/update/validate path
afterward. A warm cache is not a cold download or native gameplay acceptance.

`steam-game-cache-verify.mjs` measures two fresh private utility copies through
normal publisher checks, then compares file hashes/inodes and changes one copy
to prove independence. It must complete successfully before claiming measured
reuse. Development failures are preserved in separate verification receipts.
`steam-game-cache-cleanup.mjs` removes only receipt-listed stopped utility
containers and work trees; the immutable published object remains reusable.

Measured app90/cstrike build 15961496: 5,428 files / 962,192,722 bytes. Two fresh
private copies staged in 3.365/3.116 seconds. Ordinary native publisher checks
then completed in 28.589/24.874 seconds, receiving 3,140,572/3,022,506 network
bytes and reporting no game download progress. All payload file hashes still
matched afterward. The cache and two private executables had distinct inodes;
changing one private executable left the other copy and fully rehashed cache
unchanged. This is warm reuse, with no cold download timing ratio claimed.
Evidence: `artifacts/steam-game-cache-acceptance.json`.

Offline security fixtures:

```powershell
docker run --rm --network none --read-only --memory 256m --tmpfs /tmp:rw,size=64m --mount type=bind,source=<repo>/tools/runtime,target=/helpers,readonly python:3.13-slim python3 -B /helpers/steam-game-cache-test.py
```
