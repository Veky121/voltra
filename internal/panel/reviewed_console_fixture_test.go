package panel

import (
"crypto/sha256"
"encoding/hex"
"os"
"strings"
"testing"
)

func reviewedConsoleV1(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile("../../tools/runtime/fixtures/native-console-v1.py")
	if err != nil {
		t.Fatal(err)
	}
	data = []byte(strings.ReplaceAll(string(data), "\r\n", "\n"))
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5" {
		t.Fatal("reviewed console fixture changed")
	}
	return data
}
