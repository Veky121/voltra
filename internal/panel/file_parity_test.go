package panel

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"testing"
)

// Exercise the complete HTTP adapter, including permission checks and transforms.
func TestFileParityLargeDirectoryAndNames(t *testing.T) {
	f := operationsFixtureNew(t)
	names := []string{"space name.txt", "日本語 + café #%.txt", ".hidden", "line\nbreak.txt", "a?b&c=d.txt"}
	for i := 0; i < 1200; i++ {
		names = append(names, fmt.Sprintf("file-%04d.txt", i))
	}
	f.daemon.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("directory") != "/日本語 + # %" {
			t.Errorf("directory changed: %q", r.URL.Query().Get("directory"))
		}
		entries := make([]M, len(names))
		for i, name := range names {
			entries[i] = M{"name": name, "file": true, "mime": "text/plain", "mode": "-rw-r--r--", "mode_bits": "644", "size": i, "symlink": i == 0}
		}
		writeJSON(w, 200, entries)
	})
	m := operationsExpect(t, f.request("GET", f.serverPath("/files/list?directory="+url.QueryEscape("/日本語 + # %")), nil, f.sub), 200)
	entries := asSlice(m["data"])
	if len(entries) != len(names) {
		t.Fatalf("listing truncated: got %d, want %d", len(entries), len(names))
	}
	for i, row := range entries {
		attrs := asMap(asMap(row)["attributes"])
		if attrs["name"] != names[i] || str(attrs["mimetype"]) != "text/plain" || num(attrs["size"]) != int64(i) || boolean(attrs["is_symlink"]) != (i == 0) {
			t.Fatalf("entry %d changed: %#v", i, attrs)
		}
	}
}

func TestFileParityOperationForwarding(t *testing.T) {
	f := operationsFixtureNew(t)
	for _, tc := range []struct {
		op, method, daemon string
		body               M
	}{
		{"rename", "PUT", "rename", M{"root": "/配置", "files": []any{M{"from": "a +#.txt", "to": "new &?.txt"}}}},
		{"copy", "POST", "copy", M{"location": "/配置/a +#.txt"}},
		{"delete", "POST", "delete", M{"root": "/配置", "files": []any{"a +#.txt", ".hidden"}}},
		{"compress", "POST", "compress", M{"root": "/配置", "files": []any{"a +#.txt", "nested"}}},
		{"decompress", "POST", "decompress", M{"root": "/配置", "file": "backup.tar.zst"}},
		{"chmod", "POST", "chmod", M{"root": "/配置", "files": []any{M{"file": "a +#.txt", "mode": "0755"}}}},
	} {
		t.Run(tc.op, func(t *testing.T) {
			status := 204
			if tc.op == "compress" {
				status = 200
			}
			operationsExpect(t, f.request(tc.method, f.serverPath("/files/"+tc.op), tc.body, f.owner), status)
			f.mu.Lock()
			call := f.calls[len(f.calls)-1]
			f.mu.Unlock()
			want := M{}
			for key, value := range tc.body {
				want[key] = value
			}
			if want["root"] == nil {
				want["root"] = "/"
			}
			if !strings.HasSuffix(str(call["path"]), "/files/"+tc.daemon) || !reflect.DeepEqual(asMap(call["body"]), want) {
				t.Fatalf("operation changed: %#v", call)
			}
		})
	}
}

func TestFileParityReadOnlySubuserCannotMutate(t *testing.T) {
	f := operationsFixtureNew(t)
	for _, tc := range []struct {
		method, path string
		body         any
	}{
		{"GET", "contents?file=config.txt", nil}, {"GET", "download?file=config.txt", nil}, {"GET", "upload", nil},
		{"POST", "write?file=config.txt", "content"}, {"POST", "copy", M{"location": "config.txt"}},
		{"POST", "create-folder", M{"name": "folder"}}, {"POST", "pull", M{"url": "https://example.com/file"}},
		{"PUT", "rename", M{"files": []any{M{"from": "a", "to": "b"}}}},
		{"POST", "delete", M{"files": []any{"a"}}}, {"POST", "compress", M{"files": []any{"a"}}},
		{"POST", "decompress", M{"file": "a.zip"}}, {"POST", "chmod", M{"files": []any{M{"file": "a", "mode": "644"}}}},
	} {
		t.Run(tc.path, func(t *testing.T) {
			operationsExpect(t, f.request(tc.method, f.serverPath("/files/"+tc.path), tc.body, f.sub), 403)
		})
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.calls) != 0 {
		t.Fatalf("unauthorized operation reached Wings: %#v", f.calls)
	}
}

func TestFileParityFolderAndPullOptionTranslation(t *testing.T) {
	f := operationsFixtureNew(t)
	operationsExpect(t, f.request("POST", f.serverPath("/files/create-folder"), M{"root": "/配置", "name": "nested + #/child"}, f.owner), 204)
	f.mu.Lock()
	call := f.calls[len(f.calls)-1]
	f.mu.Unlock()
	if !strings.HasSuffix(str(call["path"]), "/files/create-directory") || !reflect.DeepEqual(asMap(call["body"]), M{"path": "/配置", "name": "nested + #/child"}) {
		t.Fatalf("folder translation changed: %#v", call)
	}
	operationsExpect(t, f.request("POST", f.serverPath("/files/pull"), M{"url": "https://example.com/a?x=1&y=2", "directory": "/配置", "filename": "a +#.zip", "use_header": true, "foreground": true}, f.owner), 204)
	f.mu.Lock()
	call = f.calls[len(f.calls)-1]
	f.mu.Unlock()
	want := M{"root": "/配置", "url": "https://example.com/a?x=1&y=2", "file_name": "a +#.zip", "use_header": true, "foreground": true}
	if !reflect.DeepEqual(asMap(call["body"]), want) {
		t.Fatalf("pull option translation changed: %#v", call)
	}
}

func TestFileParityOriginalCreatePermission(t *testing.T) {
	f := operationsFixtureNew(t)
	if err := f.a.exec(context.Background(), "UPDATE subusers SET permissions=$1 WHERE user_id=$2 AND server_id=$3", []string{"file.create"}, f.sub["id"], f.server["id"]); err != nil {
		t.Fatal(err)
	}
	// These use ACTION_FILE_CREATE in the original PHP request classes.
	operationsExpect(t, f.request("POST", f.serverPath("/files/write?file=new.txt"), "hello", f.sub), 204)
	operationsExpect(t, f.request("POST", f.serverPath("/files/decompress"), M{"root": "/", "file": "a.zip"}, f.sub), 204)
}
