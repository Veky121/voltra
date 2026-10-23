# Shared game-query acceptance tools

GameDig 5.3.3 is pinned in this separate development package. It is not a panel
runtime dependency. Install with `npm ci --ignore-scripts`; package-lock.json and
UPSTREAM_LICENSE retain the dependency identity and GameDig's MIT notice.

```text
node query.mjs protocol-quake3 192.0.2.1 23560
```

Queries only the supplied UDP port, with bounded timeouts and no default-port
fallback. Output contains selected public status fields, not arbitrary raw rules.
The tool normalizes Quake password flags and player limits. Native queries do not
prove a player join or graphical gameplay.

`rcon-quake3.mjs HOST PORT COMMAND` provides a small native-protocol read probe.
The password comes from QUAKE3_RCON_PASSWORD and is never a command argument.
Commands are limited to status and the acceptance setting reads. This tool is
for owned acceptance servers and is separate from the dashboard console.

Primary project: https://github.com/gamedig/node-gamedig

`python3 rcon-darkplaces.py HOST PORT COMMAND` is a Linux development probe for
native challenge HMAC-MD4 RCON. It uses Python's HMAC and the installed OpenSSL 3
MD4 primitive, checks a known MD4 vector before use, and has no plaintext fallback.
The password comes from DARKPLACES_RCON_PASSWORD. Only selected read commands are
allowed. The probe is separate from the panel and does not add a runtime package.
