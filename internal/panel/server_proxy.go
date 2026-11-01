package panel

import "net/http"

// Server-local setup uses the same durable routes and tested clients as library
// installation. It never edits allocations or guesses protocols for unknown games.
func (a *App) serverProxySetup(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	server, err := a.server(r, "allocation.read")
	if err != nil {
		fail(w, err)
		return
	}
	ctx := r.Context()
	if r.Method == "POST" {
		input, err := decode(r)
		if err != nil {
			fail(w, err)
			return
		}
		client, okClient := applicationInteger(input["client_id"])
		allocation, okAllocation := applicationInteger(input["allocation_id"])
		public := int64(0)
		okPort := true
		if v, present := input["public_port"]; present {
			public, okPort = applicationInteger(v)
		}
		protocol := str(input["protocol"])
		if !okClient || client < 1 || !okAllocation || allocation < 1 || !okPort || public < 0 || public > 65535 || (protocol != "tcp" && protocol != "udp") {
			fail(w, bad("Choose a server port, gateway and TCP or UDP. Public port must be automatic or between 1 and 65535."))
			return
		}
		assigned, err := a.one(ctx, "SELECT ip,port FROM allocations WHERE id=$1 AND server_id=$2 AND node_id=$3", allocation, server["id"], server["node_id"])
		if err != nil {
			fail(w, bad("This port is no longer assigned to the server. Reload Network and choose another port."))
			return
		}
		route, err := a.createSelectedGameFRPRoute(ctx, M{"id": server["node_id"]}, server, str(assigned["ip"]), num(assigned["port"]), protocol, client, public)
		if err != nil {
			fail(w, proxyConflict(err.Error()))
			return
		}
		writeJSON(w, 200, item("proxy_route", M{"id": route["id"], "gateway_id": route["gateway_id"], "public_host": route["public_host"], "public_port": route["public_port"], "protocol": route["protocol"], "status": route["status"]}))
		return
	}
	allocations, err := a.query(ctx, "SELECT id,ip,port,notes,(id=$2) AS is_default FROM allocations WHERE server_id=$1 ORDER BY (id=$2) DESC,id", server["id"], server["allocation_id"])
	if err != nil {
		fail(w, err)
		return
	}
	clients, err := a.query(ctx, `SELECT c.id,c.gateway_id,c.local_port_start,c.local_port_end,c.setup_complete,c.test_status,g.name,g.public_host,g.public_port_start,g.public_port_end FROM proxy_node_clients c JOIN proxy_gateways g ON g.id=c.gateway_id WHERE c.node_id=$1 ORDER BY g.name,c.id`, server["node_id"])
	if err != nil {
		fail(w, err)
		return
	}
	routes, err := a.query(ctx, `SELECT r.id,r.gateway_id,r.client_id,r.allocation_id,r.local_ip,r.local_port,r.public_port,r.protocol,r.status,r.desired_present,r.last_error,g.name AS gateway_name,g.public_host FROM proxy_routes r JOIN proxy_gateways g ON g.id=r.gateway_id WHERE r.server_id=$1 ORDER BY r.id`, server["id"])
	if err != nil {
		fail(w, err)
		return
	}
	protocol := ""
	egg, err := a.one(ctx, "SELECT uuid FROM eggs WHERE id=$1", server["egg_id"])
	if err != nil {
		fail(w, err)
		return
	}
	if str(egg["uuid"]) == minecraftLibraryEggUUID {
		protocol = "tcp"
	}
	writeJSON(w, 200, item("server_proxy_setup", M{"allocations": allocations, "clients": clients, "routes": routes, "primary_protocol": protocol}))
}
