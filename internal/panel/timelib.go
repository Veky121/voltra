package panel

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
)

//go:embed timelib.wasm
var eggTimelibBinary []byte

type eggTimelibPool struct {
	once     sync.Once
	runtime  wazero.Runtime
	compiled wazero.CompiledModule
	err      error
	idle     chan api.Module
	slots    chan struct{}
}

var nativeEggTimelib eggTimelibPool

func (p *eggTimelibPool) initialize() {
	p.once.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		p.runtime = wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfig().WithMemoryLimitPages(1024).WithCloseOnContextDone(true))
		if _, p.err = wasi_snapshot_preview1.Instantiate(ctx, p.runtime); p.err != nil {
			return
		}
		p.compiled, p.err = p.runtime.CompileModule(ctx, eggTimelibBinary)
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
		p.idle = make(chan api.Module, capacity)
	})
}
func (p *eggTimelibPool) acquire(ctx context.Context) (api.Module, error) {
	select {
	case p.slots <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	select {
	case module := <-p.idle:
		if !module.IsClosed() {
			return module, nil
		}
	default:
	}
	module, err := p.runtime.InstantiateModule(ctx, p.compiled, wazero.NewModuleConfig().WithName("").WithStartFunctions("_initialize"))
	if err != nil {
		<-p.slots
		return nil, err
	}
	return module, nil
}
func (p *eggTimelibPool) release(module api.Module) {
	if !module.IsClosed() {
		p.idle <- module
	}
	<-p.slots
}

type eggDateValue struct {
	seconds   int64
	micros    int32
	calendar  bool
	formatted string
}

// parseEggDate uses the same timelib parser and date formatter as PHP 8.5.4.
// A nil format selects DateTime's free-form parser; a format resets unprovided
// fields to the Unix epoch, matching Laravel's '!'+format calls.
func parseEggDate(value string, format *string, zone string, base time.Time) (*eggDateValue, error) {
	if len(value) > 4<<20 || format != nil && len(*format) > 65536 || len(zone) > 256 {
		return nil, bad("Date input exceeds its resource limit.")
	}
	if strings.IndexByte(zone, 0) >= 0 || format != nil && (strings.IndexByte(value, 0) >= 0 || strings.IndexByte(*format, 0) >= 0) {
		return nil, nil
	}
	nativeEggTimelib.initialize()
	if nativeEggTimelib.err != nil {
		return nil, fmt.Errorf("initialize timelib: %w", nativeEggTimelib.err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	module, err := nativeEggTimelib.acquire(ctx)
	if err != nil {
		return nil, bad("Date parsing timed out or the engine is busy.")
	}
	defer nativeEggTimelib.release(module)
	ptrs := []uint64{}
	defer func() {
		for _, ptr := range ptrs {
			_, _ = module.ExportedFunction("free").Call(ctx, ptr)
		}
	}()
	write := func(s string) (uint64, error) {
		out, e := module.ExportedFunction("malloc").Call(ctx, uint64(len(s)+1))
		if e != nil {
			return 0, e
		}
		if len(out) != 1 || out[0] == 0 {
			return 0, bad("Date parser memory exhausted.")
		}
		ptrs = append(ptrs, out[0])
		if !module.Memory().Write(uint32(out[0]), append([]byte(s), 0)) {
			return 0, bad("Date parser memory exhausted.")
		}
		return out[0], nil
	}
	input, err := write(value)
	if err != nil {
		return nil, err
	}
	tz, err := write(zone)
	if err != nil {
		return nil, err
	}
	fmtptr := uint64(0)
	if format != nil {
		fmtptr, err = write(*format)
		if err != nil {
			return nil, err
		}
	}
	result, err := module.ExportedFunction("egg_date_parse").Call(ctx, input, uint64(len(value)), fmtptr, tz, uint64(base.Unix()), uint64(base.Nanosecond()/1000))
	if err != nil {
		return nil, bad("Date parsing interrupted or exceeded its 250 ms deadline.")
	}
	if len(result) != 1 || int32(result[0]) != 1 {
		return nil, nil
	}
	read := func(name string) (uint64, error) {
		r, e := module.ExportedFunction(name).Call(ctx)
		if e != nil {
			return 0, e
		}
		if len(r) != 1 {
			return 0, bad("Invalid date parser result.")
		}
		return r[0], nil
	}
	sec, err := read("egg_date_seconds")
	if err != nil {
		return nil, err
	}
	mic, err := read("egg_date_micros")
	if err != nil {
		return nil, err
	}
	cal, err := read("egg_date_valid_calendar")
	if err != nil {
		return nil, err
	}
	date := &eggDateValue{seconds: int64(sec), micros: int32(mic), calendar: cal != 0}
	if format != nil {
		ptr, e := read("egg_date_formatted")
		if e != nil {
			return nil, e
		}
		if ptr != 0 {
			buf := make([]byte, 0, len(*format)+64)
			for i := uint32(0); i < 8<<20; i++ {
				b, ok := module.Memory().ReadByte(uint32(ptr) + i)
				if !ok {
					return nil, bad("Invalid date formatter result.")
				}
				if b == 0 {
					date.formatted = string(buf)
					return date, nil
				}
				buf = append(buf, b)
			}
			return nil, bad("Date format output exceeded its resource limit.")
		}
	}
	return date, nil
}

func eggDateScalar(value any) (string, bool) {
	switch v := value.(type) {
	case string:
		return v, true
	case json.Number:
		return string(v), true
	case float64:
		return strconv.FormatFloat(v, 'g', 14, 64), true
	case float32:
		return strconv.FormatFloat(float64(v), 'g', 14, 32), true
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return str(v), true
	}
	return "", false
}

func eggDateNumber(text string) (float64, bool) {
	text = strings.Trim(text, " \t\r\n\v\f")
	for _, c := range text {
		if !(c >= '0' && c <= '9' || strings.ContainsRune(".+-eE", c)) {
			return 0, false
		}
	}
	n, err := strconv.ParseFloat(text, 64)
	return n, err == nil && !math.IsNaN(n) && !math.IsInf(n, 0)
}

// Carbon's timestamp strings split numeric chunks rather than evaluating an
// exponent. For example "1.5e9" means 10.5 seconds in its native constructor.
func eggCarbonTimestamp(value any, text string) (*eggDateValue, error) {
	if n, ok := value.(float64); ok {
		text = strconv.FormatFloat(n, 'f', 6, 64)
	}
	if n, ok := value.(float32); ok {
		text = strconv.FormatFloat(float64(n), 'f', 6, 32)
	}
	negative := strings.HasPrefix(text, "-")
	integer := int64(0)
	decimal := float64(0)
	for _, chunk := range strings.FieldsFunc(text, func(r rune) bool { return !(r >= '0' && r <= '9' || r == '.') }) {
		parts := strings.Split(chunk, ".")
		if parts[0] != "" {
			n, err := strconv.ParseInt(parts[0], 10, 64)
			if err != nil {
				return nil, nil
			}
			if n > math.MaxInt64-integer {
				return nil, nil
			}
			integer += n
		}
		if len(parts) > 1 {
			n, _ := strconv.ParseFloat("0."+parts[1], 64)
			decimal += n
		}
	}
	carry := int64(math.Floor(decimal))
	if carry > math.MaxInt64-integer {
		return nil, nil
	}
	integer += carry
	decimal -= float64(carry)
	micros := int64(math.Round(decimal * 1e6))
	if negative {
		integer = -integer
		micros = -micros
	}
	if micros < 0 {
		integer--
		micros += 1e6
	}
	if micros >= 1e6 {
		integer++
		micros -= 1e6
	}
	return &eggDateValue{seconds: integer, micros: int32(micros)}, nil
}
func eggCarbonDate(value any, format *string, zone string, base time.Time) (*eggDateValue, error) {
	if format != nil {
		if text, ok := eggDateScalar(value); ok {
			if strings.IndexByte(text, 0) >= 0 || strings.IndexByte(*format, 0) >= 0 {
				return nil, nil
			}
			date, err := parseEggDate(text, format, zone, base)
			if err != nil || date != nil {
				return date, err
			}
		}
	}
	if value == nil {
		return parseEggDate("now", nil, zone, base)
	}
	text, ok := eggDateScalar(value)
	if !ok {
		return nil, nil
	}
	// Carbon interprets numeric non-string values and numeric strings other than
	// one to fourteen decimal digits as Unix timestamps (including fractions).
	_, isString := value.(string)
	if isString && strings.HasPrefix(text, "@") {
		return eggCarbonTimestamp(strings.TrimPrefix(text, "@"), strings.TrimPrefix(text, "@"))
	}
	_, isNumeric := eggDateNumber(text)
	digits := len(text) >= 1 && len(text) <= 14
	for i := 0; i < len(text) && digits; i++ {
		digits = text[i] >= '0' && text[i] <= '9'
	}
	if isNumeric && (!isString || !digits) {
		return eggCarbonTimestamp(value, text)
	}
	return parseEggDate(text, nil, zone, base)
}

func eggDateRule(value any, rule eggRule, allRules []eggRule, env M) (bool, error) {
	text, ok := eggDateScalar(value)
	if !ok {
		return false, nil
	}
	zone := "UTC"
	if loc, ok := env["__egg_timezone"].(*time.Location); ok && loc != nil {
		zone = loc.String()
	}
	base := time.Now()
	if fixed, ok := env["__egg_now"].(time.Time); ok {
		base = fixed
	}
	if rule.name == "date" {
		if text == "" {
			return false, nil
		}
		date, err := parseEggDate(text, nil, zone, base)
		return date != nil && date.calendar, err
	}
	params := eggRuleParams(rule.params)
	if rule.name == "date_format" {
		for _, format := range params {
			date, err := parseEggDate(text, &format, "UTC", base)
			if err != nil {
				return false, err
			}
			if date != nil {
				if date.formatted == text {
					return true, nil
				}
				left, le := eggDateNumber(date.formatted)
				right, re := eggDateNumber(text)
				if le && re && left == right {
					return true, nil
				}
			}
		}
		return false, nil
	}
	var format *string
	for _, r := range allRules {
		if r.name == "date_format" {
			p := eggRuleParams(r.params)
			if len(p) > 0 {
				format = &p[0]
			}
			break
		}
	}
	other := ""
	if len(params) > 0 {
		other = params[0]
	}
	first, err := eggCarbonDate(value, format, zone, base)
	if err != nil {
		return false, err
	}
	secondFormat := format
	if format != nil {
		if f := str(asMap(env["__egg_date_formats"])[other]); f != "" {
			secondFormat = &f
		}
	}
	second, err := eggCarbonDate(other, secondFormat, zone, base)
	if err != nil {
		return false, err
	}
	if second == nil {
		resolved, exists := eggRuleOther(env, other)
		if format != nil && (!exists || resolved == nil) {
			return true, nil
		}
		if exists && resolved != nil {
			second, err = eggCarbonDate(resolved, secondFormat, zone, base)
			if err != nil {
				return false, err
			}
		}
	}
	if format != nil && (first == nil || second == nil) {
		return false, nil
	}
	comparison := 0
	if first == nil || second == nil {
		// PHP compares null as a boolean against timestamp integers.
		left, right := first != nil && first.seconds != 0, second != nil && second.seconds != 0
		if left && !right {
			comparison = 1
		} else if !left && right {
			comparison = -1
		}
	} else if first.seconds < second.seconds {
		comparison = -1
	} else if first.seconds > second.seconds {
		comparison = 1
	} else if format != nil {
		if first.micros < second.micros {
			comparison = -1
		} else if first.micros > second.micros {
			comparison = 1
		}
	}
	switch rule.name {
	case "after":
		return comparison > 0, nil
	case "after_or_equal":
		return comparison >= 0, nil
	case "before":
		return comparison < 0, nil
	case "before_or_equal":
		return comparison <= 0, nil
	case "date_equals":
		return comparison == 0, nil
	}
	return false, bad("Unknown date rule.")
}
