# File manager

The Files route uses the shared `FileExplorer` with an integrated editor. The legacy workspace remains available through `?manager=v0` and the render-error fallback.

## Features

- The explorer shows the full directory listing and contracts beside an open editor. Memoized rows, shared metadata formatters and offscreen rendering containment reduce repeated work. There is no 250-file slice.
- Folder tree, breadcrumbs, search, sorting, keyboard selection, select all and
  bulk actions connect to actual server APIs.
- Original file operations remain available: new file/folder, read/write,
  rename/move, duplicate, archive, extract, delete, chmod, URL pull, upload/download.
  Original copy semantics duplicate a file in its current folder.
- CodeMirror 6 retains language detection, manual language selection, search,
  save shortcuts, draft navigation protection and the editor-side explorer.
- UTF-8 text, including custom game configuration extensions, is read as inert
  bytes before decoding. BOM and uniform line endings are preserved. Mixed line
  endings are read only to prevent silent conversion. Other encodings/binary
  formats retain a download path.
- Text files over 4 MiB use a bounded read-only viewer with previous/next/end
  chunks. Image, PDF, audio and video previews use supported browser formats.
  HTML and SVG are never executed as document previews.
- Saves compare the current server contents with the opened baseline and retain
  the draft when another process changed the file. This is an optimistic check,
  not an atomic compare-and-swap against external game processes.
- Uppy uploads use tusd and 8 MiB chunks, with progress, pause/resume, cancellation
  and retry. Folder selection and supported folder drops preserve relative paths.
  Each file captures its destination when queued. The queue remains mounted while
  browsing or editing within the server's Files workspace.
- A separate server-save status distinguishes browser upload completion from
  successful storage in Wings. Failed finalization retries from staging without
  re-uploading the browser file.
- Icons are self-hosted and the Files workspace is lazy-loaded. Licenses and provenance remain in `THIRD_PARTY_NOTICES.txt` and `web/public/licenses/`.

## API compatibility

All original file routes remain registered. See `FILE_MANAGER_PARITY.md` for the
route, payload, permission and archive MIME inventory. Write/extraction permissions
now match the original `file.create` behavior. File pulls preserve all original
options and the five-per-ten-minute shared per-server rate limit.

New routes below are relative to `/api/client/servers/{server}/files`:

- `GET /transfers`: node file limit, chunk limit, expiry and staging capacity.
- `POST /transfers`: tus creation with Upload-Length and base64 Upload-Metadata
  fields `filename` and `directory`.
- `HEAD/PATCH/DELETE /transfers/{id}`: authoritative offset, bounded append and
  cancellation. Requires the original transfer owner and current `file.create`
  permission on the same server/node.
- `POST /transfers/{id}/complete`: retryable finalization. Successful completion
  is persisted and idempotent across process restarts.
- `GET/HEAD /download-stream?file=...`: authenticated streaming attachment and
  single byte ranges, requiring `file.read-content`.
- `GET/HEAD /preview?file=...`: authenticated preview with an inert MIME allowlist,
  sandbox, nosniff and no-store headers.

## Transfer constraints

Node upload limits and disk quotas still apply. A node configured for 100 MiB
continues to enforce that limit. Raising it requires the node setting and Wings
configuration to agree. User-facing capacity forms use GB.

Browser chunks stage on panel disk, then stream to Wings using constant memory.
Pending uploads therefore need their full file size on the panel's staging disk.
`VOLTRA_UPLOAD_DIR` selects storage. `VOLTRA_UPLOAD_STAGING_LIMIT_BYTES` optionally
caps reserved bytes; zero leaves capacity to the filesystem. The default directory
is under the OS user cache and scoped to panel database/public URL.

For a sandboxed systemd service, explicitly set `VOLTRA_UPLOAD_DIR` to a
persistent directory owned by the panel user inside its `ReadWritePaths` or
`StateDirectory`. For example, a service restricted to
`/var/lib/voltra-panel/production` can use
`VOLTRA_UPLOAD_DIR=/var/lib/voltra-panel/production/upload-staging` with mode0700.
The default user cache is outside that write boundary and causes upload routes
to return503 `UploadStorageUnavailable` until the path is corrected and the
panel service restarted. Preserve existing staging files when changing releases.

Upload creation returns a relative `Location` so subsequent tus requests stay
on the browser's HTTPS origin or the desktop app's authenticated local proxy.

Paused/incomplete uploads expire after seven days, refreshed by HEAD/PATCH. Cleanup
runs when another upload is created. Interrupted commit journals are retained for
explicit recovery rather than discarding a potentially important overwrite backup.
After a browser reload, reselecting the same local file can resume its tus upload;
the in-memory queue itself is not restored. Navigating away from Files warns while
transfers are incomplete.

Stock Wings rejects rename over an existing destination, so overwrites use a
temporary upload and backup swap with rollback/crash recovery. Replacement is not
one atomic filesystem operation. It also temporarily needs old and new file space.
Pause/resume controls apply to the browser-to-panel phase; the final Wings copy
can be retried from staging.

Stock Wings ignores byte ranges. The panel emulates a requested range by streaming
and discarding the prefix, which keeps memory bounded but still reads that prefix
over the node connection. Native browser downloads handle their own controls;
manager-controlled pause/resume is provided for uploads. If-Range conservatively
falls back to the full representation because Wings supplies no stable validator.

Same-host panel workers can share staging through filesystem locks. Multiple hosts
need sticky routing or a shared, appropriately locked upload storage implementation.
Reverse proxies must allow PATCH/HEAD/DELETE and at least the configured chunk size.

## Workspace controls

A compact storage summary sits above the file toolbar. File actions stay beside the explorer. Selected items and the open document offer Delete through the shared confirmation dialog. Unsaved edits require save or discard before deletion; failed actions retain the document.

## Verification

Run frontend checks from [local development](docs/LOCAL_DEVELOPMENT.md). The [browser fixture](web/tests/browser/file-manager-ui.md) covers selection, editor layout, draft protection and large directories with intercepted requests. It does not prove real uploads or mutations.

[API parity](FILE_MANAGER_PARITY.md) records routes and permissions. The [initial acceptance receipt](docs/archive/file-manager-acceptance.md) retains the original real-transfer evidence and its limits. Those old process IDs and preview ports are not development startup instructions.
