package panel

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
)

//go:embed pcre.wasm
var eggPCREBinary []byte

type eggPCRE struct {
	body, key      string
	options, extra uint32
}
type eggPCREInstance struct {
	module api.Module
	codes  map[string]uint64
	order  []string
	bytes  int
}
type eggPCREPool struct {
	once     sync.Once
	runtime  wazero.Runtime
	compiled wazero.CompiledModule
	err      error
	idle     chan *eggPCREInstance
	slots    chan struct{}
	cacheMu  sync.Mutex
	cache    map[string]*eggPCRE
	order    []string
	bytes    int
}

var nativeEggPCRE eggPCREPool

const eggPCRETimeout = 250 * time.Millisecond

func (p *eggPCREPool) initialize() {
	p.once.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		p.runtime = wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfig().WithMemoryLimitPages(1024).WithCloseOnContextDone(true))
		if _, p.err = wasi_snapshot_preview1.Instantiate(ctx, p.runtime); p.err != nil {
			return
		}
		p.compiled, p.err = p.runtime.CompileModule(ctx, eggPCREBinary)
		if p.err != nil {
			return
		}
		capacity := runtime.GOMAXPROCS(0)
		if capacity > 8 {
			capacity = 8
		}
		if capacity < 1 {
			capacity = 1
		}
		p.slots = make(chan struct{}, capacity)
		p.idle = make(chan *eggPCREInstance, capacity)
		p.cache = map[string]*eggPCRE{}
	})
}
func (p *eggPCREPool) acquire(ctx context.Context) (*eggPCREInstance, error) {
	select {
	case p.slots <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	select {
	case instance := <-p.idle:
		if !instance.module.IsClosed() {
			return instance, nil
		}
	default:
	}
	module, err := p.runtime.InstantiateModule(ctx, p.compiled, wazero.NewModuleConfig().WithName("").WithStartFunctions("_initialize"))
	if err != nil {
		<-p.slots
		return nil, err
	}
	return &eggPCREInstance{module: module, codes: map[string]uint64{}}, nil
}
func (p *eggPCREPool) release(instance *eggPCREInstance) {
	if !instance.module.IsClosed() {
		p.idle <- instance
	}
	<-p.slots
}

// splitEggPCRE follows PHP's delimiter scanner, including paired delimiter
// nesting and escaped delimiters. The pattern bytes are passed unchanged to PCRE2.
func splitEggPCRE(pattern string) (*eggPCRE, error) {
	if len(pattern) > 4<<20 {
		return nil, bad("Egg regular expressions are limited to 4 MiB.")
	}
	start := 0
	for start < len(pattern) && strings.ContainsRune(" \t\r\n\v\f", rune(pattern[start])) {
		start++
	}
	if start >= len(pattern) {
		return nil, bad("Empty regular expression.")
	}
	open := pattern[start]
	if open == 0 || open == '\\' || open >= 'a' && open <= 'z' || open >= 'A' && open <= 'Z' || open >= '0' && open <= '9' {
		return nil, bad("Regex delimiter must not be alphanumeric, backslash, or NUL.")
	}
	close := open
	switch open {
	case '(':
		close = ')'
	case '[':
		close = ']'
	case '{':
		close = '}'
	case '<':
		close = '>'
	}
	end, level := -1, 1
	for i := start + 1; i < len(pattern); i++ {
		if pattern[i] == '\\' && i+1 < len(pattern) {
			i++
			continue
		}
		if pattern[i] == close {
			level--
			if level == 0 {
				end = i
				break
			}
		} else if open != close && pattern[i] == open {
			level++
		}
	}
	if end < 0 {
		return nil, bad("No matching closing regex delimiter.")
	}
	re := &eggPCRE{body: pattern[start+1 : end], key: fmt.Sprintf("%x", sha256.Sum256([]byte(pattern)))}
	for _, flag := range pattern[end+1:] {
		switch flag {
		case 'i':
			re.options |= 0x8
		case 'm':
			re.options |= 0x400
		case 's':
			re.options |= 0x20
		case 'x':
			re.options |= 0x80
		case 'n':
			re.options |= 0x2000
		case 'A':
			re.options |= 0x80000000
		case 'D':
			re.options |= 0x10
		case 'U':
			re.options |= 0x40000
		case 'J':
			re.options |= 0x40
		case 'u':
			re.options |= 0x80000 | 0x20000
		case 'r':
			re.extra |= 0x80
		case 'S', 'X', ' ', '\n', '\r':
		default:
			return nil, bad("Unknown regex modifier " + string(flag))
		}
	}
	return re, nil
}

func compileEggPCRE(pattern string) (*eggPCRE, error) {
	nativeEggPCRE.initialize()
	if nativeEggPCRE.err != nil {
		return nil, fmt.Errorf("initialize PCRE2: %w", nativeEggPCRE.err)
	}
	nativeEggPCRE.cacheMu.Lock()
	cached := nativeEggPCRE.cache[pattern]
	nativeEggPCRE.cacheMu.Unlock()
	if cached != nil {
		return cached, nil
	}
	re, err := splitEggPCRE(pattern)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), eggPCRETimeout)
	defer cancel()
	instance, err := nativeEggPCRE.acquire(ctx)
	if err != nil {
		return nil, bad("PCRE2 compilation timed out or the engine is busy.")
	}
	defer nativeEggPCRE.release(instance)
	if _, err = instance.compile(ctx, re); err != nil {
		return nil, err
	}
	nativeEggPCRE.cacheMu.Lock()
	defer nativeEggPCRE.cacheMu.Unlock()
	if existing := nativeEggPCRE.cache[pattern]; existing != nil {
		return existing, nil
	}
	for len(nativeEggPCRE.order) > 0 && (len(nativeEggPCRE.order) >= 512 || nativeEggPCRE.bytes+len(pattern) > 8<<20) {
		old := nativeEggPCRE.order[0]
		delete(nativeEggPCRE.cache, old)
		nativeEggPCRE.bytes -= len(old)
		nativeEggPCRE.order = nativeEggPCRE.order[1:]
	}
	nativeEggPCRE.cache[pattern] = re
	nativeEggPCRE.order = append(nativeEggPCRE.order, pattern)
	nativeEggPCRE.bytes += len(pattern)
	return re, nil
}

