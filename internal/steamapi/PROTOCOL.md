# Steam connector protocol v1

The node advertises `{"type":"hello","capabilities":["steam-v1"]}` on Linux amd64. Other platforms send an empty capabilities array. An open control message adds `service:"steam"`; an absent service continues to mean Wings. Unknown services are rejected.

Each Steam stream carries one HTTP `POST /run`, JSON body `steamapi.Request`, then an `application/x-ndjson` response of `steamapi.Event`. Request and event fields are exactly those in STEAM_IMPLEMENTATION_CONTRACT.md. There is exactly one terminal `result` or `error` event. Validation failures use HTTP 400 with one error event; valid jobs stream HTTP 200, including executor failures. No extra TCP listener or Config fields.

`steamexec.New() *Executor` constructs the production executor. `(*Executor).Run(context.Context, steamapi.Request, func(steamapi.Event) error)` emits the terminal event itself. Disconnect/cancellation stops and removes the helper. The idempotency key is JobID + Operation: a completed phase replays its stored terminal event; changed input for an existing phase fails. A root job may check then update using the same JobID. Interrupted phases fail with FilesChanged=true for mutations and require a new job ID to repair. Never blindly retry a mutation using the same phase ID.

Completed read-only check receipts expire after seven days or when their count exceeds 2048, oldest first. Replaying an expired check executes a fresh read-only check. Pruning acquires each candidate server lock and revalidates the receipt; pending/recovery records, mutation phases, records reporting changed files and all config snapshots are retained. Mutation admission has a separate limit of 20000 protected receipts with an operator archive error; checks continue at that limit. Unrelated lock files and completed hourly checks do not consume mutation capacity.

Check mounts no game directory into its metadata helper, reads the installed manifest through the host, and works while running. Mutation uses SteamCMD app_update, with validate only for verify. Existing saves/config are not deleted or recursively chowned. Runtime configuration files under Pal/Saved, FactoryGame/Saved and .config/Epic/FactoryGame/Saved are snapshotted durably and restored after success, failure or interruption. Logs/crashes and shipped Engine/Config/default templates are excluded; DefaultPalWorldSettings.ini can update normally. Bounds are 4096 configs, 8 MiB/file and 64 MiB total; unsupported symlinks or excessive configs fail before mutation. Unknown app IDs require a reviewed preservation policy before mutation. Saves and unmanaged files remain in place. Panel must hold its per-server power/mutation lock through the terminal event. The node also checks Docker state before mutation and cancels a helper if the game starts externally. External Docker/Wings starts can race this polling; the shared Panel power lock is required.

Production paths are local constants: Wings configuration /etc/voltra/wings.yml and journal /var/lib/voltra/steam-jobs. Native Linux amd64, a local Docker daemon and anonymous Steam access are required. No credentials or paths are accepted over this protocol.

Stock Wings installs in `UUID_installer`, which [its installation code](https://github.com/pterodactyl/wings/blob/develop/server/install.go) creates separately from the runtime container. If Docker confirms the UUID runtime container is absent and its installer is inactive, initial installation falls back to `system.data/UUID` from the root-owned local Wings configuration. The configured data root must be root-owned and not group/world writable; the UUID directory must already exist. Both config and game paths reject symlink components. Only initial install with no existing Steam appmanifest may change a root-owned UUID directory to the explicit non-root system.user.uid/gid from trusted Wings config. The change uses a verified directory descriptor and never recurses. Missing UID/GID, existing installs, running games and rootless mapping require operator configuration. No game/container is started to discover paths.

Successful mutations copy SteamCMD's current native steamclient.so into `.steam/sdk64/steamclient.so`, `linux64/steamclient.so` and `steamclient.so` using the game UID. Launch-only eggs need no SteamCMD startup command. Helpers use the documented [SteamCMD image](https://github.com/steamcmd/docker), pinned to the tested ubuntu-24 image digest.

Generated node units retain ProtectSystem=strict and ProtectHome=true. Their exact writable paths are the connector config directory, /var/lib/voltra/steam-jobs and configured Wings system.data. Setup precreates the journal, accepts the exact previous generated unit for migration and refuses custom units. /home, /root, /run/user and symlinked storage paths are rejected with guidance. Updating only the connector unit does not restart an already configured Wings service; credential recovery still restarts Wings. Unit generation/migration and command selection have Linux tests; actual systemd sandbox enforcement has not been exercised here.

## Game-specific node compatibility

New connectors advertise steam-profiles-v1 and one steam-app:<app_id> capability for each compiled preservation policy. The shared steamapi profile registry supplies both those capabilities and the executor's protected paths. Panel options, job submission and scheduled maintenance check the target game's capability before mutation. A legacy steam-v1-only connector remains compatible with the original Satisfactory and Palworld profiles; newer profiles require upgrading the node. The stream protocol and local-only credential/path rules are unchanged.

## Console output

`steam-console-v1` advertises opt-in `stream_output:true`. New panels request it
only from nodes that advertise it. Legacy requests still receive progress and
terminal events only. Streaming does not change durable job identity.

During anonymous checks/install/update/verify, stdout and stderr are framed on newline
or carriage return into `output` events with a `lines` array. Batches contain at
most 32 lines and 16 KiB before JSON encoding; individual lines are at most
8192 UTF-8 bytes. Terminal controls and credential-related lines are stripped
or redacted before transmission. Partial lines are bounded and flushed at exit.
Metadata-helper startup output is included; its VDF output remains internal. Private account jobs expose fixed safe
stages, never raw authenticated worker output or Guard responses.

Output stages are `steamcmd` for client bootstrap/self-updates, `metadata` for
branch checks after the client is ready, and `executing` for game maintenance.
Panels preserve and validate this phase instead of classifying generic
"Downloading update" text as a game download. The console labels these phases
`SteamCMD`, `Steam check`, and `Steam game`. Older console-capable nodes continue
to send their existing `metadata` and `executing` stages.

Anonymous helpers retain the Steam client under the node's private Steam job
directory in `client-cache`. Metadata uses a root-owned cache with no game mount;
mutations use a separate cache per server UUID and numeric owner. Cache locks
serialize self-updates and are held until the helper is stopped. Temporary home
files remain ephemeral; game content stays in the existing `/data` mount.

The panel writes streamed lines and stage/completion events to the existing
bounded console archive as `steam output`. They remain visible while Wings
capture is disconnected and after reopening the console. Colors are generated
by the panel, not accepted from command output. A cancelled or lost job lease
cannot append streamed output. Existing maintenance controls and job summaries
remain available.

## Validation and private branch boundary

`steam-options-v1` advertises the optional typed `validate` request flag. Verify
always validates; install/update validate when requested. Older nodes must be
upgraded before the Panel accepts this flag.

`steam-private-branch-v1` is reserved and is **not advertised**. The optional
`beta_password` field is bounded to 1024 UTF-8 bytes, excluded from durable
request journals, and currently fails closed before Docker or journal access.
The helper independently refuses it as well. Native SteamCMD reparses argv using
its own command language; raw argv and ordinary shell/C-style quote escaping
have failed fidelity probes. Until a complete native codec is proven, private
branch/account credentials are unavailable in both managed and shared Python
installers. Public anonymous and password-free branch behavior is unchanged.
Encrypted Panel storage and configured-only status fields do not constitute
native private-branch acceptance.
