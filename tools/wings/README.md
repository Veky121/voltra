# Wings installer result handling

For releases and node installation, use [WINGS.md](../../WINGS.md) and
`apply-release.mjs`. It applies the complete combined patch, including retained
failed-install logs. The partial tool below remains for historical reference;
do not apply both patches to the same checkout.

Wings v1.13.3 discards the Docker install container's exit code. Its panel callback reports success whenever Docker's wait operation itself succeeds, including an installer exiting with code 1. This can hide failed game downloads and mod updates.

This narrow MIT-licensed patch checks the actual wait response. Nonzero exits, Docker result errors, wait transport errors, missing results and cancellation fail installation. The native unsuccessful callback then lets the panel display `install_failed` or `reinstall_failed`.

Apply to a separate checkout of upstream commit `6987d5e6f0612133e031255a99655e822d30579a`, tag `v1.13.3`:

```powershell
node tools/wings/apply-install-status.mjs path/to/wings
```

Build from that checkout with the normal upstream Go build. Run `go test ./server -run TestVoltraInstallWaitResult -count=1` on Linux, or cross-compile the test binary for the target node. The helper source and test use `.go.txt` extensions here so they do not become packages in the panel's module. `install-status.patch` records the change to the upstream call site; the apply tool also copies the helper and its tests.

The tool does not install binaries, modify node configuration or restart services. Existing external Wings installations need this fix separately; the panel cannot recover an exit code that the daemon discards. The temporary acceptance node uses a separate patched binary and service override. The original host Wings service is unchanged.
