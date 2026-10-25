package panel

// Predicate semantics adapted from Fabric Loader 0.20.1:
// Copyright 2016 FabricMC, Apache License 2.0.
// https://github.com/FabricMC/fabric-loader/tree/0.20.1/src/main/java/net/fabricmc/loader/impl/util/version
// This Go adaptation is not an implementation of a package-manager semver dialect.
// License: https://www.apache.org/licenses/LICENSE-2.0
import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

type mcFabricVersion struct {
	raw        string
	components []int
	pre        string
	hasPre     bool
}

var mcFabricPre = regexp.MustCompile(`^(?:|[-0-9A-Za-z]+(?:\.[-0-9A-Za-z]+)*)$`)
var mcFabricUnsigned = regexp.MustCompile(`^(?:0|[1-9][0-9]*)$`)

func mcFabricParseVersion(raw string, wildcard bool) (mcFabricVersion, error) {
	v := mcFabricVersion{raw: raw}
	if raw == "" {
		return v, fmt.Errorf("empty version")
	}
	core := strings.SplitN(raw, "+", 2)[0]
	if p := strings.IndexByte(core, '-'); p >= 0 {
		v.hasPre = true
		v.pre = core[p+1:]
		core = core[:p]
		if !mcFabricPre.MatchString(v.pre) {
			return v, nil
		}
	}
	parts := strings.Split(core, ".")
	firstWildcard := -1
	for i, p := range parts {
		if wildcard && (p == "x" || p == "X" || p == "*") {
			if v.hasPre {
				return mcFabricVersion{raw: raw}, nil
			}
			if firstWildcard < 0 {
				firstWildcard = i
			}
			v.components = append(v.components, -1)
			continue
		}
		if firstWildcard >= 0 {
			return mcFabricVersion{raw: raw}, nil
		}
		// Java Integer.parseInt accepts BMP decimal digits through Character.digit.
		numeric := strings.Map(func(r rune) rune {
			if r <= 0xffff {
				for _, span := range unicode.Digit.R16 {
					if r >= rune(span.Lo) && r <= rune(span.Hi) && (r-rune(span.Lo))%rune(span.Stride) == 0 {
						return '0' + (r-rune(span.Lo))/rune(span.Stride)%10
					}
				}
			}
			return r
		}, p)
		n, e := strconv.ParseInt(numeric, 10, 32)
		if e != nil || n < 0 {
			return mcFabricVersion{raw: raw}, nil
		}
		v.components = append(v.components, int(n))
	}
	if firstWildcard == 0 {
		return mcFabricVersion{raw: raw}, nil
	}
	if firstWildcard > 0 {
		v.components = v.components[:firstWildcard+1]
	}
	return v, nil
}
func (v mcFabricVersion) component(i int) int {
	if i < len(v.components) {
		return v.components[i]
	}
	return 0
}
func mcFabricCompare(a, b mcFabricVersion) int {
	for i := 0; i < max(len(a.components), len(b.components)); i++ {
		x, y := a.component(i), b.component(i)
		if x < y {
			return -1
		}
		if x > y {
			return 1
		}
	}
	if !a.hasPre && !b.hasPre {
		return 0
	}
	if !a.hasPre {
		return 1
	}
	if !b.hasPre {
		return -1
	}
	x, y := []string{}, []string{}
	if a.pre != "" {
		x = strings.Split(a.pre, ".")
	}
	if b.pre != "" {
		y = strings.Split(b.pre, ".")
	}
	for i := 0; i < min(len(x), len(y)); i++ {
		nx, ny := mcFabricUnsigned.MatchString(x[i]), mcFabricUnsigned.MatchString(y[i])
		if nx != ny {
			if nx {
				return -1
			}
			return 1
		}
		if nx && len(x[i]) != len(y[i]) {
			if len(x[i]) < len(y[i]) {
				return -1
			}
			return 1
		}
		if c := strings.Compare(x[i], y[i]); c != 0 {
			return c
		}
	}
	if len(x) < len(y) {
		return -1
	}
	if len(x) > len(y) {
		return 1
	}
	return 0
}

// A declaration is OR across strings, each string AND across literal-space terms.
// Parse all branches even when one matches, as the native constructor does.
func mcFabricPredicateMatches(ranges []string, installed string) (bool, error) {
	actual, e := mcFabricParseVersion(installed, false)
	if e != nil {
		return false, e
	}
	matched := false
	for _, expression := range ranges {
		all := true
		for _, part := range strings.Split(expression, " ") {
			s := strings.Trim(part, "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f ")
			if s == "" || s == "*" {
				continue
			}
			op := "="
			for _, candidate := range []string{">=", "<=", ">", "<", "=", "~", "^"} {
				if strings.HasPrefix(s, candidate) {
					op = candidate
					s = s[len(candidate):]
					break
				}
			}
			ref, err := mcFabricParseVersion(s, true)
			if err != nil {
				return false, err
			}
			wildcard := len(ref.components) > 0 && ref.components[len(ref.components)-1] == -1
			if wildcard {
				if op != "=" {
					return false, fmt.Errorf("wildcard requires equality")
				}
				ref.components = ref.components[:len(ref.components)-1]
				ref.hasPre = true
				ref.pre = ""
				count := len(ref.components)
				if count == 1 {
					op = "^"
				} else if count == 2 {
					op = "~"
				} else {
					upper := ref
					upper.components = append([]int(nil), ref.components...)
					// The native parser increments a Java signed int, including wrap.
					upper.components[count-1] = int(int32(upper.components[count-1]) + int32(1))
					if mcFabricCompare(actual, upper) >= 0 {
						all = false
					}
					op = ">="
				}
			}
			if len(ref.components) == 0 {
				if op == ">" || op == "<" {
					return false, fmt.Errorf("exclusive range requires semantic version")
				}
				op = "="
			}
			ok := false
			if len(actual.components) == 0 || len(ref.components) == 0 {
				ok = (op == "=" || op == ">=" || op == "<=") && actual.raw == ref.raw
			} else {
				c := mcFabricCompare(actual, ref)
				switch op {
				case "=":
					ok = c == 0
				case ">=":
					ok = c >= 0
				case "<=":
					ok = c <= 0
				case ">":
					ok = c > 0
				case "<":
					ok = c < 0
				case "^":
					ok = c >= 0 && actual.component(0) == ref.component(0)
				case "~":
					ok = c >= 0 && actual.component(0) == ref.component(0) && actual.component(1) == ref.component(1)
				}
			}
			if !ok {
				all = false
			}
		}
		if all {
			matched = true
		}
	}
	return matched, nil
}
