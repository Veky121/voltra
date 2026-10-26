package panel

import "testing"

func TestSFTPPublicAddressDoesNotChangeDaemonConnection(t *testing.T) {
	node := M{"id": int64(147), "fqdn": "127.0.0.1", "daemon_listen": int64(18089), "daemon_sftp": int64(12029), "scheme": "http"}
	details := sftpPublicDetails(node, M{"147": M{"host": "sftp.example.com", "port": float64(2022)}})
	if details["ip"] != "sftp.example.com" || num(details["port"]) != 2022 || daemonAddress(node) != "http://127.0.0.1:18089" || num(node["daemon_sftp"]) != 12029 {
		t.Fatalf("public SFTP presentation changed daemon routing: %#v %#v", details, node)
	}
	for _, entry := range []M{{"host": "https://example.com", "port": 2022}, {"host": "user:password@example.com", "port": 2022}, {"host": "example.com\r\nInjected", "port": 2022}, {"host": "example.com", "port": 0}, {"host": "example.com", "port": 65536}, {"host": "example.com", "port": 2022.5}} {
		fallback := sftpPublicDetails(node, M{"147": entry})
		if fallback["ip"] != node["fqdn"] || fallback["port"] != node["daemon_sftp"] {
			t.Fatalf("invalid public address was accepted: %#v", entry)
		}
	}
	if details := sftpPublicDetails(node, M{"250": M{"host": "other.example.com", "port": 2022}}); details["ip"] != node["fqdn"] {
		t.Fatal("another node's public address was used")
	}
}
