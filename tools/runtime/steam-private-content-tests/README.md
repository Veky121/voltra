# Offline private-content mechanical harness

This separately named test assembly is excluded from the shipping worker. It does not authenticate Steam accounts, request licenses, query Steam or download content. Run only with injected deterministic session/chunk adapters and no network.

## Exact compile exception

All root C# sources from `../steam-private-content/` are compiled unchanged, except:

- `Program.cs` is excluded to select the separate test entrypoint.
- Shipping `AccessProof.cs` is excluded and replaced by this directory's explicit test-only shim. Existing private/public mappings remain unchanged. The added Fixture kind writes provider `fixture-private-content-v1`, proof `fixture_mechanical_only`, and **false** entitlement/account-entitlement/anonymous-access flags in the actual persisted receipt.

The shipping source inventory and accepted checkpoint27 hashes are recorded in the harness checkpoint. No shipping file or capability is changed.

## What is exercised

Positive publication uses an explicitly test-only composition of injected IContentSession, actual private chunk cache, actual GameContentCoordinator, actual StagedPublication with Fixture proof, and actual ParentReceiptBoundary with expected Fixture proof. It is **not** unchanged ContentOperation.Run positive integration: that function hardcodes PrivateAccount proof. Unchanged ContentOperation.Run is compiled and used only for invalid scope/descriptors, corrupted chunk and operator-conflict cases that must not commit.

`--self-test` publishes real files and real receipts; exercises an independently invoked credential-free validator, two generations and prior-owner/operator preflight, scope/selection/replay/file/receipt tampering, second-depot failure before any publication, four mutation rollback points, four actual child-process exits during publication followed by fresh reconstruction/recovery, receipt write/flush/rename interruption, directory-fsync uncertainty, and actual different-device rejection. Output is bounded JSON with explicit fixture provenance and false entitlement/access/native flags. It is mechanical file-integrity proof only.

Normal privateFD arguments are identical to the separate worker's numeric-FD protocol. The harness FD positive path and validator return both `provider` and `fixture_provider` in the receipt reference. The persisted receipt itself also has the fixture provider and false access flags. The production default C# validator and publication policy reject it. The Go production result policy must reject both the raw marker and persisted fixture provider even if reserialization strips unknown marker fields; production acceptance must never be inferred from this test.

The test-only `--crash-fixture <owned-temp-root> <1..4>` child mode terminates with exit71 at a real publication mutation. The parent creates the unique private temp directory, verifies exit, invokes actual recovery twice and removes only its owned fixture root. It is never a shipping option.

## Offline verification

Use the shared ordinary1GiB/4GiB/0port utility described in `.local/private-steam-integration/HARNESS-E-OWNERSHIP.md`. The cached SDK10.0.402 SHA512 and locked NuGet cache are verified; build/test containers have `--pull never --network none`, read-only sources, fixed paths and no credentials. The driver is `.local/private-steam-integration/harness-e/build.mjs`; output checkpoint2 is `/work/harness-e-build-2/OfflinePrivateContentFixture` with RuntimeRoot `/work/runtime` (or verified SDK runtime `/work/sdk`). Earlier sources/logs/output remain preserved.

Original MIT and LGPL dependency/source/license notices under `../steam-private-content/` remain applicable. This harness is not a production worker bundle/provisioner and makes no private-account, native game or gameplay claim.
