# Private Steam transport: native parser results and typed provider proposal

Status: source research/proposal only. Production Python/Go private account, Steam Guard and beta-password gates remain fail-closed. No account/login/authentication/application/content/license command or private credential was used. No credential request or production integration is authorized by this document.

## Corrected native filename oracle

The utility uses the reviewed public SteamCMD1792617903 copy, sealed memfd command scripts, a private owned program directory, disposable private HOME/cwd, networking disabled and bounded container resources. Original `.local/steam-private-transport/` evidence is unchanged.

The initial relative-filename attempt had an invalid plain baseline and is preserved as invalid evidence, not a parser failure claim. A separate native baseline proved that SteamCMD resolves `runscript` relative filenames against its own program directory. The corrected probe creates exact **public fake filenames** there, so leading plus/minus, quotes, whitespace, slashes and UTF8 are genuinely in the native token itself. Each file contains a distinct harmless cvar marker that cannot appear merely from echoing the input filename. Every encoding gets an independent native process, avoiding stale cvar attribution.

`tools/runtime/steam-private-token-oracle.py` is an explicitly disabled public research oracle, not a production credential codec. It tests eight hypotheses against 16 public fixtures: literal wrapping, quote-only backslash escapes, backslash-plus-quote escapes, doubled quotes, bare literals, escaped spaces/quotes, single quotes and quadrupled quotes. Corrected receipts and native-output hashes are under `.local/steam-private-parser-v2/`. Successful plain baselines and failed mixed-token cases are separate observations. None of these tests establish authentication, Guard prompts or beta-password acceptance.

All tested quote-plus-space and mixed quote/space/backslash encodings fail the exact-file oracle. This refutes those concrete codecs; it is **not** a mathematical proof that every possible Steam console grammar representation is impossible. There is no faithful approved codec to integrate, and production must not silently narrow inputs or fall back to argv credentials.

Backslash-only filenames also fail every candidate, but `runscript` may normalize backslashes as path separators. That is an important oracle limitation: it cannot separate token parsing from native filename-path normalization. Do not report those rows as proof that a non-path password field loses backslashes. Quote-plus-space failures without any backslash remain separate exact-file observations. Likewise, filename success is not authentication proof or a guarantee that every command's argument consumer behaves identically.

## Preserve actual field policy

The current Go `steamapi.Request.Normalize` accepts a beta password up to1024 **UTF8 bytes**, rejects CR/LF/NUL, and requires a non-public branch. It does not reject TAB/other C0/DEL. Experimental helpers' character-count/C0 bans cannot replace this contract. Account/password/Guard field policy must be taken from each actual API/schema rather than adopting one generic restriction. Quotes, leading/trailing whitespace, backslashes, prefixes and valid Unicode must never be trimmed, escaped into different bytes or replaced.

The filename oracle deliberately tests a bounded public subset. Its own public-fixture validator is not a new secret validator. Native filenames also have OS component/path limits, so this oracle cannot certify every maximum-length credential. Any future provider needs exact per-field policy and packet/typed-field byte-fidelity tests, including permitted controls and UTF8 byte boundaries.

## Concrete maintained OSS route

Primary source snapshots, licenses, exact commits and file SHA256 receipts are in `.local/steam-private-parser-v2/oss/receipt.json` (13 source files, about172KB; no SDK/runtime or executable acquired).

- SteamKit2 source commit `4a149b73d7dda7b043db704a25f4a273cd679eae`, LGPL-2.1-only. Its project targets net8.0/net10.0. `SteamAuthentication.BeginAuthSessionViaCredentialsAsync` takes `AuthSessionDetails.Username` and `.Password`; the password is UTF8 encoded directly for RSA encryption, with no Steam console command parser. `IAuthenticator` supplies typed device/email codes and device-confirmation decisions. `SteamApps.CheckAppBetaPassword(uint,string)` assigns the literal string directly to `CMsgClientCheckAppBetaPassword.betapassword`. These source paths provide an actual parser-free transport, not a shell escaping assumption.
- DepotDownloader commit `6396afe2e34a6c40459bcb6bdafa43c83c9db8cc`, GPLv2 (license file). Its existing Steam3Session uses the credential-auth API, then typed beta-password checks and PICS private-beta metadata. ContentDownloader already selects app/depot/branch/platform manifests and validates/reuses downloaded data. Its CLI and console authenticator are unsuitable as-is because they use argv/console/account cache/logging; do not wrap the stock CLI with secrets.

