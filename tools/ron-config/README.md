# Native RON settings updates

This helper uses `ron` 0.12.2 and Serde to validate settings and borrow the source
spans of root field values. Only managed values are replaced. Comments, field
ordering, unknown fields, nested enums and unrelated formatting are retained.
New fields are inserted without reserializing the existing document.

Run `voltra-ron-config path/to/settings.ron` with JSON on stdin:

```json
{
  "server_name": {"kind":"string","value":"A literal, quoted server name"},
  "max_players": {"kind":"integer","value":30},
  "auth_server_address": {"kind":"option_string","value":"https://auth.veloren.net"},
  "gameserver_protocols": {"kind":"raw","value":"[Tcp(address: \"0.0.0.0:14004\")]"}
}
```

Supported change kinds are `string`, `integer`, `boolean`, `option_string` and
`raw`. Strings use native RON serialization. Raw literals must pass the native
RON parser. Inputs with duplicate fields, malformed values or trailing data are
rejected. Errors omit configuration contents. A changed existing file is backed
up to `.voltra-backup`; a staged write replaces it only after serialization and
syntax validation. Unchanged files are left alone.

This validates RON syntax, not a particular game's field types or configuration
policy. Veloren additionally validates staged settings with the actual native
server before changing live files. Linux x64 acceptance covers native type
rejection, unmanaged settings and intended listeners.

Checks:

```text
cargo test --locked --manifest-path tools/ron-config/Cargo.toml --target-dir .local/ron-config-target
cargo clippy --locked --manifest-path tools/ron-config/Cargo.toml --target-dir .local/ron-config-target -- -D warnings
```

Unit tests run on Windows; Linux compilation and Veloren integration also passed.
`Cargo.lock` pins dependencies. See `artifacts/veloren-live-acceptance.json`.
