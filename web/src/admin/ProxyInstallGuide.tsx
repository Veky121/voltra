import { useState } from "react";
import { Button } from "../lib";
function Command({label,command}: {label:string;command:string}) {
  const [copied,setCopied] = useState(false), [error,setError] = useState("");
  return <div className="proxy-gateways__command"><div className="actions"><strong>{label}</strong><Button type="button" variant="secondary" onClick={() => {void navigator.clipboard.writeText(command).then(() => {setCopied(true); setError("");},() => setError("Copy unavailable. Select and copy the command below."));}}>{copied ? "Copied" : "Copy"}</Button></div><pre><code>{command}</code></pre>{error && <p role="alert">{error}</p>}</div>;
}
export function ProxyInstallGuide() {
  const install = (binary:string) => `set -eu
case "$(uname -m)" in
  x86_64) arch=amd64; checksum=3cf934477f4fb1ee9e19e49c31fb33f5ffe3283300076f59afad8b8ccf1e1621 ;;
  aarch64|arm64) arch=arm64; checksum=8855bd3537adf6f456b4073a1fb6f119885060f3c8b714fd56a842db42b4c097 ;;
  *) echo 'Supported Linux architectures: amd64 and arm64'; exit 1 ;;
esac
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
archive="frp_0.68.0_linux_\${arch}.tar.gz"
curl -fL --proto '=https' --tlsv1.2 "https://github.com/fatedier/frp/releases/download/v0.68.0/$archive" -o "$work/$archive"
printf '%s  %s\\n' "$checksum" "$work/$archive" | sha256sum -c -
tar -xzf "$work/$archive" -C "$work"
sudo install -m 755 "$work/frp_0.68.0_linux_\${arch}/${binary}" /usr/local/bin/${binary}
sudo install -d -m 700 /etc/voltra-frp /var/lib/voltra-frp
sudo install -m 600 "$HOME/Downloads/${binary}.toml" /etc/voltra-frp/${binary}.toml`;
  const service = (binary:string) => `sudo tee /etc/systemd/system/voltra-${binary}.service >/dev/null <<'UNIT'
[Unit]
Description=Voltra FRP ${binary}
Wants=network-online.target
After=network-online.target
[Service]
Type=simple
ExecStart=/usr/local/bin/${binary} -c /etc/voltra-frp/${binary}.toml
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/voltra-frp
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now voltra-${binary}.service
sudo systemctl status voltra-${binary}.service --no-pager`;
  return <div><p className="muted">Linux with systemd, sudo, curl, tar and sha256sum. Supports amd64 and arm64. Transfer each downloaded config to that host's ~/Downloads first, or adjust its source path. These commands install v0.68.0 and verify the official release digest.</p>{(["frps","frpc"] as const).map(binary => <details key={binary}><summary>{binary === "frps" ? "VPS  /  FRPS" : "Node  /  FRPC"}</summary><p>{binary === "frps" ? "Allow the FRPS connection port and selected public TCP/UDP ports in the VPS firewall." : "Keep the FRPC management listener private and allow access only from the panel. The Store file remains in /var/lib/voltra-frp across service restarts. For an HTTPS management URL, provision /etc/voltra-frp/admin.crt and admin.key before starting FRPC."}</p><Command label="Install binary and secret config" command={install(binary)}/><Command label="Start in foreground" command={`sudo /usr/local/bin/${binary} -c /etc/voltra-frp/${binary}.toml`}/><p className="muted">Stop the foreground process with Ctrl+C before enabling the service. Installing or starting FRP can replace an existing instance, so use a dedicated host setup.</p><Command label="Start at boot with systemd" command={service(binary)}/><Command label="View recent logs" command={`sudo journalctl -u voltra-${binary}.service -n 50 --no-pager`}/></details>)}<p className="muted"><a href="https://github.com/fatedier/frp/releases/tag/v0.68.0" target="_blank" rel="noreferrer">Official FRP v0.68.0 release</a></p></div>;
}

