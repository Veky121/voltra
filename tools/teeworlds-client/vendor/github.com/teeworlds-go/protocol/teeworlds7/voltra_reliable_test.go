package teeworlds7

import (
	"github.com/teeworlds-go/protocol/chunk7"
	"github.com/teeworlds-go/protocol/messages7"
	"github.com/teeworlds-go/protocol/protocol7"
	"io"
	"log"
	"testing"
)

func TestVoltraReliableSequence(t *testing.T) {
	client := NewClient()
	client.Logger = log.New(io.Discard, "", 0)
	count := 0
	client.OnBroadcast(func(_ *messages7.SvBroadcast, _ DefaultAction) error { count++; return nil })
	response := &protocol7.Packet{}
	for _, seq := range []int{1, 1, 2, 4, 3, 4} {
		_, err := client.processMessage(client.Logger, &messages7.SvBroadcast{ChunkHeader: &chunk7.ChunkHeader{Flags: chunk7.ChunkFlags{Vital: true}, Seq: seq}}, response)
		if err != nil {
			t.Fatal(err)
		}
	}
	if client.Session.Ack != 4 || count != 4 || !response.Header.Flags.Resend {
		t.Fatalf("reliable ordering: ack=%d callbacks=%d resend=%v", client.Session.Ack, count, response.Header.Flags.Resend)
	}
	client.Session.Ack = 1023
	_, err := client.processMessage(client.Logger, &messages7.SvBroadcast{ChunkHeader: &chunk7.ChunkHeader{Flags: chunk7.ChunkFlags{Vital: true}, Seq: 0}}, response)
	if err != nil || client.Session.Ack != 0 || count != 5 {
		t.Fatal("reliable sequence did not wrap")
	}
}
