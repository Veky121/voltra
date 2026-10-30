package panel

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestFS25SaveProtocol(t *testing.T) {
	for _, mode := range []string{"confirmed", "failed", "stale", "busy", "wrong-request", "wrong-session", "unavailable", "write-failed", "stop-confirmed", "stop-unconfirmed"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 600*time.Millisecond)
			defer cancel()
			var request M
			writes := 0
			read := func(ctx context.Context, name string, out any) error {
				var data M
				if name == "state.json" {
					if mode == "unavailable" {
						return errors.New("offline")
					}
					updated := time.Now().UnixMilli()
					if mode == "stale" {
						updated -= 20000
					}
					data = M{"protocol": 1, "session": "test-session", "updated_at": updated, "busy": mode == "busy"}
				} else {
					data = M{"id": request["id"], "session": "test-session", "success": mode != "failed"}
					data["stopped"] = mode == "stop-confirmed"
					if mode == "wrong-request" {
						data["id"] = "older-request"
					}
					if mode == "wrong-session" {
						data["session"] = "older-session"
					}
				}
				body, _ := json.Marshal(data)
				return json.Unmarshal(body, out)
			}
			write := func(ctx context.Context, body []byte) error {
				writes++
				if mode == "write-failed" {
					return errors.New("write failed")
				}
				return json.Unmarshal(body, &request)
			}
			action := "save"
			if strings.HasPrefix(mode, "stop-") {
				action = "save-and-stop"
			}
			err := fs25RunSave(ctx, read, write, action)
			if mode == "confirmed" || mode == "stop-confirmed" {
				if err != nil {
					t.Fatal(err)
				}
				if len(str(request["id"])) != 32 || request["action"] != action {
					t.Fatal(request)
				}
			} else if err == nil {
				t.Fatal("unconfirmed save accepted")
			}
			if (mode == "stale" || mode == "busy" || mode == "unavailable") && writes != 0 {
				t.Fatal("request sent to unavailable worker")
			}
			if strings.HasPrefix(mode, "wrong-") && !strings.Contains(err.Error(), "not confirmed") {
				t.Fatal(err)
			}
		})
	}
}
