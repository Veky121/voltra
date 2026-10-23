# Eco, Foundry and FortressCraft source implementation

Owner `automation_sims` reserved only the three recipes absent from overrides:
`eco/egg-eco.json`, `foundry/egg-foundry.json` and
`fortresscraft_evolved/egg-fortresscraft-evolved.json`. The stage preserves all
54 original variables, in their original order (18/16/20), and their visibility
and editing permissions except allocated port selectors, which use existing
generic setup controls. No React component or shared helper was added/changed.

Run `node tools/runtime/stage-automation-sims-profiles.mjs` to generate
`.local/automation-sims/profiles.json`. Run
`node tools/runtime/test-automation-sims.mjs` for eleven network-free fixtures.
No native lease, download, boot, protocol, client gameplay or save/reinstall
acceptance is claimed by this source batch.

The scoped adapter imports existing typed Steam, native configuration, native
console and publisher/operator preservation helpers. Public Steam builds remain
dynamic: the shared installer records the actual app/build manifests when run;
this source phase does not invent a tested game build ID. Steam credentials,
private beta passwords and arbitrary install flags fail explicitly before
download, while their original fields remain present. They never silently fall
back to anonymous login. Runtime images are pinned by public registry digest;
their history confirms matching Debian12 bundled-Python hosts for Eco/Fortress
and a Debian13 Wine host already containing system Python for Foundry.

Eco downloads anonymous dedicated tool739590. The separate original SLG
account/license username/password are mandatory at startup and are passed as
individual native argv values with supervised output redaction. Both publisher
JSON files retain unknown operator keys and reject duplicate keys. Current
`Name`, `DefaultSlots` and `WebServerUrl` are supported, while original legacy
`Description`/`MaxConnections` are synchronized when present. All name/password,
public/UPnP, description/playtime, Discord/category/language, web/RCON and player
limit fields remain. JSON descriptions retain literal Unicode/quotes/newlines.
Original `exit` control is forwarded. Acquiring the tool anonymously does not
claim that an unlicensed server account can run it.

Foundry retains Windows2915550 and the original additional SDK1007 installation,
Wine/Xvfb/Mono controls and native console launch. The pinned stock Wine image
owns its original fixed Mono initialization; unsupported alternative verbs fail
clearly. The original `App.cfg` is seeded only when missing using the official
178-byte template with measured SHA256. All11 config controls remain. Typed
configuration uses official `mapseed`, synchronizing the old egg's `map_seed`
when present. Full unsigned64-bit seed text is retained without float conversion.
Save paths stay confined to this server and are translated to Wine's Z: mapping.
No Wine prefix/config/cache deletion occurs. Original Ctrl-C is forwarded;
actual Windows shutdown/console and game compatibility still require native
acceptance.

FortressCraft retains Linux443600 `linux_server_headless`, every world/difficulty
control, RCON/player/world/public/auto-pause and the original `G_RushMode` spelling.
Publisher INI examples seed missing files only. Lua-style annotations are cleaned
only in newly copied publisher examples; operator comments and unknown settings
remain. Native Unity output stays in `unity.log`, prior logs are archived rather
than deleted, and the supervised bridge preserves original noise filtering,
literal Unicode, credential redaction and final log draining. Original Ctrl-C
is forwarded. Native headless readiness and persistence remain untested.

Proprietary game binaries are fetched directly through Steam, not redistributed.
Referenced runtime images retain their own Wine/Mono/.NET/Python notices. New
adapter/fixture sources are MIT; no new third-party runtime code is vendored.

Primary references:

- https://wiki.play.eco/en/Server_on_Linux
- https://wiki.play.eco/en/Server_Configuration/Network.eco
- https://dedicated.foundry-game.com/
- https://dedicated.foundry-game.com/App.cfg
- Original imported upstream recipe checksums in `upstream/catalog.json`.

The fixtures cover all original typed config mappings, literal license argv,
allocation collisions/unallocated ports, unsafe paths/symlinks, malformed JSON,
private Steam rejection before downloads, Windows SDK/platform ordering,
operator/example retention, derived automatic update control and Unicode/log
redaction/draining. They do not simulate native success.
