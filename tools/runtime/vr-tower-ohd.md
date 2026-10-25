# Tower Unite, Pavlov VR and Operation Harsh Doorstop source checkpoint

All three profiles remain `not_verified`. There was no game acquisition, native game process, client connection, authenticated query/RCON, durable game-save test or lease. The offline tests exercise typed configuration, actual subprocess signal handling, preservation and failure gates, not game compatibility.

Run `node tools/runtime/stage-vr-tower-ohd.mjs` to stage the three exact imported recipes. The shared React template form, Files, installation API and console remain the interface. All original 6/6/9 variables retain defaults and visibility. Original Pavlov `CHANGE_ME` remains its default but fails shared readiness validation until replaced. Required API/Steam/Tower tokens and administrator identity are actual operator inputs. No accounts, keys or credentials were created.

The three native Linux dedicated Steam tool identities are 439660, 622970 and 950900. These are proprietary mutable depots; shared Steam receipts record observed build/depot manifests rather than falsely claiming a fixed game archive checksum. Public branches and update controls remain. Original implicit private Steam, beta password, installer flags and platform fields remain explicit prerequisites where the supported shared transport cannot implement them safely.

Tower keeps the original no-map startup and custom INI path in legacy mode. Current condo mode is additive and requires both real publisher tokens and an operator-exported map. Repeated administrator lines, existing condo filename, native permissions, bans, saves and backups remain. The original hidden 40-player default and 512 API maximum remain; that does not promise the publisher supports 512 active clients. Current publisher documentation recommends lower limits. No full Plaza/AGC or Workshop collision compatibility is claimed.

Pavlov preserves repeated map rotations, mod.io IDs, additional mods, visibility, administrator/ban/whitelist settings and the original publisher wrapper. Original config templates are seeded only if absent, from pinned source revision c637a6d1e0449b167efeff81bb9a0177aa3df6c2 with SHA256 validation (see `vr-tower-ohd-releases.json`). The sample fake API key is replaced before launch. Its RCON protocol is not assumed to be Source RCON: the publisher-owned MIT controller source at 6faf3346cb8b84db73b36ca56735f444203aecc5 describes a different password/authentication exchange. This controller is research evidence only; its code is not integrated and current wire compatibility is untested.

OHD retains the project/map argument, all original name/player/RCON controls, and native admin/ban/mapcycle/token/mod files. Typed configuration repairs the original installer's invalid relative `tee` path and avoids introducing its unrelated hardcoded join and RCON passwords. Existing join passwords remain operator-owned.

Ports are explicit, bounded and prevalidated: Pavlov primary+400 and a distinct RCON role; Tower primary+1 and distinct query; OHD primary+1 plus distinct query/RCON. Original native port defaults remain. Same-IP enforcement is shared backend validation. No extra publisher ports are inferred from broad firewall recommendations.

Stop uses the approved shared supervisor's opt-in SIGINT to its own process group, bounded grace/escalation and real child exit status. No invented save command is sent. Existing INI/CFG/TXT bytes/mode/timestamps are restored even on failed updates. Tower copies the validated Steam SDK64 securely without moving it out of the shared SDK.

Pavlov's private dependency closure is built from Debian12 packages in the Debian12 installer, including libc++, libc++abi, LLVM libunwind and libatomic and their transitive `ldd` dependencies. It excludes glibc and the loader, records package versions, SHA256 per library and Debian copyright notices, and never overwrites publisher libraries. Runtime verifies the Debian major and receipt hashes before updating/starting. No library packages were downloaded or built in this source checkpoint. An already-present pinned Steam image was inspected with networking disabled: Debian12.14/glibc2.36, missing libc++; the exact image digest is in the stage. This establishes the ABI family only, not native game compatibility.

Primary references:

- https://towerunite.com/guides/condo_dedicated_linux.html (current publisher condo instructions, custom INI, tokens, maps, SDK, persistence and query ports)
- https://github.com/vankruptgames/PavlovVR-Rcon/tree/6faf3346cb8b84db73b36ca56735f444203aecc5 (publisher-owned controller, MIT license; exact archived source hashes in `.local/vr-tower-ohd/pavlov-rcon-source.json`)
- https://github.com/pterodactyl/game-eggs/tree/c637a6d1e0449b167efeff81bb9a0177aa3df6c2/pavlov_vr (original pinned config sources)
- https://github.com/ptero-eggs/yolks/blob/master/steamcmd/debian/Dockerfile (maintainer source; independently checked existing pinned runtime's Debian/glibc family)

Additional recipe-linked documentation: https://operation-harsh-doorstop.fandom.com/wiki/Server_Install_Instructions and https://pavlovwiki.com/index.php/Setting_up_a_dedicated_server. These community-hosted guides are context rather than publisher binary/protocol proof.

Validation: 12 offline Python adapter fixtures; five real tiny-process optional-signal fixtures and existing six stop/three input regressions for the separately frozen shared console; `TestVRTowerOHDStagedDefaults` checks actual backend field validation and allocation rules. The original control audit compares actual imported defaults and visibility, not just field names.
