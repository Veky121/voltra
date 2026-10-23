package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

// Dedicated transport prevents redirects and environment proxies from forwarding admin credentials.
func proxyStoreCall(ctx context.Context, origin, user, password, method, path string, body any) (M, int, error) {
	if e := proxyPrivateURL(origin); e != nil {
		return nil, 0, e
	}
	var data []byte
	var e error
	if body != nil {
		data, e = json.Marshal(body)
		if e != nil {
			return nil, 0, e
		}
	}
	req, e := http.NewRequestWithContext(ctx, method, origin+path, bytes.NewReader(data))
	if e != nil {
		return nil, 0, fmt.Errorf("invalid FRPC request")
	}
	req.SetBasicAuth(user, password)
	req.Header.Set("Content-Type", "application/json")
	transport := &http.Transport{DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext, TLSHandshakeTimeout: 5 * time.Second}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, e := client.Do(req)
	if e != nil {
		return nil, 0, fmt.Errorf("FRPC request failed")
	}
	defer resp.Body.Close()
	raw, e := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if e != nil {
		return nil, resp.StatusCode, fmt.Errorf("FRPC response failed")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return M{}, resp.StatusCode, nil
	}
	if path == "/api/config" {
		return M{"_raw_config": string(raw)}, resp.StatusCode, nil
	}
	out := M{}
	if len(raw) > 0 {
		if e = json.Unmarshal(raw, &out); e != nil {
			return nil, resp.StatusCode, fmt.Errorf("FRPC JSON response invalid")
		}
	}
	return out, resp.StatusCode, nil
}
