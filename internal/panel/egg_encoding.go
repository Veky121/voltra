package panel

import (
	"context"
	_ "embed"
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
)

// The original libmbfl decoders are compiled separately from the Go program.
// This embeds no PHP interpreter or Zend runtime. See tools/runtime/encoding.
//
//go:embed encoding.wasm
var eggEncodingBinary []byte

const eggEncodingNames = "BASE64,UUENCODE,HTML-ENTITIES,Quoted-Printable,7bit,8bit,UCS-4,UCS-4BE,UCS-4LE,UCS-2,UCS-2BE,UCS-2LE,UTF-32,UTF-32BE,UTF-32LE,UTF-16,UTF-16BE,UTF-16LE,UTF-8,UTF-7,UTF7-IMAP,ASCII,EUC-JP,SJIS,eucJP-win,EUC-JP-2004,SJIS-Mobile#DOCOMO,SJIS-Mobile#KDDI,SJIS-Mobile#SOFTBANK,SJIS-mac,SJIS-2004,UTF-8-Mobile#DOCOMO,UTF-8-Mobile#KDDI-A,UTF-8-Mobile#KDDI-B,UTF-8-Mobile#SOFTBANK,CP932,SJIS-win,CP51932,JIS,ISO-2022-JP,ISO-2022-JP-MS,GB18030,GB18030-2022,Windows-1252,Windows-1254,ISO-8859-1,ISO-8859-2,ISO-8859-3,ISO-8859-4,ISO-8859-5,ISO-8859-6,ISO-8859-7,ISO-8859-8,ISO-8859-9,ISO-8859-10,ISO-8859-13,ISO-8859-14,ISO-8859-15,ISO-8859-16,EUC-CN,CP936,HZ,EUC-TW,BIG-5,CP950,EUC-KR,UHC,ISO-2022-KR,Windows-1251,CP866,KOI8-R,KOI8-U,ArmSCII-8,CP850,ISO-2022-JP-2004,ISO-2022-JP-MOBILE#KDDI,CP50220,CP50221,CP50222"

func eggEncodingSupported(name string) bool {
	for _, canonical := range strings.Split(eggEncodingNames, ",") {
		if strings.EqualFold(name, canonical) {
			return true
		}
	}
	return false
}

var nativeEggEncoding struct {
	once     sync.Once
	runtime  wazero.Runtime
	compiled wazero.CompiledModule
	err      error
	idle     chan api.Module
	slots    chan struct{}
}

func initializeEggEncoding() {
	nativeEggEncoding.once.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		nativeEggEncoding.runtime = wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfig().WithMemoryLimitPages(1024).WithCloseOnContextDone(true))
		if _, nativeEggEncoding.err = wasi_snapshot_preview1.Instantiate(ctx, nativeEggEncoding.runtime); nativeEggEncoding.err != nil {
			return
		}
		nativeEggEncoding.compiled, nativeEggEncoding.err = nativeEggEncoding.runtime.CompileModule(ctx, eggEncodingBinary)
		capacity := min(8, max(1, runtime.GOMAXPROCS(0)))
		nativeEggEncoding.idle = make(chan api.Module, capacity)
		nativeEggEncoding.slots = make(chan struct{}, capacity)
	})
}

func eggEncodingBytes(ctx context.Context, value []byte, name string) (valid bool, err error) {
	if !eggEncodingSupported(name) {
		return false, bad("Unsupported encoding parameter: " + name)
	}
	if len(value) > 1<<20 {
		return false, bad("Encoding validation input exceeds 1 MiB")
	}
	initializeEggEncoding()
	if nativeEggEncoding.err != nil {
		return false, fmt.Errorf("initialize encoding validation: %w", nativeEggEncoding.err)
	}
	ctx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
	defer cancel()
	select {
	case nativeEggEncoding.slots <- struct{}{}:
	case <-ctx.Done():
		return false, bad("Encoding validation timed out")
	}
	defer func() { <-nativeEggEncoding.slots }()
	var instance api.Module
	select {
	case instance = <-nativeEggEncoding.idle:
	default:
	}
	if instance == nil || instance.IsClosed() {
		instance, err = nativeEggEncoding.runtime.InstantiateModule(ctx, nativeEggEncoding.compiled, wazero.NewModuleConfig().WithName(""))
		if err != nil {
			return false, fmt.Errorf("instantiate encoding validation: %w", err)
		}
	}
	defer func() {
		if err != nil || instance.IsClosed() {
			_ = instance.Close(context.Background())
			return
		}
		select {
		case nativeEggEncoding.idle <- instance:
		default:
			_ = instance.Close(context.Background())
		}
	}()
	allocation, err := instance.ExportedFunction("malloc").Call(ctx, uint64(len(name)+1+len(value)))
	if err != nil || len(allocation) != 1 {
		return false, bad("Encoding validation allocation failed")
	}
	ptr := uint32(allocation[0])
	if ptr == 0 {
		return false, bad("Encoding validation allocation failed")
	}
	defer func() {
		if !instance.IsClosed() {
			_, _ = instance.ExportedFunction("free").Call(context.Background(), uint64(ptr))
		}
	}()
	input := append(append([]byte(name), 0), value...)
	if !instance.Memory().Write(ptr, input) {
		return false, bad("Encoding validation memory limit exceeded")
	}
	result, err := instance.ExportedFunction("egg_encoding_check").Call(ctx, uint64(ptr), uint64(ptr)+uint64(len(name)+1), uint64(len(value)))
	if err != nil || len(result) != 1 {
		return false, bad("Encoding validation exceeded its resource limit")
	}
	if result[0] > 1 {
		return false, bad("Encoding validation rejected the canonical encoding")
	}
	return result[0] == 1, nil
}

func validateEggEncoding(value any, name string) (bool, error) {
	if _, keys, array := eggArray(value); array {
		for key, element := range keys {
			items := []any{element}
			if n, err := strconv.ParseInt(key, 10, 64); err != nil || strconv.FormatInt(n, 10) != key {
				items = append(items, key)
			}
			for _, item := range items {
				valid, err := validateEggEncoding(item, name)
				if !valid || err != nil {
					return valid, err
				}
			}
		}
		return true, nil
	}
	if value == nil {
		return true, nil
	}
	if b, ok := value.(bool); ok && !b {
		value = ""
	}
	return eggEncodingBytes(context.Background(), []byte(eggEnvironmentString(value)), name)
}
