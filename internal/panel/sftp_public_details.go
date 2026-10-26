package panel

import (
	"context"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
)

var sftpPublicHostname = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$`)

// A forwarded SFTP address is presentation metadata. It must not replace the
// private Wings API address or the daemon's actual SFTP bind configuration.
func sftpPublicDetails(node, configured M) M {
	fallback := M{"ip": node["fqdn"], "port": node["daemon_sftp"]}
	entry := asMap(configured[strconv.FormatInt(num(node["id"]), 10)])
	host := strings.TrimSpace(str(entry["host"]))
	if host == "" || len(host) > 253 || net.ParseIP(host) == nil && !sftpPublicHostname.MatchString(host) {
		return fallback
	}
	port := num(node["daemon_sftp"])
	if value, present := entry["port"]; present {
		port = num(value)
		if fmt.Sprint(value) != strconv.FormatInt(port, 10) {
			return fallback
		}
	}
	if port < 1 || port > 65535 {
		return fallback
	}
	return M{"ip": host, "port": port}
}

func (a *App) clientSFTPDetails(ctx context.Context, node M) M {
	configured := M{}
	if a.DB != nil {
		if row, err := a.one(ctx, "SELECT value FROM settings WHERE key='network.sftp_public_addresses'"); err == nil {
			configured = asMap(row["value"])
		}
	}
	return sftpPublicDetails(node, configured)
}
