package chunk7

import (
	"bytes"
	"github.com/teeworlds-go/protocol/packer"
	"testing"
)

func TestVoltraHeaderWidths(t *testing.T) {
	known := ChunkHeader{Flags: ChunkFlags{Vital: true}, Size: 900, Seq: 768}
	if !bytes.Equal(known.Pack(), []byte{0x4e, 0xc4, 0}) {
		t.Fatalf("protocol bit layout: %x", known.Pack())
	}
	for _, size := range []int{0, 63, 64, 255, 256, 900, 1391} {
		for _, sequence := range []int{0, 1, 255, 256, 511, 768, 1023} {
			want := ChunkHeader{Flags: ChunkFlags{Vital: true}, Size: size, Seq: sequence}
			var raw, stream ChunkHeader
			if err := raw.UnpackRaw(want.Pack()); err != nil {
				t.Fatal(err)
			}
			u := &packer.Unpacker{}
			u.Reset(want.Pack())
			if err := stream.Unpack(u); err != nil {
				t.Fatal(err)
			}
			if raw != want || stream != want {
				t.Fatalf("lost protocol bits: want %+v got %+v %+v", want, raw, stream)
			}
		}
	}
}
