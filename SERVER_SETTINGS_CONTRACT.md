# Server workspace settings

## Local-instance simplification, 2026-10-27

The user approved this for every server and game family, including shorter creation forms. The canonical server routes are `settings` for native game configuration and editable game variables, `settings/general` for identity/SFTP/reinstall, and `runtime` for installation/process variables, Java, Docker images and privileged resource controls. `quick-setup`, `startup`, `settings/startup`, `admin-tools`, and existing admin server URLs redirect to the shared workspace. The admin server creation URL opens Game Library. Do not render a second admin game/environment editor. Restricted template fields retain an explicitly labelled administrator override in Advanced; backend permissions remain authoritative.

Creation uses valid game/template defaults and defers optional gameplay controls. Keep version/loader, host/resource choices, agreements, required credentials, and fields without valid defaults. Conditional requirements must remain reachable. Do not remove backend validation or automatically start/reinstall when saving settings.

The original implementation contract below documents API behavior. Its old navigation/tab inventory is superseded by this section.


The user approved moving server-specific settings into the server workspace, with clear next-start vs installation behavior, named fields, secret masking and administrator-only controls. Shared infrastructure and reusable egg defaults stay global. Existing admin URLs must keep working. Preserve all dirty checkout changes. Do not restart services or mutate real games/auth data. Root owns Client/navigation/core/schema/integration. No commits or extra subagents.

## Server configuration overrides

Root adds `servers.configuration_overrides jsonb NOT NULL DEFAULT '{}'`. Backend owner implements `registerServerConfiguration(mux)` and `serverEffectiveEgg(ctx,server) (M,error)`. The latter merges allowlisted process/installer overrides over effectiveEgg; no global egg writes. Root integrates all server runtime/install consumers after coordination.

GET `/api/client/servers/{server}/configuration`, administrator only, returns item `server_configuration` with attributes:

```
{revision:string,template:{id:number,name:string,nest_id:number},managed:boolean,
 overrides:{config_files?:object,config_startup?:object,config_stop?:string,script_install?:string,script_container?:string,script_entry?:string},
 effective:{config_files:object,config_startup:object,config_stop:string,script_install:string,script_container:string,script_entry:string},
 defaults:{same effective fields},can_update:boolean,
 applies:{process:"next_start",installation:"next_install"}}
```

PUT same `{revision:string,overrides:object}` replaces only this server's override map, with optimistic revision/conflict, shared server-mutation lock, stopped-state enforcement, rollback on sync failure and value-free audit. Omitted fields inherit template. Saving never automatically starts/reinstalls. Managed installers reject installer overrides explicitly with actionable error, while safe process overrides remain reviewable. Do not bypass managed Steam/Java guards. Do not expose this endpoint to ordinary owners/subusers.

## Frontend ownership

- Admin tools owner: new `client/ServerAdminTools.tsx`, own CSS, admin/servers.tsx refactor exports + top tab bar. ServerAdminTools uses server.internal_id and backend admin auth, not URL IDs supplied by forms. Exports root component. Internal tabs for Overview, Details, Limits, Runtime, Databases, Mounts, Installation & process, Manage. Reuse existing admin controls where safe, preserve permission checks and API semantics. Server configuration editor follows contract above; preserve inherited values unless explicitly overridden and allow reverting field to default. Installer area collapsed, explicitly next install/reinstall only, no automatic action. Root integrates route and admin-only navigation.
- Startup owner: new `client/ServerStartup.tsx`, model/CSS/tests. Existing permissions and existing client `/startup`, `/startup/variable`, `/settings/docker-image`, JavaSettings APIs. Named variable inputs with schema-aware types, secret masking, pending-change indicators, default/reset affordances and explicit next-start save copy. Command preview collapsed and masked; no invented apply-live behavior. Do not edit Operations.tsx or Client.tsx; root swaps route. Root owns backend metadata and secret handling additions.
- Root: permission/account gating, Client routes/navigation/settings landing, schema, backend integration, secret metadata/transport handling and overall verification.

Use isolated schemas/fake Wings or mocked browser fixtures. Production frontend builds coordinated by root; typecheck allowed anytime. Do not edit global stylesheet, manifests, core/schema or start workers/services. Report exact limitations.
