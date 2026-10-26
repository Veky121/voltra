package panel

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

type minecraftArchiveBody struct {
	io.Reader
	closed  bool
	maxRead int
}

func (b *minecraftArchiveBody) Read(p []byte) (int, error) {
	if len(p) > b.maxRead {
		b.maxRead = len(p)
	}
	return b.Reader.Read(p)
}
func (b *minecraftArchiveBody) Close() error { b.closed = true; return nil }

type minecraftBrokenArchive struct{}

func TestMinecraftArchiveExpandedBudget(t *testing.T) {
	// Declare sizes in ZIP metadata without allocating GiB fixtures.
	for _, count := range []int{6, 9} {
		files := map[string][]byte{}
		for i := 0; i < count; i++ {
			files[string(rune('a'+i))+".jar"] = []byte("tiny")
		}
		data := minecraftFixtureZip(t, files)
		at := 0
		for i := 0; i < count; i++ {
			pos := bytes.Index(data[at:], []byte{'P', 'K', 1, 2}) + at
			binary.LittleEndian.PutUint32(data[pos+24:], 512<<20)
			at = pos + 46
		}
		_, err := minecraftReadZip(data)
		if (err == nil) != (count == 6) {
			t.Fatalf("expanded entries=%d error=%v", count, err)
		}
	}
}

func (minecraftBrokenArchive) Read([]byte) (int, error) {
	return 0, errors.New("fixture connection lost")
}

func TestMinecraftArchiveStreamsAndCleansUp(t *testing.T) {
	directory := t.TempDir()
	for _, name := range []string{"TMPDIR", "TMP", "TEMP"} {
		t.Setenv(name, directory)
	}
	data := minecraftFixtureZip(t, map[string][]byte{"mods/server.jar": []byte("verified content")})
	file := minecraftDownload{URL: "https://edge.forgecdn.net/server.zip", Algorithm: "sha1", Hash: minecraftFixtureHash(data, "sha1")}
	for _, scenario := range []string{"success", "checksum", "interrupted", "too-large", "invalid-zip"} {
		t.Run(scenario, func(t *testing.T) {
			payload := data
			if scenario == "invalid-zip" {
				payload = []byte("not a zip")
			}
			body := &minecraftArchiveBody{Reader: bytes.NewReader(payload)}
			if scenario == "interrupted" {
				body.Reader = minecraftBrokenArchive{}
			}
			length := int64(len(payload))
			if scenario == "too-large" {
				length = minecraftArchiveLimit + 1
			}
			a := &App{HTTP: &http.Client{Transport: gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
				if r.Header.Get("x-api-key") != "" {
					t.Fatal("credential in archive download")
				}
				return &http.Response{StatusCode: 200, Body: body, ContentLength: length, Header: make(http.Header)}, nil
			})}}
			selection := file
			if scenario == "checksum" {
				selection.Hash = strings.Repeat("0", 40)
			}
			if scenario == "invalid-zip" {
				selection.Hash = minecraftFixtureHash(payload, "sha1")
			}
			reader, cleanup, err := a.minecraftFetchArchive(context.Background(), selection)
			if !body.closed {
				t.Fatal("download body not closed")
			}
			if scenario == "success" {
				if err != nil {
					t.Fatal(err)
				}
				if len(reader.File) != 1 || reader.File[0].Name != "mods/server.jar" {
					t.Fatal("archive contents changed")
				}
				if body.maxRead > 64<<10 {
					t.Fatalf("unbounded download buffer: %d", body.maxRead)
				}
				files, _ := os.ReadDir(directory)
				if len(files) != 1 {
					t.Fatal("archive was not staged on disk")
				}
				cleanup()
			} else if err == nil {
				cleanup()
				t.Fatal("invalid download accepted")
			}
			files, _ := os.ReadDir(directory)
			if len(files) != 0 {
				t.Fatal("temporary archive leaked")
			}
		})
	}
}
