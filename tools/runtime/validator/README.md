# Game validation workflow

Run from `ptero-go`, Node 22+, Docker Desktop Linux. Existing campaign panel/Wings must be running. No npm install needed.

```powershell
node tools/runtime/validator/campaign.mjs --campaign-root C:/Users/Veky/.t3/projects/pteroclone/ptero-go --games openttd,terraria,paper,folia,purpur
node tools/runtime/validator/campaign.mjs --campaign-root C:/Users/Veky/.t3/projects/pteroclone/ptero-go --games fabric,quilt --retry fabric,quilt
node tools/runtime/validator/campaign.mjs --campaign-root C:/Users/Veky/.t3/projects/pteroclone/ptero-go --games fabric,quilt --retry fabric,quilt --retention
node tools/runtime/validator/shared-suite.mjs .local/validator-campaign/manifest.json
node tools/runtime/validator/runner.mjs --enqueue MANIFEST --retry GAME
node --test tools/runtime/validator/*.test.mjs
```

Adapters: OpenTTD, Terraria, Paper, Folia, Purpur, Fabric, Quilt, NeoForge, Forge, Krypton, VanillaCord, Canvas, SpongeVanilla SpongeForge, Arclight, Mohist, Magma, Spigot, Teeworlds, CS2D, OpenArena, Xonotic, Luanti, ET Legacy, AssaultCube, Quake Live, Barotrauma, Soldat, DDRaceNetwork, Space Station 14 Half-Life 2: Deathmatch, OpenRA Red Alert, SuperTuxKart, Unturned, CrewLink, Impostor, Valheim, Zandronum, Sven Co-op, GTAC, Fistful of Frags, CS2 and CS 1.6 ReHLDS. Inclusion means an adapter exists, not that its latest test passed. Add recipes in `campaign.mjs`; native behavior in `game-checks.mjs`.

The queue verifies the served build and excludes the old scheduler, provisions isolated fixtures, records installer exit/callback/logs, then checks readiness, files, settings consumption, stop/save and same-world reload. It parks fixtures offline without deleting files. Shared tests cover file operations/permissions, scheduler execution, and backup/restore content once per build/suite hash.

## Agent rules

1. Run the queue; read compact reports, not every log. Never claim gameplay/WAN or full catalog parity from operator checks.
2. Cap at 16 jobs and 4 installers, subject to live Windows/VM RAM, CPU and disk. Keep 8 GiB available RAM and 32 GiB disk. Reserve the current phase's expected peak and additional disk growth; completed installs already consume measured free disk. Recommendations are not test reservations. Native tests use unlimited runtime memory; JVM heaps are 2 GiB. Canonical setup may validate recommended limits, then must release them before native diagnostics. Installers use a reviewed cap (CS2: 8 GiB) or the VM ceiling; Docker update-to-zero does not remove Wings' 128 MiB default.
3. Missing key/license/manual action: `WAITING_FOR_USER`, preserve fixture/logs, continue. Accept EULAs under the user's recorded authorization; log URL/time/method. Never buy licenses or claim ownership. Report user actions together at the end.
4. Group technical failures by cause. Dispatch at most 3 isolated GPT-6.1 Sol / low-reasoning repair agents, one attempt per cause. The coordinator uses the delegation tool; the script never launches model sessions. Use actual publisher config and panel responses in focused regressions. Pin emitted helpers from the frozen installation script, not source templates; compile generated Python/Node probes before a live retry. Review/integrate fixes into a known build, then `--retry` affected games. Never weaken assertions to pass.
5. Reuse matching passes and successful installs. Keep failed attempts. Changed inputs make a prior pass stale without erasing historical evidence. Inspect failed phases before deciding which checks need repeating.
6. Only touch exact owned fixtures. Failed parking stops admission and aborts other tests cooperatively. A crash leaves locks: verify the process and owned containers, record recovery, then remove only those locks. Never reclaim by age.
7. An active manifest with `allowEnqueue:true` accepts explicit retries through the inbox command above. Keep that manifest immutable, repair source, enqueue affected IDs, and inspect the acknowledgement. Never start a second pool coordinator.

## Reports

Under `.local/validator-campaign/`:

- `all-games.json`: latest known result per game across batches.
- `actions.json`: unresolved cases and preserved server IDs.
- `repairs.json`: grouped failures for the coordinator.
- `<game>.json`, `<game>/`: checks, ownership, logs, EULA receipts.
- `history/`, `source/`, `telemetry.jsonl`: earlier attempts, hashed source bytes, host samples.
- `shared-platform.json`: shared API evidence and retained test resources.

Exit 0 means selected games passed; exit 1 means unresolved cases. Existing non-pass attempts need explicit `--retry`. Read each result's scope before promoting catalog acceptance.

## Next batches

1. Review the selected queue and shared suite. Separate actual, reused, failed and user-blocked evidence.
2. Port the next smallest family using existing receipts and publisher behavior. Require fresh log boundaries, actual setting readback and save identity; timestamps alone do not prove persistence.
3. Use `--retention --retry <ids>` for the separate registered-family reinstall gate on parked, previously passed fixtures. It compares hashes, modes and ownership of existing worlds/config/mod/plugin files before and after the canonical installer, then checks native world identity, gamerule and capacity without redoing file/platform tests. Original lifecycle reports remain in history. Only registered retention adapters are supported. Use close-retention.mjs CAMPAIGN_ROOT GAME after reviewing a pass to close an exact sole remaining reinstall gate; it preserves the prior checklist row and copies hashed evidence.
4. Reconcile reviewed results into the catalog ledger. Do not blindly add these passes to the older checklist count.
5. Imported test eggs can fall back to generic settings discovery because they lack catalog recipe identity. Keep game-specific setup UI checks open until tested through the canonical catalog route; native settings consumption alone does not close them.

Custom adapters implement `verify`, `run`, `park`, honor `ctx.signal`, persist ownership with `ctx.own`, and record real evidence through `ctx.check`. The local-native monitor is for non-VM hosts; the campaign monitor measures both Windows and Docker's VM.


