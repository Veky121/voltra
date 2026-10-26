package panel

import (
	"testing"
	"time"
)

func TestScheduleTimingAnchoredHours(t *testing.T) {
	expression, err := collabCron(M{"minute": "0", "hour": "5,9,13,17,21,1", "day_of_month": "*", "month": "*", "day_of_week": "*"})
	if err != nil {
		t.Fatal(err)
	}
	after := time.Date(2026, 10, 20, 4, 59, 0, 0, time.UTC)
	for _, want := range []string{"2026-10-20T05:00:00Z", "2026-10-20T09:00:00Z", "2026-10-20T13:00:00Z", "2026-10-20T17:00:00Z", "2026-10-20T21:00:00Z", "2026-10-21T01:00:00Z", "2026-10-21T05:00:00Z"} {
		after = expression.Next(after)
		if got := after.Format(time.RFC3339); got != want {
			t.Fatalf("next run %s, want %s", got, want)
		}
	}
}

func TestScheduleTimingDailyClockAcrossDST(t *testing.T) {
	zone, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Fatal(err)
	}
	expression, err := collabCron(M{"minute": "15", "hour": "5", "day_of_month": "*", "month": "*", "day_of_week": "*"})
	if err != nil {
		t.Fatal(err)
	}
	after := time.Date(2026, 10, 24, 5, 15, 0, 0, zone)
	for _, day := range []int{25, 26, 27} {
		after = expression.Next(after)
		if after.Day() != day || after.Hour() != 5 || after.Minute() != 15 {
			t.Fatalf("wrong daily clock time %s", after)
		}
	}
}
