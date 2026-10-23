# Reviewed Java game adapters

`stage-java-games-profiles.mjs` writes `.local/java-games/profiles.json` for root
integration. It preserves the live profile verification/detail metadata and
keeps every original imported variable. It does not modify the shared overrides
file. All three recipes use the existing React template form.

| Recipe | Runtime | Allocated ports |
| --- | --- | --- |
| Necesse | Publisher bundled Java | One gameplay port |
| StarMade 0.305.11 | Pinned Temurin 21.0.13+9 | One gameplay port |
| Rising World Java legacy | Pinned Temurin 8u504 | Gameplay minus one through gameplay plus four, plus separate RCON |

The initial StarMade Java 8 candidate failed with class major 65. Its failure
and cleanup evidence remain in `artifacts/starmade-java8-development-*.json`.
Java 21 is specific to the inspected current StarMade archive; it must not be
applied to the older Rising World Java recipe by analogy.

Run `node tools/runtime/test-java-games.mjs` for configuration confinement,
literal argument handling, heap sizing, port layouts, properties preservation,
archive traversal rejection and failed-install configuration restoration tests.
The runner uses a small local Python Docker container without networking.

The two Temurin archives and StarMade release are pinned in
`internal/panel/game_library/scripts/java-games-install.py`. Their distributions
retain the included licenses/notices. The public StarMade archive and Temurin 21
archive have also been seeded into the shared checksum cache. Installer-local
download reuse rechecks the full digest before using an existing archive.

`tools/game-query/NecesseQuery.java` sends a native status request using the
matching publisher `Server.jar` classes. Compile it with a compatible JDK and
run beside that distribution's `locale/` directory. It validates the challenge
and peer and reports the native version, slots, password flag and world ID.
It creates no player session. Publisher binaries are private test inputs and
are not vendored into the source tree.

Native results and their limits live in `artifacts/*-live-acceptance.json` and
the separate cleanup receipts. Fixture success and staged profiles alone do
not establish native runtime compatibility.

`RisingWorldRcon.java HOST PORT` is a bounded read-only probe using the matching
publisher `lib/rcon.jar`, `lib/JIW-NewNetwork.jar` and Netty distribution. Compile
for Java8 compatibility; the acceptance run executes it from Windows against the
Linux server's allocated RCON TCP port. Supply the password on stdin. It reports
only authentication and maxplayers, discarding the native server-info packet's
plaintext join-password field. It sends no administration mutations or player
session. The publisher TCP-only RCON connection sends login immediately after
connect rather than waiting for gameplay UDP completion. Both correct-password
info and wrong-password rejection were tested natively.
