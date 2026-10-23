// Voltra regression for the locally marked BSD-2-Clause snapshot-age fix.
package teeworlds7

import (
	"io"
	"log"
	"testing"

	"github.com/teeworlds-go/protocol/messages7"
	"github.com/teeworlds-go/protocol/packer"
	"github.com/teeworlds-go/protocol/protocol7"
	"github.com/teeworlds-go/protocol/snapshot7"
)

func TestVoltraSnapshotAge(t *testing.T) {
	for _, current := range []int{0, 2} {
		client := NewClient()
		client.Logger = log.New(io.Discard, "", 0)
		client.SnapshotStorage.CurrentRecvTick = current
		if err := client.SnapshotStorage.Add(0, &snapshot7.Snapshot{}); err != nil {
			t.Fatal(err)
		}
		count := 0
		client.OnSnapshot(func(_ *snapshot7.Snapshot, _ DefaultAction) error { count++; return nil })
		_, err := client.processSystem(&messages7.SnapEmpty{GameTick: 1, DeltaTick: 1}, &protocol7.Packet{})
		if err != nil {
			t.Fatal(err)
		}
		if current == 0 && count != 1 {
			t.Fatal("newer snapshot was dropped")
		}
		if current == 2 && count != 0 {
			t.Fatal("older snapshot was accepted")
		}
	}
}

func TestVoltraCompleteMultipartSnapshot(t *testing.T) {
	client := NewClient()
	client.Logger = log.New(io.Discard, "", 0)
	if err := client.SnapshotStorage.Add(0, &snapshot7.Snapshot{}); err != nil {
		t.Fatal(err)
	}
	count := 0
	client.OnSnapshot(func(_ *snapshot7.Snapshot, _ DefaultAction) error { count++; return nil })
	payload := append(packer.PackInt(600), 0, 0)
	for i := 0; i < 600; i++ {
		payload = append(payload, packer.PackInt(i+1000)...)
	}
	for part, data := range [][]byte{payload[:900], payload[900:]} {
		_, err := client.processSystem(&messages7.Snap{GameTick: 1, DeltaTick: 1, NumParts: 2, Part: part, Data: data}, &protocol7.Packet{})
		if err != nil {
			t.Fatal(err)
		}
	}
	if count != 1 {
		t.Fatal("complete two-part snapshot was discarded")
	}
}
