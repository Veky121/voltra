# File manager v1

The Files route now loads the integrated SVAR file browser by default. The previous
workspace is preserved as `FilesV0.tsx`, accessible through **Open v0** or
`?manager=v0`. V0 remains selected while browsing its folders. A render error in
v1 offers the v0 fallback. No original PHP application or daemon source was changed.

## Features

- Every directory entry is returned and accessible. The default table renders a
  virtual viewport; there is no 250-file slice. Grid and split views are available.
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
- Icons are self-hosted. SVAR and Uppy load only on the Files route. Licenses and
  provenance are recorded in `THIRD_PARTY_NOTICES.txt` and `web/public/licenses/`.

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
configuration to agree; the acceptance node was configured for 2 GiB.

Browser chunks stage on panel disk, then stream to Wings using constant memory.
Pending uploads therefore need their full file size on the panel's staging disk.
`VOLTRA_UPLOAD_DIR` selects storage. `VOLTRA_UPLOAD_STAGING_LIMIT_BYTES` optionally
caps reserved bytes; zero leaves capacity to the filesystem. The default directory
is under the OS user cache and scoped to panel database/public URL.

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

## Verification and local preview

The existing Windows app PID 46872 was not stopped or restarted. Its `web/dist`
was not rebuilt by this task. Source and dependencies build, and the replacement
was tested through a separate loopback panel at `http://127.0.0.1:8098` with no
background workers. Its build lives under `.local/file-manager/web`.

`tools/file-manager-server` is the isolated acceptance server. The optional
`FILE_MANAGER_PATCH_DELAY_MS` adds test latency, used to exercise browser pause.
`web/vite.file-manager-test.config.ts` builds the app plus an explicitly test-only
generated-file entry; normal Vite builds do not include that entry.

Evidence:

- `artifacts/file-manager-acceptance.json`: dedicated Wings node 143/server 143,
  real interrupted 1 GiB upload, offset conflict/resume, idempotent completion,
  complete streamed download SHA-256 match, near-end range byte match, empty files,
  overwrite, cancellation, Linux/Unicode names, and 1,205-entry tar/list round trip.
- `artifacts/file-manager-browser-acceptance.json`: browser-driven selection/search,
  editor/save/conflict checks, v0 switching and generated 256 MiB Uppy pause/resume.
  The resumed file's full downloaded checksum matches its generated source.
- `artifacts/file-manager-split.png`: verified browsing layout.
- Full `go test ./... -count=1` passed with PostgreSQL configured. Focused Linux
  race tests passed for transfers, parity, validation and pull limits. `go vet`
  and the panel build passed. All 92 frontend tests, TypeScript and Vite builds passed.

The dedicated local test Wings uses ports 18087/12027 and the disposable server
UUID `08b66b95-78fa-4503-b841-366de558ee2f`. Configuration and staging are under
`.local/file-manager`; the fixture is separate from the homelab acceptance VM and
the original daemon. It is retained for review, not a production deployment.
