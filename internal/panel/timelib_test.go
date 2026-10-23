package panel

import (
	"context"
	"encoding/json"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestTimelibNativeLaravelOracle(t *testing.T) {
	data, err := os.ReadFile("../../tools/runtime/timelib/oracle-results.json")
	if err != nil {
		t.Fatal(err)
	}
	var oracle struct {
		Base  string
		Cases []struct {
			Name        string
			Value       any
			Rules       string
			Timezone    string
			Environment M
			OtherRules  map[string]string `json:"other_rules"`
			Valid       bool
			Exception   string
			Parsed      *struct {
				Seconds int64
				Micros  int32
			}
		}
	}
	if err = json.Unmarshal(data, &oracle); err != nil {
		t.Fatal(err)
	}
	base, err := time.Parse(time.RFC3339Nano, oracle.Base)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range oracle.Cases {
		t.Run(c.Name, func(t *testing.T) {
			if c.Exception != "" {
				t.Fatalf("oracle exception: %s", c.Exception)
			}
			env := M{"__egg_now": base}
			for key, v := range c.Environment {
				env[key] = v
			}
			if c.Timezone != "" {
				loc, e := time.LoadLocation(c.Timezone)
				if e != nil {
					t.Fatal(e)
				}
				env["__egg_timezone"] = loc
			}
			formats := M{}
			for name, rules := range c.OtherRules {
				for _, part := range strings.Split(rules, "|") {
					if strings.HasPrefix(part, "date_format:") {
						formats[name] = strings.SplitN(strings.TrimPrefix(part, "date_format:"), ",", 2)[0]
					}
				}
			}
			env["__egg_date_formats"] = formats
			rules := []eggRule{}
			for _, part := range strings.Split(c.Rules, "|") {
				if part == "" {
					continue
				}
				p := strings.SplitN(part, ":", 2)
				r := eggRule{name: p[0]}
				if len(p) > 1 {
					r.params = p[1]
				}
				rules = append(rules, r)
			}
			valid := true
			for _, rule := range rules {
				ok, e := eggDateRule(c.Value, rule, rules, env)
				if e != nil {
					t.Fatal(e)
				}
				if !ok {
					valid = false
					break
				}
			}
			if valid != c.Valid {
				t.Fatalf("native valid=%v, Go valid=%v; value=%v rules=%s", c.Valid, valid, c.Value, c.Rules)
			}
			if _, scalar := eggDateScalar(c.Value); scalar {
				var format *string
				for _, rule := range rules {
					if rule.name == "date_format" {
						formats := eggRuleParams(rule.params)
						if len(formats) > 0 {
							format = &formats[0]
						}
						break
					}
				}
				zone := "UTC"
				if c.Timezone != "" {
					zone = c.Timezone
				}
				date, e := eggCarbonDate(c.Value, format, zone, base)
				if e != nil {
					t.Fatal(e)
				}
				if c.Parsed == nil {
					if date != nil {
						t.Fatalf("native parse failed, Go parsed %+v", date)
					}
				} else if date == nil || date.seconds != c.Parsed.Seconds || date.micros != c.Parsed.Micros {
					t.Fatalf("native parse=%+v Go=%+v", c.Parsed, date)
				}
			}
		})
	}
}

func TestTimelibDeadlineInterruptsNativeParser(t *testing.T) {
	nativeEggTimelib.initialize()
	if nativeEggTimelib.err != nil {
		t.Fatal(nativeEggTimelib.err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	module, err := nativeEggTimelib.acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer nativeEggTimelib.release(module)
	input := strings.Repeat("2026-10-21 ", 300000)
	mem, err := module.ExportedFunction("malloc").Call(ctx, uint64(len(input)+1))
	if err != nil {
		t.Fatal(err)
	}
	ptr := mem[0]
	if !module.Memory().Write(uint32(ptr), append([]byte(input), 0)) {
		t.Fatal("write failed")
	}
	zone, err := module.ExportedFunction("malloc").Call(ctx, 4)
	if err != nil {
		t.Fatal(err)
	}
	module.Memory().Write(uint32(zone[0]), []byte("UTC\x00"))
	deadline, stop := context.WithTimeout(context.Background(), time.Millisecond)
	defer stop()
	_, err = module.ExportedFunction("egg_date_parse").Call(deadline, ptr, uint64(len(input)), 0, zone[0], 1792577730, 0)
	if err == nil || !module.IsClosed() {
		t.Fatalf("native parser was not interrupted and closed: %v closed=%v", err, module.IsClosed())
	}
	if deadline.Err() == nil {
		t.Fatalf("execution failed before deadline rather than being interrupted: %v", err)
	}
}

func TestTimelibPoolConcurrencyRecoveryAndLimits(t *testing.T) {
	base := time.Date(2026, 10, 21, 10, 15, 30, 0, time.UTC)
	if _, err := parseEggDate(strings.Repeat("x", (4<<20)+1), nil, "UTC", base); err == nil {
		t.Fatal("oversized input accepted")
	}
	format := strings.Repeat("Y", 65537)
	if _, err := parseEggDate("2026", &format, "UTC", base); err == nil {
		t.Fatal("oversized format accepted")
	}
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			d, e := parseEggDate("2026-10-21 12:00 Europe/Berlin", nil, "UTC", base)
			if e != nil || d == nil || d.seconds != 1792576800 {
				t.Errorf("parallel parse: date=%+v err=%v", d, e)
			}
		}()
	}
	wg.Wait()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	module, err := nativeEggTimelib.acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_ = module.Close(ctx)
	nativeEggTimelib.release(module)
	d, err := parseEggDate("next Monday", nil, "UTC", base)
	if err != nil || d == nil {
		t.Fatalf("closed instance recovery: %+v %v", d, err)
	}
	before := runtime.NumGoroutine()
	for i := 0; i < 100; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		module, e := nativeEggTimelib.acquire(ctx)
		if e == nil {
			nativeEggTimelib.release(module)
		}
	}
	runtime.GC()
	if after := runtime.NumGoroutine(); after > before+4 {
		t.Fatalf("canceled acquire leaked goroutines: %d -> %d", before, after)
	}
}

func TestTimelibApplicationTimezoneInjection(t *testing.T) {
	for _, c := range []struct{ zone, expected string }{{"UTC", "2026-10-21T12:00:00Z"}, {"Europe/Berlin", "2026-10-21T10:00:00Z"}, {"America/New_York", "2026-10-21T16:00:00Z"}} {
		t.Run(c.zone, func(t *testing.T) {
			a := &App{Config: Config{Timezone: c.zone}}
			if err := a.validateEggValue(context.Background(), "2026-10-21 12:00", true, "date_equals:"+c.expected, M{}); err != nil {
				t.Fatal(err)
			}
		})
	}
	a := &App{Config: Config{Timezone: "Europe/Berlin"}}
	if err := a.validateEggValue(context.Background(), "2026-10-21 12:00", true, "date_equals:2026-10-21T12:00:00Z", M{}); err == nil {
		t.Fatal("application timezone was ignored")
	}
}
