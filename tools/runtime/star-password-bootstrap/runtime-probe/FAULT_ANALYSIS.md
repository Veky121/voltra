# Captured startup fault — offline findings

Both actual attempts and their cleanup remain preserved. No new native run was
performed for this investigation. The second run used the identical approved
probe/image/environment/launch source with Docker `--init` added; it progressed
through Wine prefix initialization, then emitted:

`Unhandled page fault on write access to 0000000000000000 at address 0000000140075BC0`

The exact1944-byte raw log is archived at
`.local/star-go-fault/exact-wine-exception.log`, SHA256
`26ecd0f90fb1adca842fe5eb4de9e152f2ed55fe56fd92cc3e652b68ac1ca605`.
It ends with WineDbg attaching; it contains **no register dump or backtrace**.
The180-second watchdog and15-second termination grace ended the utility with
raw137/OOMfalse. No MAIN/READY marker or import result was captured. No debugger
commands or further process execution were attempted.

An authorized offline-only unstripped diagnostic rebuild used the same installed
Go1.25.5/windows-amd64/v1/CGOoff source, trimpath/buildvcsfalse/empty build ID,
omitting only `-s -w`. Before symbol mapping, both executables were compared:

* PE preferred image base `0x140000000`, `.text` RVA `0x1000`.
* `.text` virtual bytes971537, raw bytes971776, complete byte-for-byte equality.
* Full raw `.text` SHA256
  `9837068d3d9b7be9188d820d7b99f60a73aef257a9329eb02a9a3fc500336c5f`.
* Reported PC `0x140075BC0` / RVA `0x75BC0` maps exactly to
  `_rt0_amd64_windows`, `runtime/rt0_windows_amd64.s:10`, using that preferred
  image base. No actual loaded-module map was captured, so no independent
  in-memory/ASLR-base verification is claimed.
* The matched instruction bytes are `e9 fb c6 ff ff`:
  `JMP _rt0_amd64`. This direct unconditional jump has **no memory write**.

The source and disassembly are archived with hashes in
`artifacts/star-password-bootstrap-go-fault-analysis.json`; Go's BSD notice is
preserved. The diagnostic executable was never executed. The original stripped
probe and its hash were not changed.

Consequently the actual faulting write cannot be identified from this log. Wine's
reported writeNULL does not match the on-disk jump's semantics. Missing register
context, backtrace and in-memory instruction bytes prevent distinguishing loader/
context reporting, code modification, or another startup cause. The captured PC
belongs to executable startup, not our import loop; no completed dependency check
is proved. It is a **bootstrap-confounded attempt**, not a missing-export result.
Neither general Go/Wine incompatibility nor success of a C replacement is inferred.

The current source calls `debugOutput.Find()` before its MAIN marker, so even
MAIN absence alone must not be used as proof of a particular Go instruction or
Windows API failure. The original artifacts remain the authoritative native
evidence; this offline mapping only narrows the location and its limits.
