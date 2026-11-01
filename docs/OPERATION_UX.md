# Operation feedback and diagnostics

This change extends the existing notification, server, and transfer components.
It does not replace the activity log or claim every game has progress reporting.

## User-facing behavior

- Proxy and power action errors can be dismissed and expire inline after ten seconds. Their notification history remains. Validation and ongoing resource failures remain visible. Shared action notices have a dismiss control.
- Reserved forwarding ports identify the affected port and explain how to choose an allowed allocation. Node DNS, timeout, interrupted-request, and connection failures have distinct safe codes and recovery advice.
- API failures carry a generated request reference in `X-Request-ID` and `errors[].request_id`. Notification details can copy the reference. Backend failures log the same reference, status, error class, and database code when available, without raw exception messages. Debug completion logs contain the route pattern and elapsed time, not query strings or user path values.
- The server transfer dock persists across server subpages. It shows authorized users' node pulls and panel uploads, actual byte totals when known, and unknown totals without a percentage. Completed entries can be cleared. Canceled uploads are reconciled out of snapshots. Paused uploads stop animating after 30 seconds without byte activity. Idle snapshots reconcile every 30 seconds; active uploads and active downloads without a socket use five seconds. Hidden pages pause these snapshot requests.
- Power controls show request acceptance and observed phases separately, offer status refresh during long waits, and never infer failure or success just from elapsed time. Motion respects reduced-motion preferences.
- Dashboard insights show the latest retained successful backup across all pages, enabled schedules containing backup tasks, and recorded Steam installed/latest builds with check time. Connection details distinguish process state, forwarding records, local port checks, and external checks.
- Startup fields show template-default provenance when the API provides it. Reset is a draft in the shared Save/Discard flow, with permission checks and hidden secret defaults preserved. Template defaults are not described as native game defaults.

## Shared game reporting

See [GAME_OPERATION_REPORTING.md](GAME_OPERATION_REPORTING.md) for the reusable
script helper, versioned protocol, safe code catalog, and current producer wiring.
New game integrations should use this contract and verify their output transport.

## Verification and remaining work

Focused frontend tests cover notification fencing/redaction, power confirmation,
transfer reconciliation, startup permissions/reset semantics, reporting/parser
behavior, actual temporary-file downloads, and backup schedule interpretation.
Focused panel tests cover request references, transport classification, measured
upload isolation, forwarding guards, and backup aggregation. Database-backed
transfer permission tests require `TEST_DATABASE_URL` and were skipped when it
was absent. The packaged Wings patch was applied to its pinned source and its
three downloader tests passed in WSL.

No native game acceptance, live browser check, service restart, installation, or
publication is implied by these checks. Wings byte progress requires deploying
the updated Wings package. Old nodes remain compatible but cannot supply the new
byte fields. The native Wings writer still requires a known size for quota-safe
writes; a bounded HEAD fallback is tried, then an explicit error explains sources
that cannot provide one.

The final frontend typecheck and 49 focused frontend tests passed. An isolated
production build passed at `.local/operation-ux-20261101-build`; it did not replace
served assets. Vite retained the existing mixed JSON-import attributes and large
chunk warnings.

Remaining work includes instrumentation for every other download producer,
install-container event transport, durable multi-device operation/notification
history, actual external/game-protocol probes, verified non-Steam installed
versions/loaders, and durable per-setting pending-restart tracking. Browser-local
uploads still require staying in Files until saved. Existing permission and
credential boundaries remain in force.
