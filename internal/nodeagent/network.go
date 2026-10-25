package nodeagent

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"syscall"
	"time"
	"voltra/internal/nodetunnel"
)

const NetworkCapability = "network-v1"
const NetworkMaxPorts = 64

type NetworkProbeRequest struct {
	IP    string  `json:"ip"`
	Ports []int64 `json:"ports"`
}
type NetworkPortResult struct {
	Port         int64  `json:"port"`
	TCPAvailable bool   `json:"tcp_available"`
	UDPAvailable bool   `json:"udp_available"`
	Reason       string `json:"reason,omitempty"`
}
type NetworkProbeResult struct {
	Status   string              `json:"status"`
	Detail   string              `json:"detail"`
	Snapshot bool                `json:"snapshot"`
	Ports    []NetworkPortResult `json:"ports"`
}

func (q NetworkProbeRequest) Validate() error {
	ip := net.ParseIP(q.IP)
	if ip == nil || ip.IsMulticast() || len(q.Ports) == 0 || len(q.Ports) > NetworkMaxPorts {
		return errors.New("probe requires a literal bind IP and 1 to 64 ports")
	}
	seen := map[int64]bool{}
	for _, p := range q.Ports {
		if p < 1024 || p > 65535 || seen[p] {
			return errors.New("probe ports must be unique and between 1024 and 65535")
		}
		seen[p] = true
	}
	return nil
}

func networkBindReason(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, syscall.EADDRINUSE) {
		return "address_in_use"
	}
	if errors.Is(err, syscall.EACCES) || errors.Is(err, syscall.EPERM) {
		return "permission_denied"
	}
	if errors.Is(err, syscall.EADDRNOTAVAIL) {
		return "bind_address_unavailable"
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "probe_timeout"
	}
	return "bind_failed"
}

// ProbeNetworkPorts opens actual host sockets and closes every socket before
// returning. This is a point-in-time bind check, never a port reservation.
func ProbeNetworkPorts(ctx context.Context, q NetworkProbeRequest) (NetworkProbeResult, error) {
	out := NetworkProbeResult{Status: "verified", Snapshot: true, Detail: "Node TCP and UDP bind snapshot only; ports are not reserved and external reachability is unverified.", Ports: []NetworkPortResult{}}
	if err := q.Validate(); err != nil {
		return out, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	family := "4"
	if net.ParseIP(q.IP).To4() == nil {
		family = "6"
	}
	for _, p := range q.Ports {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		address := net.JoinHostPort(q.IP, strconv.FormatInt(p, 10))
		lc := net.ListenConfig{}
		tcp, te := lc.Listen(ctx, "tcp"+family, address)
		udp, ue := lc.ListenPacket(ctx, "udp"+family, address)
		if tcp != nil {
			_ = tcp.Close()
		}
		if udp != nil {
			_ = udp.Close()
		}
		reason := ""
		if te != nil {
			reason = "tcp:" + networkBindReason(te)
		}
		if ue != nil {
			if reason != "" {
				reason += "; "
			}
			reason += "udp:" + networkBindReason(ue)
		}
		out.Ports = append(out.Ports, NetworkPortResult{p, te == nil, ue == nil, reason})
	}
	return out, nil
}

func networkHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Connection", "close")
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "POST" || r.URL.Path != "/probe" || r.URL.RawQuery != "" {
			http.Error(w, "network service accepts only POST /probe", 404)
			return
		}
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		dec.DisallowUnknownFields()
		var q NetworkProbeRequest
		var extra any
		if dec.Decode(&q) != nil || dec.Decode(&extra) != io.EOF {
			http.Error(w, "invalid network request", 400)
			return
		}
		out, err := ProbeNetworkPorts(r.Context(), q)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		_ = json.NewEncoder(w).Encode(out)
	})
}

func serveNetwork(ctx context.Context, c net.Conn) error {
	l := &singleStreamListener{conn: c, done: make(chan struct{})}
	var handlers sync.WaitGroup
	srv := &http.Server{Handler: networkHandler(), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 8 * time.Second, MaxHeaderBytes: 4096, BaseContext: func(net.Listener) context.Context { return ctx }, ConnState: func(_ net.Conn, s http.ConnState) {
		if s == http.StateNew {
			handlers.Add(1)
		}
		if s == http.StateClosed {
			_ = l.Close()
			handlers.Done()
		}
	}}
	srv.SetKeepAlivesEnabled(false)
	stop := context.AfterFunc(ctx, func() { _ = srv.Close(); _ = l.Close() })
	defer stop()
	err := srv.Serve(l)
	handlers.Wait()
	if errors.Is(err, net.ErrClosed) || errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func bridgeNetwork(ctx context.Context, base *url.URL, c Config, id string) error {
	ws, err := dial(ctx, endpoint(base, "/api/remote/connector/streams/"+id, true), c.Token)
	if err != nil {
		return err
	}
	ws.SetReadLimit(nodetunnel.MaxMessageSize)
	stream := nodetunnel.NewConn(ws)
	defer stream.Close()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return serveNetwork(ctx, stream)
}
