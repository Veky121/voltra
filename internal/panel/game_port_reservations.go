package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// Operator-owned exclusions protect ports used outside this panel, including
// stopped servers during a migration. Both TCP and UDP are reserved. This
// setting is intentionally separate from reusable, unassigned allocations.
const gamePortReservationsKey = "network.port_reservations"

type gamePortReservations struct {
	Version  int                `json:"version"`
	Nodes    map[string][]int64 `json:"nodes"`
	Gateways map[string][]int64 `json:"gateways"`
}

type gamePortReservationReader interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func readGamePortReservations(ctx context.Context, db gamePortReservationReader, lock bool) (gamePortReservations, error) {
	query := "SELECT value FROM settings WHERE key=$1"
	if lock {
		query += " FOR SHARE"
	}
	var raw []byte
	err := db.QueryRow(ctx, query, gamePortReservationsKey).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return gamePortReservations{}, nil
	}
	if err != nil {
		return gamePortReservations{}, fmt.Errorf("Port reservations could not be read; no new ports were assigned")
	}
	return parseGamePortReservations(raw)
}

func parseGamePortReservations(raw []byte) (gamePortReservations, error) {
	var value gamePortReservations
	invalid := func() (gamePortReservations, error) {
		return gamePortReservations{}, fmt.Errorf("Port reservation configuration is invalid; correct network.port_reservations before assigning ports")
	}
	if len(raw) > 131072 {
		return invalid()
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&value) != nil || value.Version != 1 || decoder.Decode(new(any)) != io.EOF {
		return invalid()
	}
	total := 0
	for _, scopes := range []map[string][]int64{value.Nodes, value.Gateways} {
		if len(scopes) > 128 {
			return invalid()
		}
		for key, ports := range scopes {
			id, err := strconv.ParseInt(key, 10, 64)
			if err != nil || id < 1 || strconv.FormatInt(id, 10) != key {
				return invalid()
			}
			seen := map[int64]bool{}
			for _, port := range ports {
				total++
				if port < 1 || port > 65535 || seen[port] || total > 8192 {
					return invalid()
				}
				seen[port] = true
			}
		}
	}
	return value, nil
}

func reservedGamePort(ports []int64, port int64) bool {
	for _, candidate := range ports {
		if candidate == port {
			return true
		}
	}
	return false
}

func (r gamePortReservations) nodePorts(id int64) []int64 {
	return r.Nodes[strconv.FormatInt(id, 10)]
}

func (r gamePortReservations) gatewayPorts(id int64) []int64 {
	ports := r.Gateways[strconv.FormatInt(id, 10)]
	if ports == nil {
		return []int64{}
	}
	return ports
}
