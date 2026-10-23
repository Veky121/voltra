# File manager parity and acceptance

Inventory taken 2026-10-22 before the new workspace integration. Status describes the inspected baseline, not a promise that a browser or real Wings test passed. The original application and daemon remain untouched.

## Original API contract

Every path below is relative to `/api/client/servers/{server}/files`. Preserve UUID, short UUID and supported server identifiers, account ownership, suspension handling, subuser permissions and API authentication through the existing shared server resolver.

| Method and path | Request | Permission in original request/controller | Result and Wings action | Baseline Go status |
| --- | --- | --- | --- | --- |
| GET /list | directory, optional nullable string, default / | file.read | file_object collection, all entries, list-directory | Present; no API cutoff |
| GET /contents | file, required string | file.read-content | text/plain, configurable 4 MiB default edit limit | Present, fixed 4 MiB |
| GET /download | file, required string | file.read-content | signed_url, 15 minute token, file-download scope | Present through Go proxy |
| GET /upload | no body | file.create | signed_url, file-upload scope | Present through Go proxy |
| POST /write | file query plus raw body | file.create | 204, raw Wings write, activity event | GAP: Go requires file.update, 16 MiB bound |
| POST /create-folder | name required, root optional | file.create | 204, create-directory with name/path | Present |
| PUT /rename | root nullable, files array of from/to strings | file.update | 204, bulk rename or move | Present |
| POST /copy | location string | file.create | 204, Wings duplicate-file operation | Present; original duplicates a file rather than arbitrary destination copy |
| POST /compress | root optional, files string array | file.archive | file_object archive result | Present |
| POST /decompress | root optional, file string | file.create | 204, Wings extraction | GAP: Go requires file.archive |
| POST /delete | root nullable, files string array | file.delete | 204, bulk recursive removal through Wings | Present |
| POST /chmod | root nullable, files entries with file/mode | file.update | 204, bulk octal permissions | Present |
| POST /pull | url, directory, filename, use_header, foreground | file.create | 204, Wings HTTP fetch; filename maps to file_name | Present; validate boolean/string option types for original parity |

Original source: `../pterodactyl-vite/routes/api-client.php:83`, `app/Http/Controllers/Api/Client/Servers/FileController.php`, `app/Http/Controllers/Api/Client/Servers/FileUploadController.php`, `app/Http/Requests/Api/Client/Servers/Files/`, `app/Repositories/Wings/DaemonFileRepository.php`. Go source: `internal/panel/operations.go`, functions registerOperations, clientFiles, opFilePermission, opValidateFile, clientSignedFile and signedWingsProxy.

The unused original DownloadFileRequest authorizes file.read, but the actual FileController.download signature uses GetFileContentsRequest, which requires file.read-content. Match the routed implementation.

Original `/pull` also has ResourceLimit::FilePull middleware, configured as five requests per ten minutes in `../pterodactyl-vite/app/Enum/ResourceLimit.php:48`. The inspected Go operations route has no equivalent per-operation limit. Retain this resource control or explicitly document a deliberate replacement. Request validation also differs: original root fields have string/nullable rules, pull options have boolean/string rules, while the baseline Go validator only checks a subset. Preserve accepted valid requests and reject malformed types before calling Wings.

## Original file metadata and archive compatibility

Preserve name exactly, Unix mode and mode_bits, numeric size, is_file, is_symlink, mimetype, created_at and modified_at. Names may contain spaces, plus, percent, hash, Unicode, question marks, ampersands and newlines. Encode URL queries once and leave JSON names unchanged. Do not apply Windows filename restrictions to Linux server files. Wings remains responsible for filesystem confinement, symlinks, denylist, quotas and supported extraction formats.

Original archive MIME allowlist in `../pterodactyl-vite/resources/scripts/api/transformers.ts:27`:

* application/vnd.rar
* application/x-rar-compressed
* application/x-tar
* application/x-br
* application/x-bzip2
* application/gzip
* application/x-gzip
* application/x-lzip
* application/x-sz
* application/x-xz
* application/zstd
* application/zip
* application/x-7z-compressed

The baseline Go UI only recognizes zip, tar, gz, tgz, bz2 and xz extensions for extraction, missing several original types and extensionless archives. Offer extraction based on MIME plus reasonable extension fallbacks. An offered action must still report actual Wings extraction errors. Original editor excludes archives, directories, application/jar, application/octet-stream and non-SVG images. Binary or unsupported files must have a usable download path rather than being silently decoded and saved as text.

## UI preservation matrix

