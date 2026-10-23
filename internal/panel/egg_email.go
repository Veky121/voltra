package panel

import (
	"context"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/idna"
)

// validateEggEmail follows Laravel's independent AND validators. In particular,
// email:spoof and email:dns do not implicitly add RFC syntax validation.
func validateEggEmail(value any, parameters []string) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return validateEggEmailWithDNS(ctx, value, parameters, eggEmailLookupDNS)
}

type eggEmailDNSRecord struct{ Type, Target string }
type eggEmailDNSLookup func(context.Context, string, string) ([]eggEmailDNSRecord, error)

func validateEggEmailWithDNS(ctx context.Context, value any, parameters []string, lookup eggEmailDNSLookup) (bool, error) {
	s, ok := value.(string)
	if !ok || s == "" || strings.ContainsAny(s, "\r\n") || !utf8.ValidString(s) {
		return false, nil
	}
	if len(parameters) == 0 {
		parameters = []string{"rfc"}
	}
	validations := []string{}
	seen := map[string]bool{}
	for _, parameter := range parameters {
		if seen[parameter] {
			continue
		}
		seen[parameter] = true
		switch parameter {
		case "rfc", "strict", "dns", "spoof", "filter", "filter_unicode":
			validations = append(validations, parameter)
		case `Egulias\EmailValidator\Validation\RFCValidation`:
			validations = append(validations, "rfc")
		case `Egulias\EmailValidator\Validation\NoRFCWarningsValidation`:
			validations = append(validations, "strict")
		case `Egulias\EmailValidator\Validation\DNSCheckValidation`:
			validations = append(validations, "dns")
		case `Egulias\EmailValidator\Validation\Extra\SpoofCheckValidation`:
			validations = append(validations, "spoof")
		case `Illuminate\Validation\Concerns\FilterEmailValidation`:
			validations = append(validations, "filter")
		default:
			if strings.Contains(parameter, `\`) || parameter == "DateTime" || parameter == "stdClass" || parameter == "Exception" {
				return false, bad("Unsupported custom email validation class: " + parameter)
			}
			validations = append(validations, "rfc")
		}
	}
	for _, validation := range validations {
		valid := false
		switch validation {
		case "rfc", "strict":
			var warnings bool
			valid, warnings = eggEmailRFC(s)
			if validation == "strict" && warnings {
				valid = false
			}
		case "filter", "filter_unicode":
			var err error
			valid, err = eggEmailFilter(s, validation == "filter_unicode")
			if err != nil {
				return false, err
			}
		case "dns":
			valid = eggEmailDNS(ctx, s, lookup)
		case "spoof":
			valid = eggEmailSpoof(s)
		}
		if !valid {
			return false, nil
		}
	}
	return true, nil
}

type eggEmailToken struct {
	kind       int
	value      string
	start, end int
}

const eggEmailAtom = 300
const eggEmailIPv6Tag = 301
const eggEmailEnd = -1

type eggEmailParser struct {
	tokens  []eggEmailToken
	index   int
	warning bool
}

// The syntax parser follows Egulias4's token transitions, including obsolete
// comments/quoted-local forms and warning-only length/address-literal handling.
func eggEmailRFC(s string) (bool, bool) {
	tokens, ok := eggEmailTokens(s)
	if !ok || len(tokens) == 0 || tokens[0].kind == '@' {
		return false, false
	}
	p := eggEmailParser{tokens: tokens}
	for p.current().kind != '@' && p.current().kind != eggEmailEnd {
		current, next, previous := p.current().kind, p.next().kind, p.previous().kind
		if current == '.' && previous == eggEmailEnd {
			return false, p.warning
		}
		if current == '"' {
			if !p.quoted() {
				return false, p.warning
			}
		}
		if p.current().kind == '(' || p.current().kind == ')' {
			if !p.comment(true) {
				return false, p.warning
			}
		}
		current, next = p.current().kind, p.next().kind
		if current == '.' && (next == '.' || next == '@') {
			return false, p.warning
		}
		if current == '\\' && next == eggEmailAtom {
			return false, p.warning
		}
		switch current {
		case ',', ']', '[', '>', '<', ':', ';':
			return false, p.warning
		}
		if !p.fws() {
			return false, p.warning
		}
		p.move()
	}
	if p.current().kind != '@' {
		return false, p.warning
	}
	localLength := p.current().start
	if localLength > 64 {
		p.warning = true
	}
	p.move()
	domainStart := p.current().start
	if p.current().kind == '.' || p.current().kind == '-' || p.current().kind == eggEmailEnd || p.current().kind == ' ' && p.next().kind != eggEmailAtom {
		return false, p.warning
	}
	if p.current().kind == '(' {
		p.warning = true
	}
	missingTLD, hasComments := true, false
	label := ""
	literal := false
	for p.current().kind != eggEmailEnd {
		current := p.current().kind
		if current == '\\' || current == '/' {
			return false, p.warning
		}
		if current == '(' || current == ')' {
			hasComments = true
			if !p.comment(false) {
				return false, p.warning
			}
		}
		current = p.current().kind
		if current == '.' && p.next().kind == '.' {
			return false, p.warning
		}
		if current == '[' {
			if !p.literal() {
				return false, p.warning
			}
			literal = true
			break
		}
		if current == '.' {
			if eggEmailLabelTooLong(label) {
				return false, p.warning
			}
			label = ""
		}
		label += p.current().value
		if !p.fws() {
			return false, p.warning
		}
		if current == '.' && p.next().kind == eggEmailAtom {
			missingTLD = false
		}
		if current == '-' && p.next().kind == '.' {
			return false, p.warning
		}
		if current != eggEmailAtom && current != '-' && current != '.' && !(hasComments && (current == '(' || current == ')')) {
			return false, p.warning
		}
		p.move()
	}
	if !literal && eggEmailLabelTooLong(label) {
		return false, p.warning
	}
	if missingTLD {
		p.warning = true
	}
	previous := p.previous().kind
	if previous == '.' || previous == '-' || p.current().kind == ' ' {
		return false, p.warning
	}
	domainEnd := p.current().end
	if p.current().kind == eggEmailEnd {
		domainEnd = len(s)
	}
	if domainEnd-domainStart > 253 {
		return false, p.warning
	}
	if localLength+1+domainEnd-domainStart > 254 {
		p.warning = true
	}
	return true, p.warning
}

func eggEmailTokens(s string) ([]eggEmailToken, bool) {
	out := []eggEmailToken{}
	asciiLetter := func(b byte) bool { return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' }
	for i := 0; i < len(s); {
		start := i
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			return nil, false
		}
		kind := int(r)
		switch {
		case r > 127:
			if unicode.Is(unicode.S, r) || unicode.Is(unicode.C, r) {
				return nil, false
			}
			i += size
			kind = eggEmailAtom
			if r == '¿' {
				kind = 168
			}
			if r == '¡' {
				kind = 173
			}
		case asciiLetter(s[i]):
			i++
			for i < len(s) && asciiLetter(s[i]) {
				i++
			}
			if i < len(s) && (s[i] == '4' || s[i] == '6') {
				i++
			}
			kind = eggEmailAtom
			if s[start:i] == "IPv6" {
				kind = eggEmailIPv6Tag
			}
		case r >= '0' && r <= '9':
			i++
			for i < len(s) && s[i] >= '0' && s[i] <= '9' {
				i++
			}
			kind = eggEmailAtom
		case r == ':' && i+1 < len(s) && s[i+1] == ':':
			kind = 5858
			i += 2
		default:
			i += size
			if r > 0 && r < 32 && r != '\t' || r == 127 {
				return nil, false
			}
		}
		out = append(out, eggEmailToken{kind: kind, value: s[start:i], start: start, end: i})
	}
	out = append(out, eggEmailToken{kind: eggEmailEnd, start: len(s), end: len(s)})
	return out, true
}
func (p *eggEmailParser) current() eggEmailToken {
	if p.index >= len(p.tokens) {
		return p.tokens[len(p.tokens)-1]
	}
	return p.tokens[p.index]
}
func (p *eggEmailParser) next() eggEmailToken {
	if p.index+1 >= len(p.tokens) {
		return p.tokens[len(p.tokens)-1]
	}
	return p.tokens[p.index+1]
}
func (p *eggEmailParser) previous() eggEmailToken {
	if p.index == 0 {
		return eggEmailToken{kind: eggEmailEnd}
	}
	return p.tokens[p.index-1]
}
func (p *eggEmailParser) move() bool {
	if p.index+1 < len(p.tokens) {
		p.index++
		return true
	}
	return false
}
func (p *eggEmailParser) find(kind int) bool {
	for i := p.index + 1; i < len(p.tokens); i++ {
		if p.tokens[i].kind == kind {
			return true
		}
	}
	return false
}
func (p *eggEmailParser) escaped() bool {
	return p.previous().kind == '\\' && p.current().kind != eggEmailAtom
}
func (p *eggEmailParser) fws() bool {
	kind := p.current().kind
	if kind != ' ' && kind != '\t' || p.escaped() {
		return true
	}
	if p.next().kind == eggEmailAtom && p.previous().kind != '@' {
		return false
	}
	p.warning = true
	return true
}
func (p *eggEmailParser) quoted() bool {
	check := func() bool {
		if p.next().kind == eggEmailAtom && p.previous().kind == eggEmailAtom {
			return false
		}
		return p.find('"')
	}
	if !check() {
		return false
	}
	p.warning = true
	p.move()
	for p.current().kind != '"' && p.current().kind != eggEmailEnd {
		if p.current().kind == '\\' && p.next().kind == '"' {
			p.move()
		}
		p.move()
		if !p.escaped() {
			switch p.current().kind {
			case 0, '\t', '\r', '\n':
				return false
			}
		}
	}
	if p.previous().kind == '\\' && !check() {
		return false
	}
	return p.next().kind == '@' || p.previous().kind == '\\'
}
func (p *eggEmailParser) comment(local bool) bool {
	if p.current().kind != '(' || !p.find(')') {
		return false
	}
	opened := 1
	p.warning = true
	for {
		if local && p.next().kind == '@' {
			break
		}
		if !local && opened == 0 && p.next().kind == '.' {
			break
		}
		if p.next().kind == '(' {
			opened++
		}
		if p.next().kind == ')' {
			opened--
		}
		if !p.move() {
			break
		}
	}
	if opened != 0 {
		return false
	}
	if local {
		return p.next().kind == '@'
	}
	return p.next().kind == '.'
}
func (p *eggEmailParser) literal() bool {
	if !p.find(']') {
		return false
	}
	p.warning = true
	for {
		if p.current().kind == 0 || p.next().kind == '[' || p.current().kind == '\\' {
			return false
		}
		if p.current().kind == ']' {
			return true
		}
		if !p.move() {
			return true
		}
	}
}
func eggEmailLabelTooLong(label string) bool {
	if !utf8.ValidString(label) {
		return true
	}
	ascii := true
	for _, r := range label {
		if r > 127 {
			ascii = false
			break
		}
	}
	if ascii {
		return len(label) > 63
	}
	converted, _ := eggEmailIDNA.ToASCII(label)
	for _, part := range strings.Split(converted, ".") {
		if len(part) > 63 {
			return true
		}
	}
	return false
}

// PHP FILTER_VALIDATE_EMAIL uses its upstream PHP8.5 PCRE2 envelope grammar,
// including the Unicode flag's local-part categories and escaped-length checks.
func eggEmailFilter(s string, allowUnicode bool) (bool, error) {
	if len(s) > 320 {
		return false, nil
	}
	pattern := eggEmailPHPFilterPattern
	if allowUnicode {
		pattern = eggEmailPHPFilterUnicodePattern
	}
	compiled, err := compileEggPCRE(pattern)
	if err != nil {
		return false, err
	}
	return compiled.MatchString(s)
}

var eggEmailIDNA = idna.New(idna.MapForLookup(), idna.Transitional(false), idna.StrictDomainName(false), idna.VerifyDNSLength(false))

func eggEmailDNS(ctx context.Context, email string, lookup eggEmailDNSLookup) bool {
	host := email
	if at := strings.LastIndexByte(email, '@'); at >= 0 {
		host = email[at+1:]
	}
	parts := strings.Split(host, ".")
	if len(parts) <= 1 {
		return false
	}
	switch parts[len(parts)-1] {
	case "test", "example", "invalid", "localhost", "local", "intranet", "internal", "private", "corp", "home", "lan":
		return false
	}
	ascii, e := eggEmailIDNA.ToASCII(host)
	if e != nil {
		return false
	}
	parts = strings.Split(strings.TrimRight(ascii, "."), ".")
	host = parts[len(parts)-1]
	for i := len(parts) - 2; i >= 0; i-- {
		host = parts[i] + "." + host
		records, e := lookup(ctx, host, "A+MX")
		if e != nil {
			continue
		}
		if ipv6, e := lookup(ctx, host, "AAAA"); e == nil {
			records = append(records, ipv6...)
		}
		if len(records) == 0 {
			continue
		}
		valid := true
		for _, record := range records {
			if record.Type == "" || record.Type == "MX" && (record.Target == "" || record.Target == ".") {
				valid = false
				break
			}
		}
		if valid {
			return true
		}
	}
	return false
}
func eggEmailLookupDNS(ctx context.Context, host, kind string) ([]eggEmailDNSRecord, error) {
	return eggEmailLookupDNSResolver(ctx, host, kind, net.DefaultResolver)
}
func eggEmailLookupDNSResolver(ctx context.Context, host, kind string, resolver *net.Resolver) ([]eggEmailDNSRecord, error) {
	records := []eggEmailDNSRecord{}
	notFound := func(e error) bool { dns, eok := e.(*net.DNSError); return eok && dns.IsNotFound }
	if kind == "A+MX" {
		mx, e := resolver.LookupMX(ctx, host)
		if e != nil && !notFound(e) {
			return nil, e
		}
		for _, m := range mx {
			records = append(records, eggEmailDNSRecord{Type: "MX", Target: m.Host})
		}
	}
	family := "ip4"
	recordType := "A"
	if kind == "AAAA" {
		family = "ip6"
		recordType = "AAAA"
	}
	ips, e := resolver.LookupIP(ctx, family, host)
	if e != nil && !notFound(e) {
		return nil, e
	}
	for range ips {
		records = append(records, eggEmailDNSRecord{Type: recordType})
	}
	return records, nil
}

// The spoof modifier maps to ICU's default HIGHLY_RESTRICTIVE check. This is a
// resolved Script_Extensions intersection, including Japanese/Korean/Han+Bopomofo
// augmented scripts, followed by the same intersection with Latin omitted.
func eggEmailSpoof(s string) bool {
	resolved, withoutLatin := map[string]bool(nil), map[string]bool(nil)
	for _, r := range s {
		scripts := eggEmailScripts(r)
		if scripts["Zyyy"] || scripts["Zinh"] {
			continue
		}
		if scripts["Hani"] {
			scripts["Jpan"] = true
			scripts["Kore"] = true
			scripts["Hanb"] = true
		}
		if scripts["Hira"] || scripts["Kana"] {
			scripts["Jpan"] = true
		}
		if scripts["Hang"] {
			scripts["Kore"] = true
		}
		if scripts["Bopo"] {
			scripts["Hanb"] = true
		}
		resolved = eggEmailIntersect(resolved, scripts)
		if !scripts["Latn"] {
			withoutLatin = eggEmailIntersect(withoutLatin, scripts)
		}
	}
	return resolved == nil || len(resolved) > 0 || withoutLatin == nil || withoutLatin["Jpan"] || withoutLatin["Kore"] || withoutLatin["Hanb"]
}
func eggEmailIntersect(a, b map[string]bool) map[string]bool {
	if a == nil {
		result := map[string]bool{}
		for k := range b {
			result[k] = true
		}
		return result
	}
	for k := range a {
		if !b[k] {
			delete(a, k)
		}
	}
	return a
}

type eggEmailScriptRange struct {
	start, end rune
	scripts    string
}

func eggEmailParseScriptRanges(data string) []eggEmailScriptRange {
	ranges := []eggEmailScriptRange{}
	for _, line := range strings.Split(strings.TrimSpace(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		ends := strings.Split(fields[0], "..")
		start, _ := strconv.ParseInt(ends[0], 16, 32)
		end := start
		if len(ends) == 2 {
			end, _ = strconv.ParseInt(ends[1], 16, 32)
		}
		ranges = append(ranges, eggEmailScriptRange{rune(start), rune(end), strings.Join(fields[1:], " ")})
	}
	sort.Slice(ranges, func(i, j int) bool { return ranges[i].start < ranges[j].start })
	return ranges
}
func eggEmailScripts(r rune) map[string]bool {
	lookup := func(ranges []eggEmailScriptRange) string {
		i := sort.Search(len(ranges), func(i int) bool { return ranges[i].end >= r })
		if i < len(ranges) && ranges[i].start <= r {
			return ranges[i].scripts
		}
		return ""
	}
	value := lookup(eggEmailScriptExtensions)
	if value == "" {
		value = lookup(eggEmailPrimaryScripts)
	}
	if value == "" {
		value = "Zzzz"
	}
	out := map[string]bool{}
	for _, script := range strings.Fields(value) {
		out[script] = true
	}
	return out
}

var eggEmailPrimaryScripts = eggEmailParseScriptRanges(eggEmailPrimaryScriptData)
var eggEmailScriptExtensions = eggEmailParseScriptRanges(eggEmailScriptExtensionData)

// Unicode data constants below are generated from Unicode17.0.0 Scripts.txt,
// ScriptExtensions.txt and PropertyValueAliases.txt. Unicode data files license:
// https://www.unicode.org/license.txt . Matches reference ICU78.2 / Unicode17.
// Generated by tools/parity/egg-email-unicode.mjs; do not hand-edit data.
const eggEmailPrimaryScriptData = `
0..40 Zyyy
41..5a Latn
5b..60 Zyyy
61..7a Latn
7b..a9 Zyyy
aa Latn
ab..b9 Zyyy
ba Latn
bb..bf Zyyy
c0..d6 Latn
d7 Zyyy
d8..f6 Latn
f7 Zyyy
f8..2b8 Latn
2b9..2df Zyyy
2e0..2e4 Latn
2e5..2e9 Zyyy
2ea..2eb Bopo
2ec..2ff Zyyy
300..36f Zinh
370..373 Grek
374 Zyyy
375..377 Grek
37a..37d Grek
37e Zyyy
37f Grek
384 Grek
385 Zyyy
386 Grek
387 Zyyy
388..38a Grek
38c Grek
38e..3a1 Grek
3a3..3e1 Grek
3e2..3ef Copt
3f0..3ff Grek
400..484 Cyrl
485..486 Zinh
487..52f Cyrl
531..556 Armn
559..58a Armn
58d..58f Armn
591..5c7 Hebr
5d0..5ea Hebr
5ef..5f4 Hebr
600..604 Arab
605 Zyyy
606..60b Arab
60c Zyyy
60d..61a Arab
61b Zyyy
61c..61e Arab
61f Zyyy
620..63f Arab
640 Zyyy
641..64a Arab
64b..655 Zinh
656..66f Arab
670 Zinh
671..6dc Arab
6dd Zyyy
6de..6ff Arab
700..70d Syrc
70f..74a Syrc
74d..74f Syrc
750..77f Arab
780..7b1 Thaa
7c0..7fa Nkoo
7fd..7ff Nkoo
800..82d Samr
830..83e Samr
840..85b Mand
85e Mand
860..86a Syrc
870..891 Arab
897..8e1 Arab
8e2 Zyyy
8e3..8ff Arab
900..950 Deva
951..954 Zinh
955..963 Deva
964..965 Zyyy
966..97f Deva
980..983 Beng
985..98c Beng
98f..990 Beng
993..9a8 Beng
9aa..9b0 Beng
9b2 Beng
9b6..9b9 Beng
9bc..9c4 Beng
9c7..9c8 Beng
9cb..9ce Beng
9d7 Beng
9dc..9dd Beng
9df..9e3 Beng
9e6..9fe Beng
a01..a03 Guru
a05..a0a Guru
a0f..a10 Guru
a13..a28 Guru
a2a..a30 Guru
a32..a33 Guru
a35..a36 Guru
a38..a39 Guru
a3c Guru
a3e..a42 Guru
a47..a48 Guru
a4b..a4d Guru
a51 Guru
a59..a5c Guru
a5e Guru
a66..a76 Guru
a81..a83 Gujr
a85..a8d Gujr
a8f..a91 Gujr
a93..aa8 Gujr
aaa..ab0 Gujr
ab2..ab3 Gujr
ab5..ab9 Gujr
abc..ac5 Gujr
ac7..ac9 Gujr
acb..acd Gujr
ad0 Gujr
ae0..ae3 Gujr
ae6..af1 Gujr
af9..aff Gujr
b01..b03 Orya
b05..b0c Orya
b0f..b10 Orya
b13..b28 Orya
b2a..b30 Orya
b32..b33 Orya
b35..b39 Orya
b3c..b44 Orya
b47..b48 Orya
b4b..b4d Orya
b55..b57 Orya
b5c..b5d Orya
b5f..b63 Orya
b66..b77 Orya
b82..b83 Taml
b85..b8a Taml
b8e..b90 Taml
b92..b95 Taml
b99..b9a Taml
b9c Taml
b9e..b9f Taml
ba3..ba4 Taml
ba8..baa Taml
bae..bb9 Taml
bbe..bc2 Taml
bc6..bc8 Taml
bca..bcd Taml
bd0 Taml
bd7 Taml
be6..bfa Taml
c00..c0c Telu
c0e..c10 Telu
c12..c28 Telu
c2a..c39 Telu
c3c..c44 Telu
c46..c48 Telu
c4a..c4d Telu
c55..c56 Telu
c58..c5a Telu
c5c..c5d Telu
c60..c63 Telu
c66..c6f Telu
c77..c7f Telu
c80..c8c Knda
c8e..c90 Knda
c92..ca8 Knda
caa..cb3 Knda
cb5..cb9 Knda
cbc..cc4 Knda
cc6..cc8 Knda
cca..ccd Knda
cd5..cd6 Knda
cdc..cde Knda
ce0..ce3 Knda
ce6..cef Knda
cf1..cf3 Knda
d00..d0c Mlym
d0e..d10 Mlym
d12..d44 Mlym
d46..d48 Mlym
d4a..d4f Mlym
d54..d63 Mlym
d66..d7f Mlym
d81..d83 Sinh
d85..d96 Sinh
d9a..db1 Sinh
db3..dbb Sinh
dbd Sinh
dc0..dc6 Sinh
dca Sinh
dcf..dd4 Sinh
dd6 Sinh
dd8..ddf Sinh
de6..def Sinh
df2..df4 Sinh
e01..e3a Thai
e3f Zyyy
e40..e5b Thai
e81..e82 Laoo
e84 Laoo
e86..e8a Laoo
e8c..ea3 Laoo
ea5 Laoo
ea7..ebd Laoo
ec0..ec4 Laoo
ec6 Laoo
ec8..ece Laoo
ed0..ed9 Laoo
edc..edf Laoo
f00..f47 Tibt
f49..f6c Tibt
f71..f97 Tibt
f99..fbc Tibt
fbe..fcc Tibt
fce..fd4 Tibt
fd5..fd8 Zyyy
fd9..fda Tibt
1000..109f Mymr
10a0..10c5 Geor
10c7 Geor
10cd Geor
10d0..10fa Geor
10fb Zyyy
10fc..10ff Geor
1100..11ff Hang
1200..1248 Ethi
124a..124d Ethi
1250..1256 Ethi
1258 Ethi
125a..125d Ethi
1260..1288 Ethi
128a..128d Ethi
1290..12b0 Ethi
12b2..12b5 Ethi
12b8..12be Ethi
12c0 Ethi
12c2..12c5 Ethi
12c8..12d6 Ethi
12d8..1310 Ethi
1312..1315 Ethi
1318..135a Ethi
135d..137c Ethi
1380..1399 Ethi
13a0..13f5 Cher
13f8..13fd Cher
1400..167f Cans
1680..169c Ogam
16a0..16ea Runr
16eb..16ed Zyyy
16ee..16f8 Runr
1700..1715 Tglg
171f Tglg
1720..1734 Hano
1735..1736 Zyyy
1740..1753 Buhd
1760..176c Tagb
176e..1770 Tagb
1772..1773 Tagb
1780..17dd Khmr
17e0..17e9 Khmr
17f0..17f9 Khmr
1800..1801 Mong
1802..1803 Zyyy
1804 Mong
1805 Zyyy
1806..1819 Mong
1820..1878 Mong
1880..18aa Mong
18b0..18f5 Cans
1900..191e Limb
1920..192b Limb
1930..193b Limb
1940 Limb
1944..194f Limb
1950..196d Tale
1970..1974 Tale
1980..19ab Talu
19b0..19c9 Talu
19d0..19da Talu
19de..19df Talu
19e0..19ff Khmr
1a00..1a1b Bugi
1a1e..1a1f Bugi
1a20..1a5e Lana
1a60..1a7c Lana
1a7f..1a89 Lana
1a90..1a99 Lana
1aa0..1aad Lana
1ab0..1add Zinh
1ae0..1aeb Zinh
1b00..1b4c Bali
1b4e..1b7f Bali
1b80..1bbf Sund
1bc0..1bf3 Batk
1bfc..1bff Batk
1c00..1c37 Lepc
1c3b..1c49 Lepc
1c4d..1c4f Lepc
1c50..1c7f Olck
1c80..1c8a Cyrl
1c90..1cba Geor
1cbd..1cbf Geor
1cc0..1cc7 Sund
1cd0..1cd2 Zinh
1cd3 Zyyy
1cd4..1ce0 Zinh
1ce1 Zyyy
1ce2..1ce8 Zinh
1ce9..1cec Zyyy
1ced Zinh
1cee..1cf3 Zyyy
1cf4 Zinh
1cf5..1cf7 Zyyy
1cf8..1cf9 Zinh
1cfa Zyyy
1d00..1d25 Latn
1d26..1d2a Grek
1d2b Cyrl
1d2c..1d5c Latn
1d5d..1d61 Grek
1d62..1d65 Latn
1d66..1d6a Grek
1d6b..1d77 Latn
1d78 Cyrl
1d79..1dbe Latn
1dbf Grek
1dc0..1dff Zinh
1e00..1eff Latn
1f00..1f15 Grek
1f18..1f1d Grek
1f20..1f45 Grek
1f48..1f4d Grek
1f50..1f57 Grek
1f59 Grek
1f5b Grek
1f5d Grek
1f5f..1f7d Grek
1f80..1fb4 Grek
1fb6..1fc4 Grek
1fc6..1fd3 Grek
1fd6..1fdb Grek
1fdd..1fef Grek
1ff2..1ff4 Grek
1ff6..1ffe Grek
2000..200b Zyyy
200c..200d Zinh
200e..2064 Zyyy
2066..2070 Zyyy
2071 Latn
2074..207e Zyyy
207f Latn
2080..208e Zyyy
2090..209c Latn
20a0..20c1 Zyyy
20d0..20f0 Zinh
2100..2125 Zyyy
2126 Grek
2127..2129 Zyyy
212a..212b Latn
212c..2131 Zyyy
2132 Latn
2133..214d Zyyy
214e Latn
214f..215f Zyyy
2160..2188 Latn
2189..218b Zyyy
2190..2429 Zyyy
2440..244a Zyyy
2460..27ff Zyyy
2800..28ff Brai
2900..2b73 Zyyy
2b76..2bff Zyyy
2c00..2c5f Glag
2c60..2c7f Latn
2c80..2cf3 Copt
2cf9..2cff Copt
2d00..2d25 Geor
2d27 Geor
2d2d Geor
2d30..2d67 Tfng
2d6f..2d70 Tfng
2d7f Tfng
2d80..2d96 Ethi
2da0..2da6 Ethi
2da8..2dae Ethi
2db0..2db6 Ethi
2db8..2dbe Ethi
2dc0..2dc6 Ethi
2dc8..2dce Ethi
2dd0..2dd6 Ethi
2dd8..2dde Ethi
2de0..2dff Cyrl
2e00..2e5d Zyyy
2e80..2e99 Hani
2e9b..2ef3 Hani
2f00..2fd5 Hani
2ff0..3004 Zyyy
3005 Hani
3006 Zyyy
3007 Hani
3008..3020 Zyyy
3021..3029 Hani
302a..302d Zinh
302e..302f Hang
3030..3037 Zyyy
3038..303b Hani
303c..303f Zyyy
3041..3096 Hira
3099..309a Zinh
309b..309c Zyyy
309d..309f Hira
30a0 Zyyy
30a1..30fa Kana
30fb..30fc Zyyy
30fd..30ff Kana
3105..312f Bopo
3131..318e Hang
3190..319f Zyyy
31a0..31bf Bopo
31c0..31e5 Zyyy
31ef Zyyy
31f0..31ff Kana
3200..321e Hang
3220..325f Zyyy
3260..327e Hang
327f..32cf Zyyy
32d0..32fe Kana
32ff Zyyy
3300..3357 Kana
3358..33ff Zyyy
3400..4dbf Hani
4dc0..4dff Zyyy
4e00..9fff Hani
a000..a48c Yiii
a490..a4c6 Yiii
a4d0..a4ff Lisu
a500..a62b Vaii
a640..a69f Cyrl
a6a0..a6f7 Bamu
a700..a721 Zyyy
a722..a787 Latn
a788..a78a Zyyy
a78b..a7dc Latn
a7f1..a7ff Latn
a800..a82c Sylo
a830..a839 Zyyy
a840..a877 Phag
a880..a8c5 Saur
a8ce..a8d9 Saur
a8e0..a8ff Deva
a900..a92d Kali
a92e Zyyy
a92f Kali
a930..a953 Rjng
a95f Rjng
a960..a97c Hang
a980..a9cd Java
a9cf Zyyy
a9d0..a9d9 Java
a9de..a9df Java
a9e0..a9fe Mymr
aa00..aa36 Cham
aa40..aa4d Cham
aa50..aa59 Cham
aa5c..aa5f Cham
aa60..aa7f Mymr
aa80..aac2 Tavt
aadb..aadf Tavt
aae0..aaf6 Mtei
ab01..ab06 Ethi
ab09..ab0e Ethi
ab11..ab16 Ethi
ab20..ab26 Ethi
ab28..ab2e Ethi
ab30..ab5a Latn
ab5b Zyyy
ab5c..ab64 Latn
ab65 Grek
ab66..ab69 Latn
ab6a..ab6b Zyyy
ab70..abbf Cher
abc0..abed Mtei
abf0..abf9 Mtei
ac00..d7a3 Hang
d7b0..d7c6 Hang
d7cb..d7fb Hang
f900..fa6d Hani
fa70..fad9 Hani
fb00..fb06 Latn
fb13..fb17 Armn
fb1d..fb36 Hebr
fb38..fb3c Hebr
fb3e Hebr
fb40..fb41 Hebr
fb43..fb44 Hebr
fb46..fb4f Hebr
fb50..fd3d Arab
fd3e..fd3f Zyyy
fd40..fdcf Arab
fdf0..fdff Arab
fe00..fe0f Zinh
fe10..fe19 Zyyy
fe20..fe2d Zinh
fe2e..fe2f Cyrl
fe30..fe52 Zyyy
fe54..fe66 Zyyy
fe68..fe6b Zyyy
fe70..fe74 Arab
fe76..fefc Arab
feff Zyyy
ff01..ff20 Zyyy
ff21..ff3a Latn
ff3b..ff40 Zyyy
ff41..ff5a Latn
ff5b..ff65 Zyyy
ff66..ff6f Kana
ff70 Zyyy
ff71..ff9d Kana
ff9e..ff9f Zyyy
ffa0..ffbe Hang
ffc2..ffc7 Hang
ffca..ffcf Hang
ffd2..ffd7 Hang
ffda..ffdc Hang
ffe0..ffe6 Zyyy
ffe8..ffee Zyyy
fff9..fffd Zyyy
10000..1000b Linb
1000d..10026 Linb
10028..1003a Linb
1003c..1003d Linb
1003f..1004d Linb
10050..1005d Linb
10080..100fa Linb
10100..10102 Zyyy
10107..10133 Zyyy
10137..1013f Zyyy
10140..1018e Grek
10190..1019c Zyyy
101a0 Grek
101d0..101fc Zyyy
101fd Zinh
10280..1029c Lyci
102a0..102d0 Cari
102e0 Zinh
102e1..102fb Zyyy
10300..10323 Ital
1032d..1032f Ital
10330..1034a Goth
10350..1037a Perm
10380..1039d Ugar
1039f Ugar
103a0..103c3 Xpeo
103c8..103d5 Xpeo
10400..1044f Dsrt
10450..1047f Shaw
10480..1049d Osma
104a0..104a9 Osma
104b0..104d3 Osge
104d8..104fb Osge
10500..10527 Elba
10530..10563 Aghb
1056f Aghb
10570..1057a Vith
1057c..1058a Vith
1058c..10592 Vith
10594..10595 Vith
10597..105a1 Vith
105a3..105b1 Vith
105b3..105b9 Vith
105bb..105bc Vith
105c0..105f3 Todr
10600..10736 Lina
10740..10755 Lina
10760..10767 Lina
10780..10785 Latn
10787..107b0 Latn
107b2..107ba Latn
10800..10805 Cprt
10808 Cprt
1080a..10835 Cprt
10837..10838 Cprt
1083c Cprt
1083f Cprt
10840..10855 Armi
10857..1085f Armi
10860..1087f Palm
10880..1089e Nbat
108a7..108af Nbat
108e0..108f2 Hatr
108f4..108f5 Hatr
108fb..108ff Hatr
10900..1091b Phnx
1091f Phnx
10920..10939 Lydi
1093f Lydi
10940..10959 Sidt
10980..1099f Mero
109a0..109b7 Merc
109bc..109cf Merc
109d2..109ff Merc
10a00..10a03 Khar
10a05..10a06 Khar
10a0c..10a13 Khar
10a15..10a17 Khar
10a19..10a35 Khar
10a38..10a3a Khar
10a3f..10a48 Khar
10a50..10a58 Khar
10a60..10a7f Sarb
10a80..10a9f Narb
10ac0..10ae6 Mani
10aeb..10af6 Mani
10b00..10b35 Avst
10b39..10b3f Avst
10b40..10b55 Prti
10b58..10b5f Prti
10b60..10b72 Phli
10b78..10b7f Phli
10b80..10b91 Phlp
10b99..10b9c Phlp
10ba9..10baf Phlp
10c00..10c48 Orkh
10c80..10cb2 Hung
10cc0..10cf2 Hung
10cfa..10cff Hung
10d00..10d27 Rohg
10d30..10d39 Rohg
10d40..10d65 Gara
10d69..10d85 Gara
10d8e..10d8f Gara
10e60..10e7e Arab
10e80..10ea9 Yezi
10eab..10ead Yezi
10eb0..10eb1 Yezi
10ec2..10ec7 Arab
10ed0..10ed8 Arab
10efa..10eff Arab
10f00..10f27 Sogo
10f30..10f59 Sogd
10f70..10f89 Ougr
10fb0..10fcb Chrs
10fe0..10ff6 Elym
11000..1104d Brah
11052..11075 Brah
1107f Brah
11080..110c2 Kthi
110cd Kthi
110d0..110e8 Sora
110f0..110f9 Sora
11100..11134 Cakm
11136..11147 Cakm
11150..11176 Mahj
11180..111df Shrd
111e1..111f4 Sinh
11200..11211 Khoj
11213..11241 Khoj
11280..11286 Mult
11288 Mult
1128a..1128d Mult
1128f..1129d Mult
1129f..112a9 Mult
112b0..112ea Sind
112f0..112f9 Sind
11300..11303 Gran
11305..1130c Gran
1130f..11310 Gran
11313..11328 Gran
1132a..11330 Gran
11332..11333 Gran
11335..11339 Gran
1133b Zinh
1133c..11344 Gran
11347..11348 Gran
1134b..1134d Gran
11350 Gran
11357 Gran
1135d..11363 Gran
11366..1136c Gran
11370..11374 Gran
11380..11389 Tutg
1138b Tutg
1138e Tutg
11390..113b5 Tutg
113b7..113c0 Tutg
113c2 Tutg
113c5 Tutg
113c7..113ca Tutg
113cc..113d5 Tutg
113d7..113d8 Tutg
113e1..113e2 Tutg
11400..1145b Newa
1145d..11461 Newa
11480..114c7 Tirh
114d0..114d9 Tirh
11580..115b5 Sidd
115b8..115dd Sidd
11600..11644 Modi
11650..11659 Modi
11660..1166c Mong
11680..116b9 Takr
116c0..116c9 Takr
116d0..116e3 Mymr
11700..1171a Ahom
1171d..1172b Ahom
11730..11746 Ahom
11800..1183b Dogr
118a0..118f2 Wara
118ff Wara
11900..11906 Diak
11909 Diak
1190c..11913 Diak
11915..11916 Diak
11918..11935 Diak
11937..11938 Diak
1193b..11946 Diak
11950..11959 Diak
119a0..119a7 Nand
119aa..119d7 Nand
119da..119e4 Nand
11a00..11a47 Zanb
11a50..11aa2 Soyo
11ab0..11abf Cans
11ac0..11af8 Pauc
11b00..11b09 Deva
11b60..11b67 Shrd
11bc0..11be1 Sunu
11bf0..11bf9 Sunu
11c00..11c08 Bhks
11c0a..11c36 Bhks
11c38..11c45 Bhks
11c50..11c6c Bhks
11c70..11c8f Marc
11c92..11ca7 Marc
11ca9..11cb6 Marc
11d00..11d06 Gonm
11d08..11d09 Gonm
11d0b..11d36 Gonm
11d3a Gonm
11d3c..11d3d Gonm
11d3f..11d47 Gonm
11d50..11d59 Gonm
11d60..11d65 Gong
11d67..11d68 Gong
11d6a..11d8e Gong
11d90..11d91 Gong
11d93..11d98 Gong
11da0..11da9 Gong
11db0..11ddb Tols
11de0..11de9 Tols
11ee0..11ef8 Maka
11f00..11f10 Kawi
11f12..11f3a Kawi
11f3e..11f5a Kawi
11fb0 Lisu
11fc0..11ff1 Taml
11fff Taml
12000..12399 Xsux
12400..1246e Xsux
12470..12474 Xsux
12480..12543 Xsux
12f90..12ff2 Cpmn
13000..13455 Egyp
13460..143fa Egyp
14400..14646 Hluw
16100..16139 Gukh
16800..16a38 Bamu
16a40..16a5e Mroo
16a60..16a69 Mroo
16a6e..16a6f Mroo
16a70..16abe Tnsa
16ac0..16ac9 Tnsa
16ad0..16aed Bass
16af0..16af5 Bass
16b00..16b45 Hmng
16b50..16b59 Hmng
16b5b..16b61 Hmng
16b63..16b77 Hmng
16b7d..16b8f Hmng
16d40..16d79 Krai
16e40..16e9a Medf
16ea0..16eb8 Berf
16ebb..16ed3 Berf
16f00..16f4a Plrd
16f4f..16f87 Plrd
16f8f..16f9f Plrd
16fe0 Tang
16fe1 Nshu
16fe2..16fe3 Hani
16fe4 Kits
16ff0..16ff6 Hani
17000..18aff Tang
18b00..18cd5 Kits
18cff Kits
18d00..18d1e Tang
18d80..18df2 Tang
1aff0..1aff3 Kana
1aff5..1affb Kana
1affd..1affe Kana
1b000 Kana
1b001..1b11f Hira
1b120..1b122 Kana
1b132 Hira
1b150..1b152 Hira
1b155 Kana
1b164..1b167 Kana
1b170..1b2fb Nshu
1bc00..1bc6a Dupl
1bc70..1bc7c Dupl
1bc80..1bc88 Dupl
1bc90..1bc99 Dupl
1bc9c..1bc9f Dupl
1bca0..1bca3 Zyyy
1cc00..1ccfc Zyyy
1cd00..1ceb3 Zyyy
1ceba..1ced0 Zyyy
1cee0..1cef0 Zyyy
1cf00..1cf2d Zinh
1cf30..1cf46 Zinh
1cf50..1cfc3 Zyyy
1d000..1d0f5 Zyyy
1d100..1d126 Zyyy
1d129..1d166 Zyyy
1d167..1d169 Zinh
1d16a..1d17a Zyyy
1d17b..1d182 Zinh
1d183..1d184 Zyyy
1d185..1d18b Zinh
1d18c..1d1a9 Zyyy
1d1aa..1d1ad Zinh
1d1ae..1d1ea Zyyy
1d200..1d245 Grek
1d2c0..1d2d3 Zyyy
1d2e0..1d2f3 Zyyy
1d300..1d356 Zyyy
1d360..1d378 Zyyy
1d400..1d454 Zyyy
1d456..1d49c Zyyy
1d49e..1d49f Zyyy
1d4a2 Zyyy
1d4a5..1d4a6 Zyyy
1d4a9..1d4ac Zyyy
1d4ae..1d4b9 Zyyy
1d4bb Zyyy
1d4bd..1d4c3 Zyyy
1d4c5..1d505 Zyyy
1d507..1d50a Zyyy
1d50d..1d514 Zyyy
1d516..1d51c Zyyy
1d51e..1d539 Zyyy
1d53b..1d53e Zyyy
1d540..1d544 Zyyy
1d546 Zyyy
1d54a..1d550 Zyyy
1d552..1d6a5 Zyyy
1d6a8..1d7cb Zyyy
1d7ce..1d7ff Zyyy
1d800..1da8b Sgnw
1da9b..1da9f Sgnw
1daa1..1daaf Sgnw
1df00..1df1e Latn
1df25..1df2a Latn
1e000..1e006 Glag
1e008..1e018 Glag
1e01b..1e021 Glag
1e023..1e024 Glag
1e026..1e02a Glag
1e030..1e06d Cyrl
1e08f Cyrl
1e100..1e12c Hmnp
1e130..1e13d Hmnp
1e140..1e149 Hmnp
1e14e..1e14f Hmnp
1e290..1e2ae Toto
1e2c0..1e2f9 Wcho
1e2ff Wcho
1e4d0..1e4f9 Nagm
1e5d0..1e5fa Onao
1e5ff Onao
1e6c0..1e6de Tayo
1e6e0..1e6f5 Tayo
1e6fe..1e6ff Tayo
1e7e0..1e7e6 Ethi
1e7e8..1e7eb Ethi
1e7ed..1e7ee Ethi
1e7f0..1e7fe Ethi
1e800..1e8c4 Mend
1e8c7..1e8d6 Mend
1e900..1e94b Adlm
1e950..1e959 Adlm
1e95e..1e95f Adlm
1ec71..1ecb4 Zyyy
1ed01..1ed3d Zyyy
1ee00..1ee03 Arab
1ee05..1ee1f Arab
1ee21..1ee22 Arab
1ee24 Arab
1ee27 Arab
1ee29..1ee32 Arab
1ee34..1ee37 Arab
1ee39 Arab
1ee3b Arab
1ee42 Arab
1ee47 Arab
1ee49 Arab
1ee4b Arab
1ee4d..1ee4f Arab
1ee51..1ee52 Arab
1ee54 Arab
1ee57 Arab
1ee59 Arab
1ee5b Arab
1ee5d Arab
1ee5f Arab
1ee61..1ee62 Arab
1ee64 Arab
1ee67..1ee6a Arab
1ee6c..1ee72 Arab
1ee74..1ee77 Arab
1ee79..1ee7c Arab
1ee7e Arab
1ee80..1ee89 Arab
1ee8b..1ee9b Arab
1eea1..1eea3 Arab
1eea5..1eea9 Arab
1eeab..1eebb Arab
1eef0..1eef1 Arab
1f000..1f02b Zyyy
1f030..1f093 Zyyy
1f0a0..1f0ae Zyyy
1f0b1..1f0bf Zyyy
1f0c1..1f0cf Zyyy
1f0d1..1f0f5 Zyyy
1f100..1f1ad Zyyy
1f1e6..1f1ff Zyyy
1f200 Hira
1f201..1f202 Zyyy
1f210..1f23b Zyyy
1f240..1f248 Zyyy
1f250..1f251 Zyyy
1f260..1f265 Zyyy
1f300..1f6d8 Zyyy
1f6dc..1f6ec Zyyy
1f6f0..1f6fc Zyyy
1f700..1f7d9 Zyyy
1f7e0..1f7eb Zyyy
1f7f0 Zyyy
1f800..1f80b Zyyy
1f810..1f847 Zyyy
1f850..1f859 Zyyy
1f860..1f887 Zyyy
1f890..1f8ad Zyyy
1f8b0..1f8bb Zyyy
1f8c0..1f8c1 Zyyy
1f8d0..1f8d8 Zyyy
1f900..1fa57 Zyyy
1fa60..1fa6d Zyyy
1fa70..1fa7c Zyyy
1fa80..1fa8a Zyyy
1fa8e..1fac6 Zyyy
1fac8 Zyyy
1facd..1fadc Zyyy
1fadf..1faea Zyyy
1faef..1faf8 Zyyy
1fb00..1fb92 Zyyy
1fb94..1fbfa Zyyy
20000..2a6df Hani
2a700..2b81d Hani
2b820..2cead Hani
2ceb0..2ebe0 Hani
2ebf0..2ee5d Hani
2f800..2fa1d Hani
30000..3134a Hani
31350..33479 Hani
e0001 Zyyy
e0020..e007f Zyyy
e0100..e01ef Zinh
`
const eggEmailScriptExtensionData = `
b7 Avst Cari Copt Dupl Elba Geor Glag Gong Goth Grek Hani Latn Lydi Mahj Perm Shaw
2bc Beng Cyrl Deva Latn Lisu Thai Toto
2c7 Bopo Latn
2c9..2cb Bopo Latn
2cd Latn Lisu
2d7 Latn Thai
2d9 Bopo Latn
300 Cher Copt Cyrl Grek Latn Perm Sunu Tale
301 Cher Cyrl Grek Latn Osge Sunu Tale Todr
302 Cher Cyrl Latn Tfng
303 Glag Latn Sunu Syrc Thai
304 Aghb Cher Copt Cyrl Goth Grek Latn Osge Syrc Tfng Todr
305 Copt Elba Glag Goth Kana Latn
306 Cyrl Grek Latn Perm Tfng
307 Copt Dupl Hebr Latn Perm Syrc Tale Tfng Todr
308 Armn Cyrl Dupl Goth Grek Hebr Latn Perm Syrc Tale Tfng
309 Latn Tfng
30a Dupl Latn Syrc
30b Cher Cyrl Latn Osge
30c Cher Latn Tale
30d Latn Sunu
30e Ethi Latn
310 Latn Sunu
311 Cyrl Latn Todr
313 Grek Latn Perm Todr
323 Cher Dupl Kana Latn Syrc Tfng
324 Cher Dupl Latn Syrc
325 Latn Syrc
32d Latn Sunu Syrc
32e Latn Syrc
330 Cher Latn Syrc
331 Aghb Cher Goth Latn Sunu Syrc Thai
342 Grek
345 Grek
358 Latn Osge
35e Aghb Latn Todr
363..36f Latn
374..375 Copt Grek
483 Cyrl Perm
484 Cyrl Glag
485..486 Cyrl Latn
487 Cyrl Glag
589 Armn Geor Glag
60c Arab Gara Nkoo Rohg Syrc Thaa Yezi
61b Arab Gara Nkoo Rohg Syrc Thaa Yezi
61c Arab Syrc Thaa
61f Adlm Arab Gara Nkoo Rohg Syrc Thaa Yezi
640 Adlm Arab Mand Mani Ougr Phlp Rohg Sogd Syrc
64b..655 Arab Syrc
660..669 Arab Thaa Yezi
670 Arab Syrc
6d4 Arab Rohg
951 Beng Deva Gran Gujr Guru Knda Latn Mlym Nand Newa Orya Shrd Taml Telu Tirh
952 Beng Deva Gran Gujr Guru Knda Latn Mlym Newa Orya Taml Telu Tirh
964 Beng Deva Dogr Gong Gonm Gran Gujr Guru Knda Mahj Mlym Nand Onao Orya Sind Sinh Sylo Takr Taml Telu Tirh
965 Beng Deva Dogr Gong Gonm Gran Gujr Gukh Guru Knda Limb Mahj Mlym Nand Onao Orya Sind Sinh Sylo Takr Taml Telu Tirh
966..96f Deva Dogr Kthi Mahj
9e6..9ef Beng Cakm Sylo
a66..a6f Guru Mult
ae6..aef Gujr Khoj
be6..bf3 Gran Taml
ce6..cef Knda Nand Tutg
1040..1049 Cakm Mymr Tale
10fb Geor Glag Latn
16eb..16ed Runr
1735..1736 Buhd Hano Tagb Tglg
1802..1803 Mong Phag
1805 Mong Phag
1cd0 Beng Deva Gran Knda
1cd1 Deva
1cd2 Beng Deva Gran Knda
1cd3 Deva Gran Knda
1cd4 Deva
1cd5 Beng Deva Newa Telu Tirh
1cd6 Beng Deva Telu
1cd7 Deva Newa Shrd
1cd8 Beng Deva Newa Telu
1cd9 Deva Shrd
1cda Deva Knda Mlym Orya Taml Telu
1cdb Deva
1cdc..1cdd Deva Shrd
1cde..1cdf Deva
1ce0 Deva Shrd
1ce1 Beng Deva
1ce2 Deva Newa Tirh
1ce3..1ce8 Deva
1ce9 Deva Nand Newa
1cea Beng Deva Shrd
1ceb Deva Newa
1cec Deva
1ced Beng Deva Newa Shrd
1cee..1cf1 Deva
1cf2 Beng Deva Gran Knda Mlym Nand Orya Sinh Telu Tirh Tutg
1cf3 Deva Gran
1cf4 Deva Gran Knda Tutg
1cf5..1cf6 Beng Deva
1cf7 Beng
1cf8..1cf9 Deva Gran
1cfa Nand
1dc0..1dc1 Grek
1df8 Cyrl Latn Syrc
1dfa Syrc
202f Latn Mong Phag
204f Adlm Arab
205a Cari Geor Glag Hung Lyci Orkh
205d Cari Grek Hung Mero
20f0 Deva Gran Latn
2e17 Copt Latn
2e30 Avst Orkh
2e31 Avst Cari Geor Hung Kthi Lydi Samr
2e3c Dupl
2e41 Adlm Arab Hung
2e43 Cyrl Glag
2ff0..2fff Hani Tang
3001 Bopo Hang Hani Hira Kana Mong Yiii
3002 Bopo Hang Hani Hira Kana Mong Phag Yiii
3003 Bopo Hang Hani Hira Kana
3006 Hani
3008..3009 Bopo Hang Hani Hira Kana Mong Tibt Yiii
300a..300b Bopo Hang Hani Hira Kana Lisu Mong Tibt Yiii
300c..3011 Bopo Hang Hani Hira Kana Yiii
3013 Bopo Hang Hani Hira Kana
3014..301b Bopo Hang Hani Hira Kana Yiii
301c..301f Bopo Hang Hani Hira Kana
302a..302d Bopo Hani
3030 Bopo Hang Hani Hira Kana
3031..3035 Hira Kana
3037 Bopo Hang Hani Hira Kana
303c..303d Hani Hira Kana
303e..303f Hani
3099..309c Hira Kana
30a0 Hira Kana
30fb Bopo Hang Hani Hira Kana Yiii
30fc Hira Kana
3190..319f Hani
31c0..31e5 Hani
31ef Hani Tang
3220..3247 Hani
3280..32b0 Hani
32c0..32cb Hani
32ff Hani
3358..3370 Hani
337b..337f Hani
33e0..33fe Hani
a66f Cyrl Glag
a700..a707 Hani Latn
a830..a832 Deva Dogr Gujr Guru Khoj Knda Kthi Mahj Mlym Modi Nand Shrd Sind Takr Tirh Tutg
a833..a835 Deva Dogr Gujr Guru Khoj Knda Kthi Mahj Modi Nand Shrd Sind Takr Tirh Tutg
a836..a837 Deva Dogr Gujr Guru Khoj Kthi Mahj Modi Sind Takr Tirh
a838 Deva Dogr Gujr Guru Khoj Kthi Mahj Modi Shrd Sind Takr Tirh
a839 Deva Dogr Gujr Guru Khoj Kthi Mahj Modi Sind Takr Tirh
a8f1 Beng Deva Tutg
a8f3 Deva Taml
a92e Kali Latn Mymr
a9cf Bugi Java
fd3e..fd3f Arab Nkoo
fdf2 Arab Thaa
fdfd Arab Thaa
fe45..fe46 Bopo Hang Hani Hira Kana
ff61..ff65 Bopo Hang Hani Hira Kana Yiii
ff70 Hira Kana
ff9e..ff9f Hira Kana
10100..10101 Cpmn Cprt Linb
10102 Cprt Linb
10107..10133 Cprt Lina Linb
10137..1013f Cprt Linb
102e0..102fb Arab Copt
10af2 Mani Ougr
11301 Gran Taml
11303 Gran Taml
1133b..1133c Gran Taml
11fd0..11fd1 Gran Taml
11fd3 Gran Taml
1bca0..1bca3 Dupl
1d360..1d371 Hani
1f250..1f251 Hani
`

// PHP FILTER_VALIDATE_EMAIL regex, based on Michael Rushton copyright 2009-10.
// http://squiloople.com/ . Free to use and redistribute; retain this notice.
const eggEmailPHPFilterUnicodePattern = `/^(?!(?:(?:\x22?\x5C[\x00-\x7E]\x22?)|(?:\x22?[^\x5C\x22]\x22?)){255,})(?!(?:(?:\x22?\x5C[\x00-\x7E]\x22?)|(?:\x22?[^\x5C\x22]\x22?)){65,}@)(?:(?:[\x21\x23-\x27\x2A\x2B\x2D\x2F-\x39\x3D\x3F\x5E-\x7E\pL\pN]+)|(?:\x22(?:[\x01-\x08\x0B\x0C\x0E-\x1F\x21\x23-\x5B\x5D-\x7F\pL\pN]|(?:\x5C[\x00-\x7F]))*\x22))(?:\.(?:(?:[\x21\x23-\x27\x2A\x2B\x2D\x2F-\x39\x3D\x3F\x5E-\x7E\pL\pN]+)|(?:\x22(?:[\x01-\x08\x0B\x0C\x0E-\x1F\x21\x23-\x5B\x5D-\x7F\pL\pN]|(?:\x5C[\x00-\x7F]))*\x22)))*@(?:(?:(?!.*[^.]{64,})(?:(?:(?:xn--)?[a-z0-9]+(?:-+[a-z0-9]+)*\.){1,126}){1,}(?:(?:[a-z][a-z0-9]*)|(?:(?:xn--)[a-z0-9]+))(?:-+[a-z0-9]+)*)|(?:\[(?:(?:IPv6:(?:(?:[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){7})|(?:(?!(?:.*[a-f0-9][:\]]){7,})(?:[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){0,5})?::(?:[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){0,5})?)))|(?:(?:IPv6:(?:(?:[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){5}:)|(?:(?!(?:.*[a-f0-9]:){5,})(?:[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){0,3})?::(?:[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){0,3}:)?)))?(?:(?:25[0-5])|(?:2[0-4][0-9])|(?:1[0-9]{2})|(?:[1-9]?[0-9]))(?:\.(?:(?:25[0-5])|(?:2[0-4][0-9])|(?:1[0-9]{2})|(?:[1-9]?[0-9]))){3}))\]))$/iDu`

// PHP FILTER_VALIDATE_EMAIL regex, based on Michael Rushton copyright 2009-10.
// http://squiloople.com/ . Free to use and redistribute; retain this notice.
const eggEmailPHPFilterPattern = `/^(?!(?:(?:\x22?\x5C[\x00-\x7E]\x22?)|(?:\x22?[^\x5C\x22]\x22?)){255,})(?!(?:(?:\x22?\x5C[\x00-\x7E]\x22?)|(?:\x22?[^\x5C\x22]\x22?)){65,}@)(?:(?:[\x21\x23-\x27\x2A\x2B\x2D\x2F-\x39\x3D\x3F\x5E-\x7E]+)|(?:\x22(?:[\x01-\x08\x0B\x0C\x0E-\x1F\x21\x23-\x5B\x5D-\x7F]|(?:\x5C[\x00-\x7F]))*\x22))(?:\.(?:(?:[\x21\x23-\x27\x2A\x2B\x2D\x2F-\x39\x3D\x3F\x5E-\x7E]+)|(?:\x22(?:[\x01-\x08\x0B\x0C\x0E-\x1F\x21\x23-\x5B\x5D-\x7F]|(?:\x5C[\x00-\x7F]))*\x22)))*@(?:(?:(?!.*[^.]{64,})(?:(?:(?:xn--)?[a-z0-9]+(?:-+[a-z0-9]+)*\.){1,126}){1,}(?:(?:[a-z][a-z0-9]*)|(?:(?:xn--)[a-z0-9]+))(?:-+[a-z0-9]+)*)|(?:\[(?:(?:IPv6:(?:(?:[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){7})|(?:(?!(?:.*[a-f0-9][:\]]){7,})(?:[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){0,5})?::(?:[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){0,5})?)))|(?:(?:IPv6:(?:(?:[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){5}:)|(?:(?!(?:.*[a-f0-9]:){5,})(?:[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){0,3})?::(?:[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){0,3}:)?)))?(?:(?:25[0-5])|(?:2[0-4][0-9])|(?:1[0-9]{2})|(?:[1-9]?[0-9]))(?:\.(?:(?:25[0-5])|(?:2[0-4][0-9])|(?:1[0-9]{2})|(?:[1-9]?[0-9]))){3}))\]))$/iD`
