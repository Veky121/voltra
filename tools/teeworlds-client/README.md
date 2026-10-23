# Teeworlds headless acceptance client

Uses `teeworlds-go/protocol` at commit edce0268a01cb67132cbcf0f0edd3da0d5a1196a,
under BSD-2-Clause. The separate development module retains its locked dependency
graph and vendored licenses. It is not linked into the panel.

```text
go build -o ../../.local/teeworlds-client.exe .
../../.local/teeworlds-client.exe 192.0.2.1:23560
go test github.com/teeworlds-go/protocol/chunk7 github.com/teeworlds-go/protocol/teeworlds7 -run '^TestVoltra' -count=1
```

Optional passwords are read from `TEEWORLDS_PASSWORD` and
`TEEWORLDS_RCON_PASSWORD`, never command arguments. The probe joins a player,
uses native snapshots to observe movement and stops after 100 snapshots with
movement, or a 20-second deadline. When RCON is supplied, it also requires native
administrator authentication and a readback of the test score-limit marker 517.
Output is limited to parsed acceptance fields. It does not render a game client,
download maps or verify graphical gameplay.

`TEEWORLDS_RCON_QUERY` optionally selects a native setting read instead of the
Teeworlds score-limit marker. `TEEWORLDS_RANK_CHECK=1` additionally requests native
`/rank` and requires the seeded DDNet fixture time 02:03.45. This proves loading
an existing database record; it does not prove a completed race. The DDNet test
uses the same protocol client and does not add another implementation.

Marked vendor alterations correct reversed snapshot-age comparisons, multipart
completion, reliable acknowledgement of duplicates/out-of-order chunks, and lost
high bits in chunk sizes and sequence numbers. Four regression tests cover these
cases. To refresh the pinned dependency, run `go mod vendor`, then
`node fix-vendor.mjs`, and rerun the tests above. The script requires exact patch
anchors and restores the tests from `regressions`. Original upstream licenses
remain beside the source.

Primary source: https://github.com/teeworlds-go/protocol