| Capability | Original reference | Baseline and required acceptance |
| --- | --- | --- |
| Folder navigation and breadcrumbs | FileManagerContainer, FileManagerBreadcrumbs | Preserve root, parent, nested paths, browser history and refresh |
| Every directory entry | FileManagerContainer.tsx:105 | Original slices at 250. Go baseline already returns/renders all. New manager must preserve 1,205+ entries and make them reachable with virtualization |
| Metadata and sorting | FileObjectRow, sortFiles | Folder/file distinction, readable size, modified time, symlink indicator; preserve hidden files |
| Selection and bulk actions | MassActionsBar | Multi-select, select all, clear, move, archive and delete; bulk chmod already available in Go |
| Rename and move | RenameFileModal | Both files and directories, multiple selected files, relative and absolute container destinations |
| Copy | FileDropdownMenu | Duplicate files under file.create; do not imply unsupported recursive Wings copy |
| Archive and extraction | FileDropdownMenu | Compress selected items; extraction uses file.create, full original MIME allowlist |
| Delete | FileDropdownMenu, MassActionsBar | Confirm before deleting, propagate failures, refresh actual listing |
| Unix permissions | ChmodFileModal | Single and bulk targets, current mode, octal validation |
| Create directory and file | NewDirectoryButton, FileEditContainer | Both use file.create. New-file flow must work for create-only subusers |
| Text editor | FileEditContainer | Syntax selection, save shortcut, loading/error states, read-only permissions, unsaved draft protection |
| File download | FileDropdownMenu | Signed browser download, original bytes and filename, no browser Blob buffering for large files |
| Upload and drag/drop | UploadButton | Multiple files, progress, error, cancellation; preserve folder paths supported in existing Go UI |
| Fetch from URL | PullFileModal | URL and destination filename. Preserve API use_header and foreground options |
| Permission handling | Can components and request classes | Hide unavailable controls and reject unauthorized HTTP calls before contacting Wings |
| Error handling | FlashMessageRender | Report actual errors, preserve selection/drafts for retry; no optimistic fake success |
| Responsive and keyboard use | Original containers/modals | Mobile navigation and action menus, focus and modal dismissal, keyboard browsing |
| File explorer in editor | Existing Go FileExplorer | Preserve new Go functionality while replacing the browsing table |

Original UI source directory: `../pterodactyl-vite/resources/scripts/components/server/files/`. Existing Go UI source: `web/src/client/Files.tsx`, `FileEditor.tsx`, `FileExplorer.tsx`, `fileDraft.ts`, `useFileNavigationGuard.ts`.

## New transfer acceptance

These requirements extend original behavior. They need backend verification as well as Uppy controls.

1. Upload bytes in bounded chunks, with stable upload ID and authoritative offset. No whole-file server or browser buffering.
2. Pause stops further transmission. Resume continues at the accepted offset and preserves final bytes, including after interrupted chunk responses.
3. Cancel removes staged data; expiry cleans abandoned sessions. Bind ownership, server, destination and size to each session. Recheck permissions before finalization.
4. Retry network failures without duplicating chunks or completed files. Distinguish recoverable failure from final Wings import failure.
5. Preserve nested folder destinations, unusual filenames, zero-byte files and multiple files with the same basename in different directories.
6. Declare actual upload capacity, staging disk requirements and proxy limits. A transfer queue alone does not prove multi-GB upload support.
7. Download must stream, preserve Content-Disposition, and forward Range/If-Range if Wings supports them. Native browser download pause/resume depends on Wings and browser support; do not claim universal manager-controlled download resume.
8. Test cancellation, permission revocation, cross-user upload access, mismatched lengths, quota/disk full and daemon failure. Do not mark transfer complete before Wings confirms final storage.

## Regression tests

`internal/panel/file_parity_test.go` adds HTTP adapter tests for a 1,205-entry directory, metadata, Unicode and reserved query characters, operation payload forwarding, read-only subuser denial before daemon calls, and original create-only write/extract permissions. It uses the existing operationsFixtureNew isolated PostgreSQL schema and HTTP Wings fixture. These prove adapter behavior, not a real game server filesystem or browser transfer.

Run with TEST_DATABASE_URL configured and `go test ./internal/panel -run TestFileParity -count=1 -v`. Without TEST_DATABASE_URL the fixture skips database integration; that is not a passing runtime acceptance result. Global checks, browser acceptance, real Wings integration and multi-GB transfer validation belong to integration ownership.

## Implemented and verified during integration

The backend integration corrected write and extraction authorization to file.create. `file_validation.go` now validates string and nullable path fields, normalizes Laravel-compatible boolean values for Wings, and accepts numeric chmod modes by normalizing integral values to octal strings. It preserves the established Go API's missing root default of `/` for backwards compatibility, although original rename/delete/chmod request classes mark root required. Chmod continues rejecting non-octal modes before Wings rather than accepting every PHP numeric value.

The file pull resource limit now uses an atomic PostgreSQL settings entry per server, shared across users and app workers, for five requests per ten minutes. Permission denial occurs before consuming a slot. Rejected excess requests return 429 and Retry-After without contacting Wings. Windows reset automatically on expiry; the row is reused. As with original route middleware, authorized malformed requests consume a rate slot before body validation.

Verified against isolated schemas in the configured local PostgreSQL database with `go test ./internal/panel -run 'TestFileParity|TestFileValidation|TestFilePullLimit|TestOperationsFileValidation' -count=1`. All tests passed in 4.328 seconds. Coverage includes 1,205 directory entries and unchanged special names, original permissions, every baseline mutation denial for a read-only subuser, pull option/folder mapping, malformed request rejection, cross-user server limit, expiry and twelve concurrent pulls admitting exactly five. This still does not establish browser behavior or multi-GB transfer acceptance.
