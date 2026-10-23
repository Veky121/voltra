package panel

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func eggEncodingPHP(t *testing.T, script string, input []byte) []byte {
	t.Helper()
	path := filepath.Join(t.TempDir(), "encoding-oracle.php")
	if err := os.WriteFile(path, []byte("<?php error_reporting(0);if(PHP_VERSION_ID<80500||PHP_VERSION_ID>=80600){exit(77);}"+script), 0600); err != nil {
		t.Fatal(err)
	}
	var command *exec.Cmd
	if runtime.GOOS == "windows" {
		if _, err := exec.LookPath("wsl"); err != nil {
			t.Skip("WSL PHP unavailable")
		}
		p := filepath.ToSlash(path)
		command = exec.Command("wsl", "-d", "Ubuntu", "--", "php", "/mnt/"+strings.ToLower(p[:1])+p[2:])
	} else {
		if _, err := exec.LookPath("php"); err != nil {
			t.Skip("PHP unavailable")
		}
		command = exec.Command("php", path)
	}
	command.Stdin = bytes.NewReader(input)
	var diagnostics bytes.Buffer
	command.Stderr = &diagnostics
	output, err := command.Output()
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 77 {
			t.Skip("Native encoding oracle requires the pinned PHP 8.5 codec registry")
		}
		t.Fatalf("Encoding native oracle failed: %v %s %s", err, output, diagnostics.String())
	}
	if diagnostics.Len() > 0 {
		t.Log("Native oracle emitted stderr diagnostics; JSON stdout is parsed separately.")
	}
	return output
}

func TestEggEncodingAllNativeCodecs(t *testing.T) {
	names := strings.Split(eggEncodingNames, ",")
	if len(names) != 79 {
		t.Fatalf("canonical list has %d encodings", len(names))
	}
	output := eggEncodingPHP(t, `echo json_encode(mb_list_encodings(),JSON_THROW_ON_ERROR);`, nil)
	var nativeNames []string
	if err := json.Unmarshal(output, &nativeNames); err != nil {
		t.Fatal(err)
	}
	if strings.Join(nativeNames, ",") != eggEncodingNames {
		t.Fatal("Canonical native encoding list changed")
	}
	vectors := [][]byte{nil, []byte("ASCII line\n"), []byte("héllo 日本語 U0001f642"), []byte{0xEF, 0xBB, 0xBF}, []byte{0xFE, 0xFF, 0xD8, 0x00, 0xDC, 0x00}, []byte{0x1b, '$', 'B', 0x24, 0x22, 0x1b, '(', 'B'}, []byte{'+', 'A', 'D', 'w', '-'}, []byte{'&', 'A', 'O', 'k', '-'}, []byte{'~', '{', 0x24, 0x22, '~', '}'}}
	for i := 0; i < 256; i++ {
		vectors = append(vectors, []byte{byte(i)})
	}
	rng := rand.New(rand.NewSource(854))
	for _, length := range []int{2, 3, 4, 5, 7, 8, 16, 127, 128, 129, 255, 256, 257, 1024} {
		for sample := 0; sample < 4; sample++ {
			v := make([]byte, length)
			_, _ = rng.Read(v)
			vectors = append(vectors, v)
		}
	}
	for _, length := range []int{127, 128, 129, 255, 256, 257} {
		vectors = append(vectors, bytes.Repeat([]byte("a"), length), bytes.Repeat([]byte{0xC3, 0xA9}, length))
	}
	encoded := make([]string, len(vectors))
	for i, v := range vectors {
		encoded[i] = base64.StdEncoding.EncodeToString(v)
	}
	input, _ := json.Marshal(encoded)
	output = eggEncodingPHP(t, `$vectors=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);$result=[];foreach(mb_list_encodings() as $encoding){foreach($vectors as $raw){$result[]=mb_check_encoding(base64_decode($raw,true),$encoding);}}echo json_encode($result,JSON_THROW_ON_ERROR);`, input)
	var expected []bool
	if err := json.Unmarshal(output, &expected); err != nil {
		t.Fatalf("Invalid native output: %v", err)
	}
	if len(expected) != len(names)*len(vectors) {
		t.Fatal("Native oracle lost cases")
	}
	for n, name := range names {
		for i, v := range vectors {
			valid, err := eggEncodingBytes(context.Background(), v, name)
			if err != nil || valid != expected[n*len(vectors)+i] {
				t.Fatalf("%s vector%d base64=%s Go=%v native=%v err=%v", name, i, encoded[i], valid, expected[n*len(vectors)+i], err)
			}
		}
	}
	t.Logf("All %d raw-byte vectors match PHP mb_check_encoding across %d canonical codecs (%d comparisons)", len(vectors), len(names), len(expected))
}

func TestEggEncodingBoundaries(t *testing.T) {
	sum := sha256.Sum256(eggEncodingBinary)
	if hex.EncodeToString(sum[:]) != "4d1f4fb9d093fd5fe4194ce473627329862c4568e590fe86b4d6d4f676585ac6" {
		t.Fatal("Rebuild encoding checksum/provenance changed")
	}
	for _, name := range []string{"UTF8", "US-ASCII", "LATIN1", "unrecognized"} {
		if eggEncodingSupported(name) {
			t.Fatal("Laravel rejects noncanonical alias", name)
		}
	}
	if valid, err := eggEncodingBytes(context.Background(), make([]byte, (1<<20)+1), "UTF-8"); valid || err == nil {
		t.Fatal("Oversized validation input accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if valid, err := eggEncodingBytes(ctx, []byte("test"), "UTF-8"); valid || err == nil {
		t.Fatal("Canceled validation passed")
	}
	for _, value := range []any{M{"a": "ASCII"}, []any{M{"nested": []any{"valid", true, 123, nil}}}} {
		if valid, err := validateEggEncoding(value, "ASCII"); !valid || err != nil {
			t.Fatal("Recursive encoding failed", err)
		}
	}
	if valid, err := validateEggEncoding(M{"é": "ASCII"}, "ASCII"); valid || err != nil {
		t.Fatal("Array key encoding not validated", err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				if valid, err := eggEncodingBytes(context.Background(), []byte("valid"), "UTF-8"); !valid || err != nil {
					t.Error("Concurrent validation", err)
					return
				}
			}
		}()
	}
	wg.Wait()
}