Recommendation for root review: a separate, source-available GPL worker fork reusing DepotDownloader's content logic, with a private inherited-FD request/event/reply entrypoint and SteamKit2 typed authenticator, instead of rebuilding the entire content downloader. Keep the worker executable/process boundary and corresponding source/patch/license notices explicit. A direct LGPL SteamKit-only worker is possible but would require implementing equivalent manifest/depot/chunk/update behavior; it is not a small auth-only patch.

Runtime choice must be explicit. DepotDownloader's inspected project targets net9.0 and references SteamKit2 3.4.0; inspected current SteamKit source has net10.0 support. Microsoft lists .NET8/9 support ending November10,2026 and .NET10 LTS through November14,2028. Propose net10.0 for a reviewed build, with exact NuGet/transitive lock files and SDK/runtime provenance. Retargeting/upgrading requires compilation/API/offline tests, not an assumption based on README (which still says .NET8). No packages/SDK/runtime or binary were downloaded in this checkpoint.

## Proposed private worker protocol

1. Parent launches a dedicated isolated worker process/container with only inherited FD numbers in argv. One sealed anonymous request FD carries a length-bounded versioned binary/JSON frame. Separate private event/reply pipes carry correlated Guard challenges. No secret environment variables, argv values, disk request files, public debug hooks or raw publisher logs.
2. Read each field unchanged using its original validation policy. No shell or Steam console language is involved. Set typed `AuthSessionDetails` values directly; supply a custom `IAuthenticator` backed by the private pipes. Single-use challenge IDs, exact state transitions, deadlines and explicit cancellation must reject duplicate/out-of-order replies. Never repurpose a beta-password response as an account/Guard response. No automatic credential retry/account creation/QR flow unless separately authorized.
3. Disable persistent sessions and stock account/token cache writes by default. Keep unavoidable account/session state under that worker UID in0700 private scratch, not a public cache. Suppress stock Console/DebugLog/error text, replacing it with fixed status enums and safe counters. Never send server-provided account names, tokens, Guard data or exception strings into public receipts. Termination/cancel kills the owned process group before cleanup. Same-UID/root process access remains the host trust boundary.
4. Account password encryption has a provider/RSA payload bound. Preserve API inputs and report a distinct provider error if an input cannot be represented; do not trim or silently install a smaller schema limit. Beta passwords go to their separate protobuf field unchanged. Offline packet/RSA tests must explicitly distinguish byte transport from successful server authentication.
5. Retain ordinary anonymous/public SteamCMD behavior and all current controls. The new provider is opt-in only after genuine acceptance. Never generate a SteamCMD `.acf` receipt to pretend DepotDownloader performed a SteamCMD install. The existing executor validates native manifests, so this alternative requires an explicit typed provider receipt: authoritative PICS app/build/platform/branch plus exact depot manifest/chunk/file identities, bounded validated staging and current secure publication/config/world retention.
6. Private content/chunk ownership cannot be treated as a public anonymous cache grant. Reuse only authorized private scope or separately proven public blobs; never cache auth state with content. Preserve real license/ownership requirements and signed job authorization. No invented license, anonymous fallback or entitlement bypass.

## Proposed next source-only checkpoint, requiring root coordination

Pin exact DepotDownloader/SteamKit release/source and transitive packages; create a disjoint worker fork/patch with net10.0 target and no production callers. Replace CLI/console auth/cache/logging with inherited-FD framing and injectable typed interfaces. Build **offline-only** tests that serialize/decode actual SteamKit protobuf beta-password fields and exercise private authenticator challenge state, unchanged literal/UTF8/control bytes, username/password field mapping, no secret argv/env/files/logs, bounds/cancel/timeout and fixed safe errors. No network connection or auth/content request may occur in those tests.

Only after source review should root consider separate bounded acceptance with legitimately supplied private credentials and actual authorized app/beta ownership. That later scope must prove authentication/Guard/beta/content/update/retention/cancellation and cleanup; current public parser evidence cannot substitute for it. Keep every production unavailable capability until then.

Primary links:

- https://github.com/SteamRE/SteamKit/tree/4a149b73d7dda7b043db704a25f4a273cd679eae
- https://github.com/SteamRE/DepotDownloader/tree/6396afe2e34a6c40459bcb6bdafa43c83c9db8cc
- https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core
