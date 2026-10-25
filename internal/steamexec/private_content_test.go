package steamexec

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func TestPrivateContentFrames(t *testing.T) {
	var b bytes.Buffer
	if err := privateWriteFrame(&b, map[string]string{"password": "secret-fixture"}); err != nil {
		t.Fatal(err)
	}
	var value map[string]string
	if err := privateReadFrame(&b, &value); err != nil || value["password"] != "secret-fixture" {
		t.Fatal("frame roundtrip failed")
	}
	for _, n := range []uint32{0, privateFrameLimit + 1} {
		var h [4]byte
		binary.LittleEndian.PutUint32(h[:], n)
		if privateReadFrame(bytes.NewReader(h[:]), &value) == nil {
			t.Fatal("invalid frame accepted")
		}
	}
	if privateReadFrame(bytes.NewReader([]byte{3, 0, 0, 0, '{'}), &value) == nil {
		t.Fatal("truncated frame accepted")
	}
	if (PrivateContentRequest{Password: "secret"}).String() != "PrivateContentRequest [private]" {
		t.Fatal("request formatting")
	}
}
