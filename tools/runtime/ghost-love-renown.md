# Midnight Ghost Hunt, No Love Lost and Renown source checkpoint

These three exact imported recipes remain `not_verified`. No game/runtime assets were acquired, no native leases or game servers created, no accounts/credentials fabricated, and no production build or service changed. Go execution is held at root's request; the scoped Go fixture is written for later integration review.

Run `node tools/runtime/stage-ghost-love-renown.mjs`. It writes `.local/ghost-love-renown/profiles.json` and the scoped Renown seed JSON. It does not edit merged overrides. Existing shared React template setup, install/configuration APIs, Files, console and typed Steam helpers remain the interface.

## Original controls and corrections

All 34 original controls and visibility/editability are retained: 12 Midnight Ghost Hunt, five No Love Lost, 17 Renown. The sole approved default correction changes Renown's three mandatory port defaults from invalid `0` to blank automatic allocation. Their original rules required ports1024..65535 despite defaulting to0. Shared `allocated_value`, `auto_allocate` and `exclude_primary` metadata now select distinct same-address allocations, retain explicit valid operator values, and never interpret0 as disabling a native listener. The runtime requires resolved positive allocated roles before updating or starting.

Midnight Ghost Hunt retains the original Windows64 tool1118810, server/log/game/query/beacon/multihome flags, map, title, mode, region, bot difficulty, optional join password and additional native arguments. A map with spaces is one typed literal argument, fixing the old unquoted map expansion. Additional flags are parsed without a shell; managed ports/password/log overrides use their actual controls. Additional auth/token/secret values are redacted. Original config/custom rules/mod/admin files remain accessible through Files; the adapter does not invent undocumented configuration or RCON protocols.

No Love Lost retains original Windows64 tool2833050, client AppID1873120, game/query/servername/log and SDK1007 install behavior. Its publisher-documented optional `serverpassword` control is additive; blank retains the original public launch. Old logs are no longer deleted. Native configuration, saves, logs and mods remain operator-owned.

Renown retains app1512690 Linux, original project argument, game/query/beacon/RCON/log flags, exact public static EOS dedicated-server configuration from the original recipe and publisher-linked hosting guide, and all original typed Game.ini/Engine.ini fields. No EOS user account, replacement secret or auth bypass is created. Output redacts the static client values too. Original public/private visibility choices remain independent native values. Original `ChangeMe` administrator and `RconPassword` defaults remain visible but fail setup readiness until replaced; disabled RCON can clear its password. Native enabled RCON requires an actual operator password.

Renown's complete original installer seeds are used only when configuration is absent. Existing fields, comments, repeated administrator/ban/mod entries, map/save identity, gameplay multipliers, maintenance/decay, queue, party and networking settings are preserved. Native save identities cannot escape as paths. Config files containing secrets are private0600. No hardcoded new administrative password is generated.

## Installation and lifecycle

The Windows recipes use the existing private GE-Proton11-9 provisioner, pinned SHA256/SHA512 and unchanged distribution license files. Its publisher checksum was retrieved again and matches the existing helper. The Steam runtime image is digest pinned; Python bundles use the matching Debian12 installer. Proprietary game depots are mutable Steam releases with observed authoritative build/depot receipts, not falsely checksum-pinned game archives. Original account/auth/branch/beta-password/platform/install-flag inputs remain explicit; unsupported private transport or arbitrary installer commands fail closed before mutation.

Windows SDK1007 is acquired into a separate temporary installation with its own manifest. All three required Win64 DLLs must exist unambiguously, pass PE/x86-64 checks and fit a size bound before publication. Per-DLL SHA256 and the validated SDK manifest are retained beside the published SDK. A partial SDK publication restores already-changed previous DLL bytes/mode/timestamps or removes only newly-created owned leaves. Existing INI/CFG/TXT/JSON config bytes/mode/timestamps are restored even after later SDK/Proton failures. This is configuration/SDK publication rollback; it does not claim transactionally rolling back an entire Steam depot update.

The shared console preserves native stdin/output, private-value redaction and actual exit status. Stop forwards SIGINT to only the invocation-owned process group, with existing bounded escalation. The confined log follower emits only new native log bytes, handles rotation/truncation, redacts credentials across chunks, retains old logs and drains bounded shutdown diagnostics. No fake readiness/query/join/save event or undocumented save command is emitted. Exact original startup markers establish only their native initialization stage, not client connectivity, RCON compatibility or durable save proof.

## Evidence and sources

14 bounded offline Linux fixtures cover original argv/config controls, real-secret prerequisites, zero/duplicate/unallocated ports, private transport gates, custom settings/saves, exact failed-update configuration retention, SDK PE validation and publication rollback, log rotation/redaction and a real tiny subprocess's stdin/SIGINT/exit behavior. The process fixture is not a game server. Shared TypeScript allocation fixtures verify actual stage metadata, automatic three-role selection, preserved explicit values, wrong-IP and collision rejection. Original defaults/visibility are compared against the canonical imported recipes, with the three approved port corrections enumerated.

Primary documents and small OSS metadata snapshots are archived under `.local/ghost-love-renown/`, with exact URLs/checksums and retrieval failures in `provenance.json`:

- https://midnightghosthunt.com/news/2023/03/30/update-7-live-now (publisher's Windows dedicated server/custom-rule announcement)
- https://steamcommunity.com/app/1873120/allnews/ (publisher's March11,2024 dedicated server instructions, public tool and optional password)
- https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=1488310&count=100&maxlength=0 (publisher August2025 dev blog links its wiki and documents anonymous dedicated tools)
- https://rdbkstudios.fandom.com/wiki/Community_Server_Hosting_-_Linux (publisher-linked Linux hosting guide, read through browser source; direct archival fetch returned403 and is recorded honestly)
- https://github.com/GloriousEggroll/proton-ge-custom/releases/tag/GE-Proton11-9 (primary pinned runtime release; only small release/checksum metadata fetched)

The Renown EOS flags are preserved from the already imported recipe and independently match that guide. No third-party RCON controller is integrated or assumed wire-compatible. Native Windows/Proton compatibility, public listings, authenticated RCON/query, mods, player joins and real saves still require separate acceptance.
