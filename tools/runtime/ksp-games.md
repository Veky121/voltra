# KSP multiplayer servers

Both catalog recipes use the existing game template React form. No KSP client
assets are downloaded and no client gameplay acceptance is claimed.

The runtime is pinned .NET10, with private source provenance under `.voltra/ksp`.
The root-user Microsoft .NET10 SDK installer is deliberately separate from the
nonroot runtime yolk: Wings installer script directories are root-owned.

## DarkMultiPlayer

Pinned official v0.3.8.5 source commit
`8253dc8e4f40e4519c085c3ee223abecd1a52954` and its three exact gitlinks are
compiled for .NET10. The source adaptation sets socket DualMode only for IPv6
and leaves the console reader as a background thread rather than using obsolete
Thread.Abort. Native shutdown still joins the client thread and flushes state.
The MIT license, complete source and exact patches remain available privately.
This modified server reports `Custom`, preserving protocol54. It is not the
unchanged upstream release binary.

The unchanged upstream compression buffer reserves1GiB on startup. The default
RAM is therefore2GiB. Original modpack/warp/game/difficulty/whitelist/name fields
remain available. Gameplay needs its original allocation; optional HTTP status
requires a second selected allocation because gameplay also uses TCP.
Preserve `Config/` and `Universe/`. Stop sends the native `/exit` command.

## LunaMultiplayer

Pinned official0.29.2 source commit
`60a2ed5dbfdddc08536a98b999c781e3c12b0649` is explicitly modified: .NET6/5
targets and the major runtime checker move to .NET10; obsolete Framework
serialization-copy build logic is removed; HTTP response lines use RFC CRLF.
The native CtrlC handler suppresses default SIGINT termination so backups and
normal shutdown finish. The launcher decodes actual UTF8/UTF16 bytes because
upstream XML files can declare utf-16 while containing UTF8 data.
ProDotNetZip1.19.0 replaces DotNetZip1.15.0, Newtonsoft.Json13.0.4 and
log4net3.3.0 replace the old dependencies. Complete source, upstream license,
exact source patch and compiled binary digest remain under `.voltra/ksp`.
Some upstream compression/config libraries still target .NET Framework and
produce NU1701 compatibility warnings; client protocol interoperability is not
proved by server-only acceptance.

Blank LMP_VERSION chooses pinned0.29.2. Exact public release tags resolve to
their source commit and receive the same explicitly checked adaptation. An
older unsupported source layout/runtime guard fails with an explanatory error;
there is no silent runtime fallback or promise that all historical releases work.

Original mixed-case API variables are retained. Wings uppercases environment
keys; the launcher accepts those equivalents and rejects conflicting values.
Preset changes archive old GameplaySettings.xml once; Custom retains detailed
settings. Preserve `LMPServer/Config/` and `LMPServer/Universe/`.
HTTP TCP status and UDP gameplay can share the primary allocation. Public
master listing and UPnP default off. Native Stop uses the actual PTY CtrlC path
and the server's Console.CancelKeyPress graceful backup/shutdown handler.

Reinstallation trusts Git only at exact private source checkout paths, including
the three pinned DMP dependency paths. It never configures a global wildcard.
User configuration/universe files are not replaced by rebuilt binaries.
