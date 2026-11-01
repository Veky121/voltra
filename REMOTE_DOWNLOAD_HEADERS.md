# Optional egg download headers

Administrators can set **Remote download headers (optional)** in egg details.
The default `{}` disables the feature. Rules use exact lowercase DNS hostnames
and apply only to HTTPS on port 443. The GIANTS-specific pattern below also
matches `cdn` followed by digits, such as `cdn25`, `cdn27` or `cdn100`.
Other wildcard patterns are rejected. Rules do not inherit from a parent egg.

The FS25 catalog egg includes:

```json
{
  "cdn*.giants-software.com": {
    "Referer": "https://www.farming-simulator.com/"
  }
}
```

Existing installed eggs retain their configuration. An administrator can add
the rule to an existing FS25 egg using the editor or `PATCH /api/admin/eggs/{id}`
with a `download_headers` object. Use `{}` to turn it off. No game restart is
needed after saving this setting on a panel/node version that supports it.
Upgrade the panel before saving the pattern; older versions accept only exact
hosts. Exact host rules take precedence over the GIANTS pattern.
Paste the direct ZIP download URL, not the ModHub webpage URL.

PTDL import/export stores this optional extension at
`voltra.download_headers`. Old documents without it import with no rules.
Only Referer, User-Agent, Accept and Accept-Language are supported. Values are
public compatibility hints, visible in egg exports, and must never contain
credentials. Cookies, Authorization, Host, transport headers and arbitrary
client-supplied headers are not supported.

## Wings requirement

Both the panel and Wings need these changes. The pinned Voltra Wings build
applies `tools/wings/remote-download-headers.patch` and copies the associated
helper and tests through `tools/wings/apply-release.mjs`. The authenticated
`GET /api/system` advertises `X-Voltra-Download-Headers: 1`. For a matching rule,
the panel checks this capability before passing `remote_headers` in the pull
request. Older nodes get a clear 409 update-required error instead of silently
ignoring the rule. Downloads without a matching rule keep the normal path.

Wings validates header names and values again. Its existing remote-address
checks remain in place and redirects remain disabled. Foreground downloads
report a source HTTP error such as `Download site returned 403 Forbidden`
without exposing source response bodies or signed URL queries. Background
downloads still report acceptance first; later failures appear in node logs.

Saving or importing egg configuration does not publish, update, install or
restart Wings. Deployment and a full native download remain separate checks.

Remote transfers now retain terminal outcomes for 15 minutes, up to 50 per server, in Wings memory. The file manager uses the download progress WebSocket event and a five-second reconciliation request. A Wings restart clears this short history. The new UI always queues downloads and displays their destination, progress and failures in Transfers. The request guard allows 30 requests per minute per user/server; Wings retains its three-concurrent-download limit.
