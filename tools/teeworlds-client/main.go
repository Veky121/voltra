// MIT. Bounded headless protocol acceptance using the upstream client library.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/teeworlds-go/protocol/messages7"
	"github.com/teeworlds-go/protocol/object7"
	"github.com/teeworlds-go/protocol/protocol7"
	"github.com/teeworlds-go/protocol/snapshot7"
	"github.com/teeworlds-go/protocol/teeworlds7"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "Usage: teeworlds-client IP:PORT")
		os.Exit(2)
	}
	host, portText, err := net.SplitHostPort(os.Args[1])
	if err != nil {
		panic(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		panic("Invalid port")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client := teeworlds7.NewClient()
	client.Name = "VoltraAcceptance"
	client.Logger = log.New(io.Discard, "", 0)
	client.OnTick(func(next teeworlds7.DefaultAction) error { return next() })
	var info *messages7.ServerInfo
	snapshots := 0
	positions := [][2]int{}
	charactersSeen := 0
	rconRequired := os.Getenv("TEEWORLDS_RCON_PASSWORD") != ""
	rankRequired := os.Getenv("TEEWORLDS_RANK_CHECK") == "1"
	rankSeen, rankRequested := false, false
	rankMessages := []string{}
	client.OnChat(func(message *messages7.SvChat, next teeworlds7.DefaultAction) error {
		if strings.Contains(message.Message, "VoltraAcceptanc") && strings.Contains(message.Message, "3.45") {
			rankSeen = true
			rankMessages = append(rankMessages, message.Message)
		}
		return next()
	})
	rconAuthenticated, rconMarker := false, false
	rconSent := false
	client.OnPacket(func(packet *protocol7.Packet) bool {
		for _, message := range packet.Messages {
			switch value := message.(type) {
			case *messages7.RconAuthOn:
				rconAuthenticated = true
				query := os.Getenv("TEEWORLDS_RCON_QUERY")
				if query == "" {
					query = "sv_scorelimit"
				}
				if err := client.SendMessage(&messages7.RconCmd{Command: query}); err != nil {
					client.CancelCause(err)
				}
			case *messages7.RconLine:
				if strings.Contains(value.Line, "517") {
					rconMarker = true
				}
			}
		}
		return true
	})
	client.OnSendPacket(func(packet *protocol7.Packet) bool {
		for _, message := range packet.Messages {
			if hello, ok := message.(*messages7.Info); ok {
				hello.Password = os.Getenv("TEEWORLDS_PASSWORD")
			}
		}
		return true
	})
	client.OnServerInfo(func(message *messages7.ServerInfo, next teeworlds7.DefaultAction) error {
		copy := *message
		info = &copy
		if rconRequired && !rconSent {
			rconSent = true
			if err := client.SendMessage(&messages7.RconAuth{Password: os.Getenv("TEEWORLDS_RCON_PASSWORD")}); err != nil {
				return err
			}
		}
		return next()
	})
	client.OnSnapshot(func(snapshot *snapshot7.Snapshot, next teeworlds7.DefaultAction) error {
		if err := next(); err != nil {
			return err
		}
		snapshots++
		if rankRequired && snapshots >= 10 && !rankRequested {
			rankRequested = true
			if err := client.SendChat("/rank"); err != nil {
				return err
			}
		}
		var character *object7.Character
		for _, item := range snapshot.Items {
			if _, ok := item.(*object7.Character); ok {
				charactersSeen++
			}
			if candidate, ok := item.(*object7.Character); ok && candidate.ItemId == client.LocalClientId {
				character = candidate
				break
			}
		}
		if character != nil {
			position := [2]int{character.X, character.Y}
			if len(positions) == 0 || position != positions[len(positions)-1] {
				positions = append(positions, position)
			}
			client.Right()
		}
		if snapshots >= 100 && len(positions) >= 2 && info != nil && (!rconRequired || rconAuthenticated && rconMarker) && (!rankRequired || rankSeen) {
			cancel()
		}
		return nil
	})
	err = client.ConnectContext(ctx, host, port)
	result := map[string]any{"snapshots": snapshots, "distinct_positions": len(positions), "headless_player_join_verified": snapshots > 0, "movement_observed": len(positions) > 1, "graphical_client_verified": false}
	result["rcon_authenticated"] = rconAuthenticated
	result["local_client_id"] = client.LocalClientId
	result["character_objects_seen"] = charactersSeen
	result["rcon_operator_setting_read"] = rconMarker
	result["seeded_native_rank_read"] = rankSeen
	if rankRequired {
		result["rank_messages"] = rankMessages
	}
	if info != nil {
		result["server"] = map[string]any{"version": info.Version, "name": info.Name, "map": info.MapName, "game_type": info.GameType, "max_clients": info.MaxClients, "password_required": info.Flags&1 != 0}
	}
	if err != nil && snapshots == 0 {
		result["connection_failed"] = true
	}
	json.NewEncoder(os.Stdout).Encode(result)
	if snapshots < 100 || len(positions) < 2 || info == nil || rconRequired && (!rconAuthenticated || !rconMarker) || rankRequired && !rankSeen {
		os.Exit(1)
	}
}
