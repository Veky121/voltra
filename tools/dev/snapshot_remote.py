"""Read-only inventory export. Executed over SSH; never runs the panel binary."""
import datetime
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import urllib.parse

FORMAT = "voltra.dev.snapshot.v1"
# These are the only database columns allowed to leave production. In particular,
# no SELECT * is used, including when the production schema gains new columns.
COLUMNS = {
    "nests": ["id", "name"],
    "eggs": ["id", "nest_id", "name", "script_is_privileged", "force_outgoing_ip"],
    "egg_variables": ["id", "egg_id", "env_variable", "user_viewable", "user_editable", "field_type"],
    "servers": ["id", "name", "nest_id", "egg_id", "status", "memory", "swap", "disk", "io", "cpu", "oom_disabled", "allocation_limit", "database_limit", "backup_limit"],
}
LIMIT = 10000


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, timeout=45, **kwargs)
    if result.returncode:
        # PostgreSQL/SSH errors can echo credentials or query data. Do not relay.
        raise RuntimeError("Read-only snapshot command failed: " + args[0])
    return result.stdout.strip()


def query_sql():
    parts = []
    for table, columns in COLUMNS.items():
        selection = ",".join('"' + c + '"' for c in columns)
        parts.extend(["'" + table + "'", "(SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM (SELECT " + selection + ' FROM "' + table + '" ORDER BY id LIMIT ' + str(LIMIT + 1) + ") r)"])
    return "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT jsonb_build_object(" + ",".join(parts) + ");\nCOMMIT;\n"


def validate_tables(tables):
    if set(tables) != set(COLUMNS):
        raise ValueError("Unexpected snapshot tables")
    for table, columns in COLUMNS.items():
        rows = tables[table]
        if not isinstance(rows, list) or len(rows) > LIMIT:
            raise ValueError("Snapshot exceeds bounded export size")
        for row in rows:
            if set(row) != set(columns):
                raise ValueError("Unexpected snapshot fields")
            for key, value in row.items():
                if isinstance(value, str) and (len(value) > 256 or any(ord(c) < 32 for c in value)):
                    raise ValueError("Snapshot label is too long or contains control characters")
                if key not in ("name", "env_variable", "field_type", "status") and not isinstance(value, (int, bool)):
                    raise ValueError("Unexpected snapshot scalar type")


def main():
    service = "voltra-panel.service"
    pid = int(run(["systemctl", "show", service, "--property=MainPID", "--value"]))
    if pid <= 1:
        raise RuntimeError("Production panel is not running")
    process = pathlib.Path("/proc") / str(pid)
    runtime = dict(part.split(b"=", 1) for part in (process / "environ").read_bytes().split(b"\0") if b"=" in part)
    connection = urllib.parse.urlsplit(runtime.get(b"DATABASE_URL", b"").decode())
    if connection.scheme not in ("postgres", "postgresql") or connection.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise RuntimeError("Expected a loopback PostgreSQL database from the active panel process")
    user = urllib.parse.unquote(connection.username or "")
    password = urllib.parse.unquote(connection.password or "")
    database = urllib.parse.unquote(connection.path.lstrip("/"))
    if not user or not database or any(c in password + user + database for c in "\r\n\0"):
        raise RuntimeError("Unsupported PostgreSQL connection identity")
    port = str(connection.port or 5432)
    ids = run(["docker", "ps", "-q"]).splitlines()
    containers = json.loads(run(["docker", "inspect", *ids])) if ids else []
    matching = []
    for container in containers:
        mappings = container.get("NetworkSettings", {}).get("Ports", {}).get("5432/tcp") or []
        if any(m.get("HostPort") == port and m.get("HostIp") in ("127.0.0.1", "0.0.0.0", "::", "::1") for m in mappings):
            matching.append(container["Id"])
    if len(matching) != 1:
        raise RuntimeError("Could not uniquely match active database port to PostgreSQL container")

    def psql(sql):
        # Password goes through stdin, not argv, stdout, or a temporary file.
        command = 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$1" -d "$2"'
        return run(["docker", "exec", "-i", "-e", "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000", matching[0], "sh", "-c", command, "snapshot", user, database], input=password + "\n" + sql)

    schema_sql = "SELECT jsonb_object_agg(table_name,columns) FROM (SELECT table_name,jsonb_agg(column_name) AS columns FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('nests','eggs','egg_variables','servers') GROUP BY table_name) t;"
    schema = json.loads(psql(schema_sql))
    if any(not set(columns).issubset(schema.get(table, [])) for table, columns in COLUMNS.items()):
        raise RuntimeError("Production schema does not support the reviewed snapshot fields")
    tables = json.loads(psql(query_sql()))
    validate_tables(tables)
    executable = process / "exe"
    executable_name = executable.resolve().name
    source = {"service": service, "executable": executable_name, "executable_sha256": hashlib.sha256(executable.read_bytes()).hexdigest()}
    web = runtime.get(b"WEB_DIR", b"web/dist").decode()
    web_path = pathlib.Path(web)
    if not web_path.is_absolute():
        web_path = (process / "cwd").resolve() / web_path
    if (web_path / "index.html").is_file():
        source["web_index_sha256"] = hashlib.sha256((web_path / "index.html").read_bytes()).hexdigest()
    print(json.dumps({"format": FORMAT, "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "source": source, "counts": {t: len(v) for t, v in tables.items()}, "tables": tables, "limitations": ["Inventory reference only; not an executable database backup.", "No accounts, credentials, endpoints, environment values, scripts, startup commands, activity, jobs, worlds or backups are copied.", "Server names and resource limits are retained in this private local artifact.", "Use reviewed recipes from the current source checkout for runnable local games."]}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Snapshot failed: " + (str(error) if isinstance(error, (RuntimeError, ValueError)) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
