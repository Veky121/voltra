# Parallel native acceptance

Generate the catalog queue with `node tools/runtime/batch-plan.mjs`. This reads
the pinned imported catalog and current checklist without changing either.
Existing reviewed profiles and root's DST work are reserved. The plan proposes
families, not compatibility guarantees. Every queued recipe still needs review.

`batch-queue.mjs` stores ownership and leases in `.local/game-batch/queue.json`.
Set `GAME_BATCH_STATE` only when intentionally using a separate node pool.
All workers sharing one node must use the same state file and limits.
The current local node 202 pool permits at most seven active leases within
20480 MiB of RAM and 131072 MiB of disk, including a 20480 MiB cache reserve.
The count limit never overrides the weighted memory or disk checks.
Mutations hold an exclusive filesystem lock and replace state atomically.
A lock left after a crash requires owner inspection; leases never expire by
time alone because the corresponding container might still be alive.

Reserve recipe ownership before editing:

```powershell
node tools/runtime/batch-queue.mjs reserve '{"owner":"source_games","game":"counter_strike/counter_strike_source/egg-counter--strike--source.json"}'
```

Before installing or starting, claim an explicit resource and port lease:

```powershell
node tools/runtime/batch-queue.mjs claim '{"owner":"source_games","game":"counter_strike/counter_strike_source/egg-counter--strike--source.json","memory_mib":4096,"disk_mib":16384,"ports":10,"limits":{"memory_mib":20480,"disk_mib":131072,"max_active":7,"port_min":28000,"port_max":28999}}'
```

Use returned ports for the owned node's allocations. These are bookkeeping
leases, not operating system socket reservations. The node owner must reserve
the pool exclusively, and provisioning must reject any actual occupied ports.
Port-constrained games such as DST need a separate coordinated pool; never
silently substitute an arbitrary port range. Server limits must fit the lease.
Installer and runtime share the same active lease. Reserve realistic total disk
space including the Steam download/update staging overhead.

After stopping and deleting the owned server, volume and allocations, release:

```powershell
node tools/runtime/batch-queue.mjs release '{"owner":"source_games","lease_id":"RETURNED-ID","outcome":"tested","resources_removed":true}'
node tools/runtime/batch-queue.mjs status
```

`tested` records finished work only. Root reviews native evidence before any
catalog verification change. `blocked` retains the finished recipe assignment
for review; `released` permits another attempt. Explicit `requeue` with owner and
lease ID reopens a cleaned `tested` or `blocked` attempt and retains its previous
outcome. Disk limits reserve 20480 MiB for shared caches by default, configurable
through `limits.reserved_disk_mib`. The 128 GiB pool permits 108 GiB of
active server/staging leases. No outcome deletes runtime
resources. Preserve private receipts and failures separately from final evidence.

Memory can be reduced for offline preparation without releasing the disk or
ports. First verify that both native server and installer are stopped, lower
the actual panel memory limit, and confirm it. Then atomically resize its lease:

```powershell
node tools/runtime/batch-queue.mjs resize '{"owner":"source_games","lease_id":"RETURNED-ID","memory_mib":1024,"stopped_confirmed":true,"limits":{"memory_mib":20480}}'
```

The lease stays active and retains its original disk/port reservations. Its
history records the old and new memory values. Before native boot, reacquire
the full required memory atomically, then restore and confirm the panel limit.
A failed reacquisition means the game must remain stopped. Never start a game
with its temporary preparation limit or claim that resizing released its disk.
For the current Enshrouded receipt, `additional-survival-enshrouded-memory.mjs
stage|native` coordinates these ordered checks and updates. Native boot requires
both the 12288 MiB lease and the matching panel limit.

A publisher-required port outside the common pool needs root coordination and
read-only checks of all container bindings, host sockets and node allocations.
For a confirmed stopped server and installer, `replace-port` atomically swaps
one port in the same owned active lease. It retains memory, disk and job count,
rejects collisions with active leases, and records the old/new ports. Pass an
explicit reviewed range in `limits.port_min` and `limits.port_max`; for the
Avorion native-query exception both values are 27003. Update only the owned
allocation afterward and keep the baseline checks with its receipt. This does
not expand the common pool or permit editing queue state by hand.

Suggested disjoint workers are Source/GoldSrc games, small native engines,
GitHub/release services, and Steam survival games. Current explicit assignments
are in state reservations and take precedence over these suggested families.

Reuse Docker image layers and checksum-addressed public release archives.
Resolve mutable image tags to digests for acceptance. Share a single SteamCMD
bootstrap cache; key game content by app, branch, build, platform and depots.
Copy or reflink cached immutable content into separate writable volumes.
Never share writable game installs or cache credentials, tokens, generated
configuration, world saves or per-server keys. Cache hits do not count as clean
download evidence; record the original acquisition and content identity.

Checks: `node --test tools/runtime/batch-queue.test.mjs`.

Utilities use `claim-utility`, or exported `claimUtility` inside the same atomic
`transact` wrapper. Supply a short `task` and `owner`, explicit memory/disk/port
counts and the normal pool limits. Do not supply a catalog `game` or invent an
egg for a parser/dependency probe. A utility with no listeners uses `ports: 0`.
Utility rows have `kind: "utility"` and consume the same RAM, disk reserve and
active-worker budget as game rows. The normal cleanup confirmation and owner
checks still apply before release; a utility lease does not authorize unrelated
acquisition, account login or service changes.

The named disposable Wings daemon disables automatic crash retries so the first
native failure remains observable. Existing daemons require a coordinated idle
window: `batch-crash-policy.mjs prepare` checks the receipt, live node UUID,
configuration mount, ownership label and all running game-volume mounts before
producing a plan. `apply` rechecks that plan, saves the private original config
and refreshes only that owned daemon. It never targets the Panel or Docker
service. Verify each server's actual Wings `crash_detection_enabled` afterward;
a configuration file alone does not establish the live setting.

After merging staged profiles, run `node tools/runtime/audit-profile-python-source.mjs`
to compile embedded Python without executing it and compare known helper copies
with their current source files. This uses the existing local Python Docker image
with no network or writable mounts. Run the import and variable audits separately;
none of these checks replaces native game acceptance.

When a shared helper changes, coordinate a source freeze with its owner first.
Preview an exact embedded-helper refresh with
`node tools/runtime/refresh-profile-helpers.mjs steam_template` and add `--apply`
after reviewing the changes. Supply only the reviewed helper module names.
This preserves recipe variables, revisions and recorded verification details;
it does not establish that previous native evidence covers the new helper.
Run the Python source audit and the affected regression tests afterward, and
record any newly unsupported paths explicitly. The refresh rejects a source
line that would terminate its surrounding shell heredoc.
