package panel

import (
	"net/url"
	"reflect"
	"testing"
)

func TestParseListPageClampsAndReadsFilters(t *testing.T) {
	for _, tc := range []struct {
		query     string
		page, per int
	}{
		{"", 1, 50}, {"page=3&per_page=20", 3, 20}, {"page=0&per_page=0", 1, 50}, {"page=-2&per_page=-5", 1, 50},
		{"page=x&per_page=y", 1, 50}, {"per_page=500", 1, 100}, {"page=99999999999", maxListPage, 50}, {"page=999999999999999999999", 1, 50}, {"page=5000000", maxListPage, 50},
	} {
		values, _ := url.ParseQuery(tc.query)
		p := parseListPage(values, 50, 100)
		if p.Page != tc.page || p.PerPage != tc.per {
			t.Errorf("%q: page %d per %d", tc.query, p.Page, p.PerPage)
		}
	}
	values, _ := url.ParseQuery("filter[name]=Alpha&filter[name]=Beta&filter[node_id]=2&filter=x&filters[id]=1")
	p := parseListPage(values, 50, 100)
	if !reflect.DeepEqual(p.Filters, map[string]string{"name": "Alpha", "node_id": "2"}) {
		t.Fatal(p.Filters)
	}
}

func TestListPageBoundsAndMeta(t *testing.T) {
	p := listPage{Page: 2, PerPage: 10}
	if start, end := p.Bounds(25); start != 10 || end != 20 {
		t.Fatal(start, end)
	}
	if start, end := (listPage{Page: 4, PerPage: 10}).Bounds(25); start != 25 || end != 25 {
		t.Fatal(start, end)
	}
	want := M{"pagination": M{"total": 25, "count": 10, "per_page": 10, "current_page": 2, "total_pages": 3, "links": M{}}}
	if got := p.Meta(25, 10); !reflect.DeepEqual(got, want) {
		t.Fatal(got)
	}
	if pages := (listPage{Page: 1, PerPage: 10}).Meta(0, 0)["pagination"].(M)["total_pages"]; pages != 1 {
		t.Fatal("an empty list has one page")
	}
	rows := []M{{"id": 1}, {"id": 2}, {"id": 3}}
	out := (listPage{Page: 2, PerPage: 2}).Collection("thing", rows)
	if len(out["data"].([]M)) != 1 || out["meta"].(M)["pagination"].(M)["count"] != 1 {
		t.Fatal(out)
	}
}

func TestListFilterSQL(t *testing.T) {
	f := listFilterSQL{Exact: map[string]bool{"id": true, "port": true}, Substring: map[string]bool{"name": true, "short": true}, Columns: map[string]bool{"id": true, "name": true}}
	where, args := f.where(map[string]string{"name": "Alp", "id": "3", "secret": "x"}, nil)
	if where != `COALESCE("id"::text,'')=$1 AND strpos(lower(COALESCE("name"::text,'')),lower($2))>0` || !reflect.DeepEqual(args, []any{"3", "Alp"}) {
		t.Fatal(where, args)
	}
	// Fields the table lacks match nothing, except an empty substring.
	if where, args := f.where(map[string]string{"short": "x"}, nil); where != "FALSE" || len(args) != 0 {
		t.Fatal(where)
	}
	if where, _ := f.where(map[string]string{"short": "", "name": ""}, nil); where != "TRUE" {
		t.Fatal(where)
	}
	if where, _ := f.where(map[string]string{"port": ""}, nil); where != "FALSE" {
		t.Fatal(where)
	}
	// An exact empty filter on an existing column compares with the empty text.
	if where, args := f.where(map[string]string{"id": ""}, []any{"first"}); where != `COALESCE("id"::text,'')=$2` || len(args) != 2 {
		t.Fatal(where, args)
	}
	skip := listFilterSQL{Exact: map[string]bool{"external_id": true}, SkipEmpty: true}
	if where, args := skip.where(map[string]string{"external_id": ""}, nil); where != "TRUE" || len(args) != 0 {
		t.Fatal(where)
	}
}
