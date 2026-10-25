# Swords actual-publisher source implementation

The canonical Swords profile is staged independently in
.local/swords-server/profiles.json. All13 original variables/defaults/rules/
visibility/edit permissions are retained. Existing generic React setup/service
ports, typed Steam/publication/preservation, common private Wine prerequisites,
rotation-aware log follower and actual native-console SIGINT supervision are
reused. Frozen Risk2/Terra source/helper profiles were not edited or restaged.
No Go/global checks or production service/frontend changes were performed.

Authoritative correction: the earlier suspicion that the six SNM variables had
no consumer was wrong. The actual publisher README explicitly documents native
environment inputs, taking precedence over Game.ini. Empty original config_files
was not evidence of an original missing-consumer bug. The source-blocked report
is retained as a historical snapshot, explicitly superseded by
artifacts/swords-publisher-schema.json and current source fixtures. No guessed
native section/key mapper is used or shipped in the new adapter.

Authorized research used a1GiB/2GiB owned utility lease, the already-reviewed
public SteamCMD cache and SteamRE DepotDownloader3.4.0 framework artifact (GPL2,
official GitHub HTTPS, measured SHA256 provenance). Anonymous public dedicated
entitlement succeeded for2058450. Initial Steam appinfo identified public
build22822160/depot2058451/manifest1842565876521966140. Manifest-only acquired zero
game content bytes. An exact filelist then acquired only four publisher text
files totaling9263uncompressed/4208compressed bytes, below the authorized16MiB:
CustomPorts1046, Engine.ini71, Game.ini316, README7830. Each matched Steam manifest
SHA1, with independent SHA256 captured. No game executable, assets, client,
Windows/Proton runtime or private credentials were acquired, and no game started.

All three exact owned utility containers were removed, the178738338byte temporary
directory removed/absence verified, and lease3032a88f-8f54-4bb0-b3ee-1037498b2609
released. No Panel server/egg/allocation/API resource was created. Cleanup proof is
artifacts/swords-schema-utility-cleanup.json. Exact text bytes remain privately in
.local/swords-schema/publisher-documents; no publisher redistribution license is
assumed, and README/config bodies are not embedded in the tracked package.
Tracked pins contain only functional schema facts and primary acquisition hashes.

Actual publisher mapping under
/Game/Blueprints/GameModes/BP_GameInstance.BP_GameInstance_C is:
SNM_NAME=>DedSrv_Name; SNM_OWNER_STEAM_ID=>DedSrv_OwnerSteamID;
SNM_PASSWORD=>DedSrv_Password; SNM_MAX_PLAYERS=>DedSrv_MaxPlayers;
SNM_DAYS_UNTIL_RESET=>DedSrv_DaysUntilReset;
SNM_RESET_TIME_OF_DAY=>DedSrv_ResetTimeOfDay.
The adapter validates/pass-throughs these six exact native environment names.
Blank name retains publisher native default/config handling; absence of the native
DedSrv_Name field permits random naming. Name shape2-5case-insensitive unique
words is validated; membership in the dynamic generated allowed list is left to
the publisher game, not guessed from static example words. Additional native
reset-warning ENV and existing config arrays remain intact.

Installation copies the actual installed publisher template only if Game.ini is
absent; never moves the template or overwrites existing operator Game.ini. The
old installer's reset-after-backup behavior is fixed. Successful and failed update
fixtures retain config/reset-warning arrays/admin/moderator/save/plugin bytes,
modes and ownership. Launch does not patch/reset Game.ini; ENV precedence is
explicit. Native edits remain available via existing file APIs, with publisher
instruction to edit config only when stopped.

Original -port/-QueryPort CLI is confirmed by actual CustomPorts.txt and Engine
config. Approved explicit PORT_MODE allocated|original defaults allocated.
Allocated uses another selected same-address port and explicitly does NOT apply
raw QUERY_PORT; original applies the exact original value/default and requires
that allocated port. A password-free runtime-source receipt records actual roles,
ENV-name transport/precedence and no launch config writes. Both generic React
port modes are fixture-tested without shared UI changes. Win64 native binary
requires win64; original raw win32 option/rules remain but fail clearly rather
than pretending it runs the publisher's64bit binary.

Original Windows dedicated2058450/AUTO_UPDATE/Wine architecture/debug/path and
vcrun2019 controls remain. Common typed hooks suppress stock shell updates/tricks;
explicit runtime-license acceptance precedes private-prefix prerequisite setup.
Unsupported private Steam accounts/beta passwords fail before acquisition, with
no silent anonymous substitution. Lawful operator-files mode structurally checks
original x64 server/SDK/content/template and records separate SHA inventory;
it grants no ownership, authenticity, license, complete-depot or native proof.

Original UE SNM2020.log is streamed and archived rather than deleted. Newly
created publisher SnMDedSrv-<timestamp>.log files are also streamed; historical
publisher logs remain. Shared follower provides rotation/truncation/Unicode/secret
redaction and bounded drain. Original no-input wrapper behavior gains no fake
RCON/chat support. Stop is an actual owned-process SIGINT, not literal ETX or raw
exit. Publisher save behavior and Windows/Wine process lifecycle remain unverified.

Run node tools/runtime/test-swords-server.mjs for10 network-free source fixtures.
Run node tools/runtime/stage-swords-server-profile.mjs then
node tools/runtime/test-swords-server-profile.mjs for13-original-control contract,
10embedded Python module/exact-source checks and both generic React port modes.
Earlier Risk2/Terra fixture independently exercised real SIGINT on a tinyPython
child; these source checks remain distinct from a publisher server boot. No
protocol/client join/mod/admin/save/reinstall acceptance is claimed. Verification
stays not_verified pending actual native acceptance; the source-schema blocker
has been resolved using real primary evidence.
