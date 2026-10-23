# Experimental SteamCMD private transport

This work is **not enabled**. It does not yet restore private login or beta
password support. Keep the current Python and Go fail-closed checks in place.

`steam-private-fd-transport.py` provides a Linux-only experimental worker. A
sealed anonymous memfd carries a script through `+runscript /proc/self/fd/N`.
Only the descriptor number appears in the process arguments. A minimal fixed
environment omits all account, password, Steam Guard and beta-password values.
The runner suppresses all captured output. It never returns raw output in its
result or exception. Its public probe observer is strictly a test facility and
must not be enabled on a private request.

The launcher must reside in a dedicated copy owned by the worker UID with its
directory mode 0700. SteamCMD can write logs/config relative to its own program
directory despite HOME/cwd overrides, so using a shared cached launcher is
rejected. HOME/cwd are disposable mode0700 directories; the child umask077 makes
new publisher files0600/directories0700. Any executable copy and its publisher
auth state remain the caller's private lifecycle responsibility. No shared
cache may receive those files. Same-UID/root access to `/proc` is an OS trust
boundary; use a distinct worker UID/container, not an untrusted shared UID.

The process starts in its own session. Cancellation, output limit, timeout and
failure terminate the entire session before temporary-directory cleanup. FD
write/grow/shrink/seal operations are sealed. This implementation uses a small
`preexec_fn` for umask, so **run it as a dedicated worker process**, never invoke
it directly in a threaded service. A production worker needs a bounded private
FD/pipe request protocol; credentials must not be supplied to its CLI or env.

## Native evidence and remaining gap

Stage: `.local/steam-private-transport/`.

The copied public SteamCMD1792617903 read the inherited memfd through its real
shell launcher. No login, account, application or download command was sent.
`memfd-parser-receipt.json` records harmless cvar round trips. Plus/minus,
leading/trailing spaces, backslashes, UTF8 and semicolon fixtures round-tripped.
A combined quote/space/backslash fixture did not. Cvars can join arguments, so
this alone is not a login-token oracle.

`memfd-filename-receipt.json` uses exact fake filenames passed to native
`runscript` as a stronger token oracle. Plus and surrounding spaces work. A
literal embedded quote without surrounding spaces works in one form, while
backslash-escaping it fails. A quote with spaces and the mixed fixture fail
with both literal and backslash escaping. Therefore shell/JSON escaping cannot
be substituted for Steam's command parser. Native parser proof was performed
before the additional owned-program-directory guard; the guard is covered by
the Linux process tests.

The prototype explicitly refuses quotes in `experimental_token`; this is a
known implementation gap, not an acceptable narrowing of the existing secret
contract. C0 controls, LF/CR/NUL/tab and DEL are rejected explicitly. Leading
plus/minus, spaces, UTF8 and backslashes are not trimmed or rewritten. The
experimental length check counts Unicode characters, not UTF8 bytes; integration
must preserve each existing field's actual validation policy instead of adopting
a new arbitrary byte bound.

Six real Linux process tests cover sealed descriptor byte fidelity, credential
environment removal, no secrets in child argv, mode0600/0700, fragmented output
suppression, process-group cancellation, bounded timeout/output failure, and
rejection of shared program directories. They do not prove Steam authentication.

## Exact integration request to root

Do **not** change `steam-template.py.arguments()`, `internal/steamexec`, API
capability advertisements, durable journals, or private-credential tests yet.
No enablement is requested from this checkpoint.

Before enabling, prove a faithful token or prompt mechanism for every currently
accepted literal including quotes mixed with spaces, plus Steam Guard and beta
password handling. Interactive password prompts could avoid one command-parser
layer, but were not exercised because no real account is available and no login
was authorized for the parser utility. A username/beta-password command path
still needs its own proof. Do not infer it from cvar output or fabricate auth.

After that proof, request a separate root-reviewed integration: launch the
dedicated worker from the shared Python updater and Go executor using inherited
anonymous request FDs, clone public launcher files into private worker state,
keep account auth out of game/cache receipts, preserve existing API validation,
and retain safe structured status/progress without publisher output. Add actual
account/beta success and cancellation acceptance with privately supplied operator
credentials. No private authentication has been performed here.

Native utility containers were confirmed exited and removed; the exact owned
utility mount was emptied. `native-run.json` records zero remaining children.
No production service, game, database, account or shared cached object changed.

## Password-prompt follow-up

`steam-private-pty-transport.py` is a separate, disabled experimental worker.
It opens a controlling PTY with echo, canonical input translation and flow
control disabled. It sends the unchanged UTF8 password plus one LF only after
an exact, possibly fragmented password prompt. It checks echo remains disabled
before sending. A guard field is sent once only in the expected subsequent
state. Repeated/out-of-order prompts, missing fields, re-enabled echo, timeout
and cancellation fail closed. All output is suppressed, including deliberately
echoed secrets in the fake publisher. Writes are nonblocking and check the
same deadline/cancellation predicate. The worker never issues an application
operation or advertises a completed authentication.

The native probe used one unique public fixture username, without a password
or guard code. SteamCMD1792617903 emitted its password prompt, and the driver
terminated its owned session **before writing any input**. Evidence is
`password-prompt-receipt.json`: `sent_fields=[]`, `aborted_before_secret=true`,
`authentication_performed=false`. No repeated fake login was performed.

Seven real fake-process tests pass. They prove fragmented prompt matching,
literal edge whitespace/prefix/quotes/backslashes/UTF8, a 1024-character UTF8
password without terminal truncation, fake guard-state ordering, safe abort
before input, echo rejection, timeout/cancel, and a separate beta-password
capability which fails before filesystem/process effects. They **do not** prove
native password interpretation, successful authentication or native Steam Guard
prompt wording. The experimental safe username is currently a public CLI
fixture; actual username privacy requires putting its command in an inherited
private script instead. Existing broader username validation must not silently
be replaced by this fixture's limited dialect.

Valve's [Steamworks uploading documentation](https://partner.steamgames.com/doc/sdk/uploading?l=english)
explicitly documents a username-only initial invocation followed by password
and SteamGuard entry, and private config-token preservation for later sessions.
The bounded native `help login` probe independently confirms password prompts
when a required password is omitted, controlled by `@NoPromptForPassword`.
`beta-help-receipt.json` records native help only, with no authentication or
app operation. Native `help app_update` does not establish an independent beta
password prompt. Valve's [branch documentation](https://partner.steamgames.com/doc/store/application/branches)
describes password-protected branches but does not establish arbitrary literal
SteamCMD password transport. Beta-password support therefore remains separately
unproved and closed. Do not feed it to an account password prompt.

Next integration review should combine a private inherited username script
with this prompt state machine, then prove native literal password delivery
with privately supplied legitimate credentials. Native Steam Guard prompts and
the separate beta-password mechanism require their own evidence. All shared
Python/Go/API fail-closed checks remain unchanged. The prompt probe and help
containers were removed and their exact owned mount emptied; cleanup is in
`prompt-native-run.json`.
