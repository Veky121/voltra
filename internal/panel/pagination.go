package panel

import (
	"net/url"
	"slices"
	"strconv"
	"strings"
)

// maxListPage keeps offsets far from integer overflow for hostile page values.
const maxListPage = 1_000_000

// listPage is the parsed page, per_page and filter[...] query of a list
// request. Out-of-range values are clamped rather than rejected, which is how
// the native list endpoints have always treated them.
type listPage struct {
	Page, PerPage int
	// Filters holds the first value of each filter[name] parameter.
	Filters map[string]string
}

func parseListPage(query url.Values, defaultPerPage, maxPerPage int) listPage {
	p := listPage{Page: 1, PerPage: defaultPerPage, Filters: map[string]string{}}
	if n, err := strconv.Atoi(query.Get("per_page")); err == nil && n > 0 {
		p.PerPage = min(n, maxPerPage)
	}
	if n, err := strconv.Atoi(query.Get("page")); err == nil && n > 0 {
		p.Page = min(n, maxListPage)
	}
	for key, values := range query {
		if len(values) == 0 || !strings.HasPrefix(key, "filter[") || !strings.HasSuffix(key, "]") {
			continue
		}
		p.Filters[strings.TrimSuffix(strings.TrimPrefix(key, "filter["), "]")] = values[0]
	}
	return p
}

// Offset is the number of rows before this page.
func (p listPage) Offset() int { return (p.Page - 1) * p.PerPage }

// Bounds returns the slice range of this page within total rows.
func (p listPage) Bounds(total int) (start, end int) {
	start = min(p.Offset(), total)
	end = min(start+p.PerPage, total)
	return start, end
}

// Meta is the native pagination block for a page holding count of total rows.
func (p listPage) Meta(total, count int) M {
	pages := (total + p.PerPage - 1) / p.PerPage
	if pages == 0 {
		pages = 1
	}
	return M{"pagination": M{"total": total, "count": count, "per_page": p.PerPage, "current_page": p.Page, "total_pages": pages, "links": M{}}}
}

// Collection pages already presented rows in memory.
func (p listPage) Collection(object string, rows []M) M {
	start, end := p.Bounds(len(rows))
	out := collection(object, rows[start:end])
	out["meta"] = p.Meta(len(rows), end-start)
	return out
}

// listFilterSQL turns filter[...] values into a WHERE clause. Exact columns
// compare their text form, as fmt.Sprint did in Go; substring columns match
// case-insensitively. A filter on an allowed field the table does not have
// matches nothing, except an empty substring, which matches everything.
type listFilterSQL struct {
	Exact, Substring map[string]bool // allowed filter fields
	Columns          map[string]bool // columns of the table; nil means every allowed field exists
	SkipEmpty        bool            // ignore filters whose value is empty
}

func (f listFilterSQL) where(filters map[string]string, args []any) (string, []any) {
	clauses := []string{}
	keys := make([]string, 0, len(filters))
	for key := range filters {
		keys = append(keys, key)
	}
	// Deterministic SQL text keeps statement caches and tests stable.
	slices.Sort(keys)
	for _, field := range keys {
		value := filters[field]
		exact, substring := f.Exact[field], f.Substring[field]
		if !exact && !substring || f.SkipEmpty && value == "" {
			continue
		}
		if f.Columns != nil && !f.Columns[field] {
			if exact || value != "" {
				clauses = append(clauses, "FALSE")
			}
			continue
		}
		column, err := quoted(field)
		if err != nil {
			clauses = append(clauses, "FALSE")
			continue
		}
		args = append(args, value)
		slot := "$" + strconv.Itoa(len(args))
		if exact {
			clauses = append(clauses, "COALESCE("+column+"::text,'')="+slot)
		} else if value != "" {
			clauses = append(clauses, "strpos(lower(COALESCE("+column+"::text,'')),lower("+slot+"))>0")
		} else {
			args = args[:len(args)-1]
		}
	}
	if len(clauses) == 0 {
		return "TRUE", args
	}
	return strings.Join(clauses, " AND "), args
}
