# Private Steam receipt recovery

Receipt recovery checks a finished download whose result did not reach the Panel.
It does not sign in to Steam, download content, replay an installation journal or
start the game server. An unsuccessful or interrupted download still needs the
normal installation workflow.

## Availability

The existing Steam account content card offers **Recover download result** when
the backend identifies a retained unfinished attempt. The server must be stopped,
the caller must retain `startup.update`, and no installation or transfer may be
active. Node maintenance also blocks recovery. Cancelling the check leaves the
server stopped and does not turn it into a new installation.

Ordinary private Steam readiness does not enable recovery. The installed worker
needs its separately reviewed recovery ABI, manifest, entrypoint and per-game
policy approval. Missing approval keeps recovery disabled. Offline candidate
bundles do not grant this approval or activate services.

## API and durable state

`POST /api/client/servers/{server}/steam/private/jobs/{job}/recover` accepts only
an empty JSON object. Clients cannot supply credentials, receipts, paths, a new
selection or replacement scope. The Panel loads the original credential-free
request from `steam_private_attempts`, including its original nonce, previous
receipt, budgets and deadline. That attempt survives deletion of authorization
and job-history records, but remains bound to its original server placement,
owner, installation and current reviewed content policy.

Readiness includes `recovery_ready`, `recovery_reason` and `recovery_job_id`.
These describe availability, not proof that a valid receipt exists on disk.
The latest queued, running, completed or already accepted attempt is not offered
as a recovery candidate.

Each recovery uses a fresh, single-use recovery ID bound to the original request
digest. It does not reopen the original installation grant. The node obtains
existing stopped-server roots without creating an installation marker. The
shipping worker checks its private persisted receipt and published files; a
second worker process independently validates the returned receipt reference.
Anonymous and fixture proofs are rejected by the shipping recovery path.

The Panel rechecks authorization and server bindings while recovery runs and
before accepting the result. Session revocation, policy revocation, cancellation
and deadlines stop the operation. Only a validated result updates the durable
accepted-publication pointer. The original failed job history remains unchanged.
Successful API responses contain `recovered: true` and
`native_acceptance_verified: false`. Recovery does not mean the game booted or
passed gameplay acceptance.

Recovery retains the original validated deadline of 1 to 7,200 seconds. A shorter
caller deadline or the current release approval expiry can shorten that bound.
Each layer preserves the earlier bound rather than starting a fresh allowance.
The parent process enforces termination while the worker hashes large files.

## Evidence and remaining boundary

The root integration checkpoint is
`artifacts/private-recovery-integrated-root-checkpoint.json`. Its referenced
receipts distinguish mocked Panel/UI tests, offline worker tests, source-archive
reproduction and actual packaged-worker rejection tests.

Those checks do not prove successful recovery after a real authenticated private
Steam download. That requires separate authorized acceptance with a valid
publisher entitlement. A private persisted receipt is trusted evidence from the
root-owned work directory, not a cryptographic defense against a privileged
administrator rewriting that directory consistently.
