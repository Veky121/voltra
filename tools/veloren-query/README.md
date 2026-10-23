# Veloren query acceptance probe

Uses the upstream `veloren-query-server` client and native UDP challenge exchange.
Prints build, player capacity, battle mode and latency as JSON.

```text
cargo run --locked --manifest-path tools/veloren-query/Cargo.toml -- 192.0.2.1:23560
```

This does not authenticate a player or verify gameplay. This GPL-3.0-or-later
development tool is separate from the panel; see LICENSE and Cargo.lock.
