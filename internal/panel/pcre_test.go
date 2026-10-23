package panel

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPCRENativePHPOracle(t *testing.T) {
	raw, err := os.ReadFile("../../tools/runtime/pcre/oracle-results.json")
	if err != nil {
		t.Fatal(err)
	}
	var oracle struct {
		PCREVersion string `json:"pcre_version"`
		Cases       []struct {
			Name, Pattern, Subject string
			SubjectBase64          string `json:"subject_base64"`
			Result                 any    `json:"result"`
			ErrorCode              int    `json:"error_code"`
		}
	}
	if err = json.Unmarshal(raw, &oracle); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(oracle.PCREVersion, "10.46") {
		t.Fatal("Oracle uses unexpected PCRE version", oracle.PCREVersion)
	}
	for _, tt := range oracle.Cases {
		t.Run(tt.Name, func(t *testing.T) {
			subject := tt.Subject
			if tt.SubjectBase64 != "" {
				bytes, e := base64.StdEncoding.DecodeString(tt.SubjectBase64)
				if e != nil {
					t.Fatal(e)
				}
				subject = string(bytes)
			}
			re, e := compileEggPCRE(tt.Pattern)
			if e != nil {
				if tt.Result == false {
					return
				}
				t.Fatalf("native valid regex rejected: %v", e)
			}
			got, e := re.MatchString(subject)
			if tt.Result == false {
				if e == nil {
					t.Fatal("native error accepted", got)
				}
				return
			}
			if e != nil {
				t.Fatal(e)
			}
			want := tt.Result == float64(1)
			if got != want {
				t.Fatalf("got %v native PHP result %v", got, tt.Result)
			}
		})
	}
}

func TestPCRELimitsAndConcurrentPoolRecovery(t *testing.T) {
	pattern, err := compileEggPCRE("/^(a+)+$/")
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	_, err = pattern.MatchString(strings.Repeat("a", 10000) + "!")
	if err == nil {
		t.Fatal("catastrophic backtracking did not hit a limit")
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatal("match exceeded bounded execution time", elapsed)
	}
	good, err := compileEggPCRE("/^(?|(a)|(b))\\1$/")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errors := make(chan error, 32)
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, e := good.MatchString("bb")
			if e != nil {
				errors <- e
			} else if !ok {
				errors <- context.Canceled
			}
		}()
	}
	wg.Wait()
	close(errors)
	for e := range errors {
		t.Fatal(e)
	}
	// A context timeout closes its Wasm instance synchronously. The pool must
	// discard it and provide a healthy instance for the next request.
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	instance, e := nativeEggPCRE.acquire(ctx)
	cancel()
	if e != nil {
		t.Fatal(e)
	}
	instance.module.Close(context.Background())
	nativeEggPCRE.release(instance)
	if ok, e := good.MatchString("aa"); e != nil || !ok {
		t.Fatal("pool did not recover closed instance", ok, e)
	}
}

func TestPCREPoolDeadlineDoesNotLeakGoroutines(t *testing.T) {
	if _, err := compileEggPCRE("/a/"); err != nil {
		t.Fatal(err)
	}
	before := runtime.NumGoroutine()
	for i := 0; i < 100; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		instance, err := nativeEggPCRE.acquire(ctx)
		if err == nil {
			nativeEggPCRE.release(instance)
		}
	}
	runtime.GC()
	time.Sleep(20 * time.Millisecond)
	if after := runtime.NumGoroutine(); after > before+4 {
		t.Fatalf("goroutines grew from %d to %d", before, after)
	}
}

func TestPCREWasmDeadlineClosesInstance(t *testing.T) {
	re, err := compileEggPCRE("/(*NO_START_OPT)^(a+)+$/")
	if err != nil {
		t.Fatal(err)
	}
	setup, cancelSetup := context.WithTimeout(context.Background(), time.Second)
	defer cancelSetup()
	instance, err := nativeEggPCRE.acquire(setup)
	if err != nil {
		t.Fatal(err)
	}
	defer nativeEggPCRE.release(instance)
	code, err := instance.compile(setup, re)
	if err != nil {
		t.Fatal(err)
	}
	subject := strings.Repeat("a", 100000) + "!"
	ptr, err := instance.write(setup, subject)
	if err != nil {
		t.Fatal(err)
	}
	deadline, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err = instance.module.ExportedFunction("egg_pcre_match").Call(deadline, code, ptr, uint64(len(subject)))
	if err == nil {
		t.Fatal("Wasm computation ignored deadline")
	}
	if time.Since(started) > time.Second {
		t.Fatal("Wasm deadline did not interrupt synchronously")
	}
	if !instance.module.IsClosed() {
		t.Fatal("timed out Wasm module remained reusable")
	}
}

func TestPCRECacheBoundsAndEvictedPatternReuse(t *testing.T) {
	re, err := compileEggPCRE("/^(?|(a)|(b))\\1$(?#eviction-original)/")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 530; i++ {
		if _, err = compileEggPCRE(fmt.Sprintf("~^a$(?#eviction-%d)~", i)); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 12; i++ {
		if _, err = compileEggPCRE(fmt.Sprintf("~^a$(?#%d%s)~", i, strings.Repeat("x", 700000))); err != nil {
			t.Fatal(err)
		}
	}
	nativeEggPCRE.cacheMu.Lock()
	count, bytes := len(nativeEggPCRE.cache), nativeEggPCRE.bytes
	nativeEggPCRE.cacheMu.Unlock()
	if count > 512 || bytes > 8<<20 {
		t.Fatal("Go regex cache exceeded bounds", count, bytes)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	instance, err := nativeEggPCRE.acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(instance.codes) > 128 || instance.bytes > 2<<20 {
		nativeEggPCRE.release(instance)
		t.Fatal("instance regex cache exceeded bounds")
	}
	nativeEggPCRE.release(instance)
	if ok, err := re.MatchString("bb"); err != nil || !ok {
		t.Fatal("evicted pattern could not be recompiled", ok, err)
	}
}