func (instance *eggPCREInstance) write(ctx context.Context, value string) (uint64, error) {
	size := len(value)
	if size == 0 {
		size = 1
	}
	result, err := instance.module.ExportedFunction("malloc").Call(ctx, uint64(size))
	if err != nil {
		return 0, err
	}
	if len(result) != 1 || result[0] == 0 {
		return 0, bad("PCRE2 memory limit exhausted.")
	}
	if !instance.module.Memory().Write(uint32(result[0]), []byte(value)) {
		return 0, bad("PCRE2 memory limit exhausted.")
	}
	return result[0], nil
}
func (instance *eggPCREInstance) errorMessage(ctx context.Context, code int32) string {
	result, err := instance.module.ExportedFunction("egg_pcre_error_message").Call(ctx, uint64(uint32(code)))
	if err != nil || len(result) != 1 {
		return "PCRE2 execution failed"
	}
	bytes, ok := instance.module.Memory().Read(uint32(result[0]), 256)
	if !ok {
		return "PCRE2 execution failed"
	}
	for i, b := range bytes {
		if b == 0 {
			return string(bytes[:i])
		}
	}
	return string(bytes)
}
func (instance *eggPCREInstance) compile(ctx context.Context, re *eggPCRE) (uint64, error) {
	if code := instance.codes[re.key]; code != 0 {
		return code, nil
	}
	ptr, err := instance.write(ctx, re.body)
	if err != nil {
		return 0, err
	}
	defer instance.module.ExportedFunction("free").Call(ctx, ptr)
	result, err := instance.module.ExportedFunction("egg_pcre_compile").Call(ctx, ptr, uint64(len(re.body)), uint64(re.options), uint64(re.extra))
	if err != nil {
		return 0, bad("PCRE2 compilation interrupted or exceeded its resource limits.")
	}
	if len(result) != 1 || result[0] == 0 {
		offset, _ := instance.module.ExportedFunction("egg_pcre_error_offset").Call(ctx)
		position := uint64(0)
		if len(offset) > 0 {
			position = offset[0]
		}
		return 0, bad(fmt.Sprintf("Invalid egg regex: %s at byte offset %d", instance.errorMessage(ctx, 0), position))
	}
	for len(instance.order) > 0 && (len(instance.order) >= 128 || instance.bytes+len(re.key) > 2<<20) {
		old := instance.order[0]
		if _, err = instance.module.ExportedFunction("egg_pcre_free").Call(ctx, instance.codes[old]); err != nil {
			return 0, err
		}
		delete(instance.codes, old)
		instance.bytes -= len(old)
		instance.order = instance.order[1:]
	}
	instance.codes[re.key] = result[0]
	instance.order = append(instance.order, re.key)
	instance.bytes += len(re.key)
	return result[0], nil
}

func (re *eggPCRE) MatchString(subject string) (bool, error) {
	if len(subject) > 4<<20 {
		return false, bad("Regex subjects are limited to 4 MiB.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), eggPCRETimeout)
	defer cancel()
	instance, err := nativeEggPCRE.acquire(ctx)
	if err != nil {
		return false, bad("PCRE2 matching timed out or the engine is busy.")
	}
	defer nativeEggPCRE.release(instance)
	code, err := instance.compile(ctx, re)
	if err != nil {
		return false, err
	}
	ptr, err := instance.write(ctx, subject)
	if err != nil {
		return false, err
	}
	defer instance.module.ExportedFunction("free").Call(ctx, ptr)
	result, err := instance.module.ExportedFunction("egg_pcre_match").Call(ctx, code, ptr, uint64(len(subject)))
	if err != nil {
		return false, bad("PCRE2 matching interrupted or exceeded its 250 ms deadline.")
	}
	if len(result) != 1 {
		return false, bad("PCRE2 returned an invalid match result.")
	}
	status := int32(result[0])
	if status >= 0 {
		return true, nil
	}
	if status == -1 {
		return false, nil
	}
	return false, bad("Egg regular expression failed: " + instance.errorMessage(ctx, status))
}
