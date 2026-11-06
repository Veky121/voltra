package main

import "testing"

func TestPlacementRestoresNormalAndMaximizedWithoutMinimizing(t *testing.T) {
	for _, tc := range []struct{ show, flags, want uint32 }{{1, 0, 1}, {3, 0, 3}, {2, 0, 1}, {2, 2, 3}} {
		p := windowPlacement{ShowCmd: tc.show, Flags: tc.flags, NormalPosition: placementRect{-1800, -300, -400, 600}}
		got := p.forRestore()
		if !got.restorable() || got.ShowCmd != tc.want || got.NormalPosition != p.NormalPosition || got.Flags != 0 {
			t.Fatalf("restore mismatch: %+v", got)
		}
	}
	if (windowPlacement{}).restorable() {
		t.Fatal("accepted empty placement")
	}
}
