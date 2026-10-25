# Private Steam candidate bundle

This tool produces offline candidates only. It does not enable capabilities, install services, authenticate Steam or publish releases. A SHA256 calculated beside an archive is an identity, not an independent trust source. The node installer requires a separately approved manifest digest.

## Rebuild from the source artifact alone

Prerequisites: Linux x86_64, Python3.11+, the native libraries required by Microsoft .NET10 SDK, and explicitly supplied offline cached SDK10.0.402 archive/extracted SDK plus the five pinned NuGet archives in a hierarchical local feed. No repository checkout or private `.local` tree is needed. `inputs.json` pins all worker sources, SDK publisher SHA512 and package archive SHA256. Locked restore independently validates NuGet content hashes. Do not substitute archive hashes for those distinct content hashes.

Extract the reviewed `source.tar` into a new directory using the strict provisioner or another traversal-safe extractor, then run:

```
python3 SOURCE/builder/standalone.py \
  --source-root SOURCE/worker --inputs SOURCE/inputs.json \
  --sdk /ABS/verified-sdk --sdk-archive /ABS/dotnet-sdk.tar.gz \
  --packages /ABS/hierarchical-nuget-feed --build-dir /ABS/NEW-empty-output
```

Use absolute paths. The output directory must not exist. The entrypoint checks every actual SDK file against its approved archive, source pins and all package archive pins, then restores into a fresh package cache. It compiles in independent `a` and `b` roots with a full-root PathMap, compares every output byte including apphost, managed DLL, PDB and runtime metadata, and writes `result.json`. `--compare-output /ABS/candidate-build-output` additionally requires equality with a prior candidate. A mismatch stops; no reproducibility claim is made. Run without network access. Native dependencies are prerequisites, never installed by this script.

`build.mjs` is a repository/approved-utility convenience driver, not the standalone source rebuild entrypoint. It retains failed restore/repro attempts and invokes pinned cached containers with no network/pulls. `package.py` packages the equal outputs with an isolated exact Microsoft.NETCore.App10.0.13 runtime derived from the checksum-verified SDK, publisher runtime licenses/notices, all dependency attribution and full LGPL2.1 text from the approved SteamKit source archive. It produces deterministic USTAR binary/source archives and a canonical manifest. Tar names/order/mtime/UID/GID/modes are fixed. A source revision creates new archives/manifests; never replace an approved candidate.

## License/source boundary

Worker orchestration is original MIT. SteamKit remains a separate unmodified dynamically loaded LGPL dependency; the source artifact includes exact commit49387aec55c24104946af7a7b160148358e538b4 and build/relink instructions. No single-file, trimming or AOT linking is used. All package attribution, Apache/MIT/LGPL text and publisher runtime notices accompany binaries. Replacing a dependency and rebuilding a candidate requires explicit administrator approval of its new integrity digest. This is not DRM or a legal compliance guarantee. SDK distribution is not included; its pinned public acquisition input is documented. DepotDownloader GPL research and the separately named fixture assembly are excluded.

## Installation boundary

`InstallPrivateCandidate` accepts bounded uncompressed USTAR streams and an externally trusted manifest digest. It validates both archive digests, every regular file/hash/size/mode, all directory/owner identities and exact source/license presence. Traversal, absolute paths, symlinks/hardlinks, special files, unknown/duplicate/case-colliding paths, extra directories, permission changes and missing source are rejected.

Installation stages under an explicitly configured root-owned base and atomically publishes the contentdigest version directory after fsync. Retry after rename completes the parent-directory fsync before success. Recovery removes only a recognized partial staging tree; unknown/operator entries require review. Complete versions are reverified before idempotent success. There is no activation symlink, download path, service restart or capability change. Root-owned administrators remain trusted; external tampering by root is not prevented by integrity checks.

Tests cover the strict manifest verifier, actual Linux archive attacks, mode/hash mutation, concurrent admission/cancellation, post-replace and post-rename recovery, real child-process interruption, and an actual shipping worker offline negative under the final installed layout. Executable fixture storage must allow execution; Docker tmpfs defaults to noexec and must be explicitly configured only for this approved offline test.

The standalone entrypoint rejects unlisted sources/Directory.Build.targets, extra directories, special files and any symlink in source/SDK input trees or ancestor paths. It rechecks the copied source tree before compilation. Python optimization is rejected explicitly rather than silently disabling assertion-based integrity checks. Use ordinary python3, not python3 -O.
