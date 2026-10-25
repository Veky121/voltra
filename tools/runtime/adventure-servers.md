# Risk of Rain 2 / TerraTech Worlds source and Swords source gap

Only Risk2 and TerraTech canonical profiles are staged for root merge in
.local/adventure-servers/profiles.json. All19 original variables/defaults/rules/
visibility/edit permissions are retained (14/5). Existing generic React setup,
conditional service-port metadata/model, typed Steam/secure publication, common
private Wine prerequisites, immutable GE-Proton, native console and existing
rotation-aware log follower are reused. No Go, shared helper/UI/core/overrides or
production files were edited. No global checks, game/runtime acquisition or native
leases/resources occurred. All native behavior remains not_verified.

Run node tools/runtime/test-adventure-servers.mjs for13 network-free fixtures,
including an actual tinyPython child receiving SIGINT from shared supervision on
parent SIGTERM and exiting0. This is not Windows/publisher/save proof. Fixtures
also cover failed update restoration of config/save/plugin bytes/mode/UID/GID,
SDK publication rollback/receipt retention, Unicode roundtrip and path confinement.
Run scoped stager then test-adventure-servers-profiles.mjs for exact original
contract/20embedded module compilation and generic React model checks for both
Risk2 port modes. No production frontend build is involved.

Risk2 retains original Windows1180760, xvfb Wine launch, mono prerequisite, all
CVar settings, original server_startup.cfg and operator server_pregame.cfg. Typed
native command parsing preserves quoted semicolons/comments/custom commands,
quotes names/passwords, removes only recursive exec server/exact bootstrap copies
from server.cfg and keeps actual startup bootstrap intact. BepInEx/plugins/native
admin/mod/rule/save data remain operator-owned. Existing publisher dedicated-tool
compatibility with current clients/mods is unverified; no proprietary game-client
patcher is injected and no recommendation that arbitrary client mods are server
compatible is made.

Approved PORT_MODE=allocated|original defaults allocated. Allocated mode explicitly
ignores original QUERY/STEAM raw values and uses primary+1/+2 from three assigned
consecutive ports. Raw original defaults/permissions remain, and the setup field
clearly says they are NOT APPLIED in allocated mode. Original mode applies both
exact original values, validates Steam=query+1 and permits a nonadjacent primary.
Conditional generic port metadata supports both without forcing global primary
adjacency. .voltra/adventure/risk-ports.json records actual mode/applied ports and
whether original fields were applied. This is interim source compatibility, not
native protocol or gameplay evidence.

TerraTech retains original Windows2533070 through the existing immutable private
GE-Proton helper/prefix/licenses, native TT2 executable/-log and root
steam_appid.txt2313330. A conflicting operator app identity is retained and fails
clearly. Original JSON Port/Password/SlotCount1..6 controls remain; newer publisher
8-player documentation does not silently change the original maximum. Unknown
JSON fields, TT2/Saved/save/admin/mod/operator data remain. Duplicate keys and
unsafe links fail clearly. Logs are archived/streamed with Unicode/secret
redaction/rotation/truncation and bounded final drain rather than deleted.

Original SteamSDK1007 x64 DLLs are staged in an isolated temporary tree and
validated before publication. No SDK manifest reaches game steamapps. Unknown or
edited DLLs remain operator-owned; authoritative SDK receipts claim only actual
published files, and only unchanged owned files can update. Failed publication
restores replaced bytes and prior receipt. Original Linux SDK paths remain.
Unsupported private Steam accounts or beta passwords fail before any game/runtime
acquisition; they never silently become anonymous. Added operator_files mode
structurally checks legitimately supplied original binary/content/SDK and records
separate SHA/size inventory without claiming ownership, license/publisher
verification, complete-depot integrity or runtime success.

Both stops use actual SIGINT through native-console stop_signal, not literal ETX,
chat input or raw exit. The publisher/game save semantics, Windows/Proton process
lifecycle, runtime/game build identity, native protocol, real joins/mods and
save/reinstall still need separate acceptance. Native readiness markers are
inherited as unverified original behavior, not source-test readiness proof.

Swords is intentionally NOT in the canonical stage. The separate
.local/adventure-servers/profiles-swords-research.json preserves all13 original
variables and the exact original egg, with stage_status=source_blocked and
available=false. artifacts/swords-source-blocked.json identifies the six missing
native consumers and exact schema inputs needed. The original recipe declares
SNM name/admin/password/players/reset-days/reset-time but config_files is empty and
its installer overwrites Game.ini after backup. That original bug is not a feature
to preserve. No guessed native fields/section or synthetic schema consumer is
shipped in the production adapter. A private discarded prototype is diagnostic
only and is not an authoritative publisher schema or ready profile.

The developer's primary Steam discussion says documentation is inside the Steam
package and Discord, rather than a public website. Bounded public publisher news
also confirms that default server name was omitted from the template and allowed
words are generated on boot; it does not expose native key/section names. Actual
legitimate Dedicated-Server-Game.ini and publisher README are still required to
wire every original setting truthfully. No credentials/account/license bypass or
game binary acquisition was used to obtain them. Swords remains open source work,
not source-complete, ready or runtime-verified. Reproduce its separate report with
node tools/runtime/stage-swords-source-gap.mjs.

All three exact original JSON archives match catalog commit
c637a6d1e0449b167efeff81bb9a0177aa3df6c2 under .local/adventure-servers/upstream.
Public primary references and immutable runtime identities are in the scoped pins
and blocked artifact. Original MIT recipe license and upstream runtime licenses
remain; no proprietary binaries are redistributed.
