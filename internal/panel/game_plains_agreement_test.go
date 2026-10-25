package panel

import "testing"

func TestPlainsReviewedPublisherAgreement(t *testing.T) {
	found := false
	for _, entry := range gameTemplates().Entries {
		if err := validateTemplateAgreements(entry); err != nil {
			t.Fatalf("%s: %v", entry.Path, err)
		}
		if entry.Path != "plains_of_pain/egg-plains-of-pain.json" {
			continue
		}
		found = true
		if len(entry.Agreements) != 1 {
			t.Fatal("Plains requires exactly one reviewed agreement")
		}
		agreement := entry.Agreements[0]
		if agreement.Environment != "PLAINS_ACCEPT_EULA" || agreement.AcceptValue != "9b8cab870158a54a15526ed3af2c4104d8b420cdb9260f729b91f7665eb3ba5a" || agreement.EffectiveDate != "2026-03-03" || len([]byte(agreement.Text)) != 10984 {
			t.Fatal("Plains reviewed terms identity changed without review")
		}
		if err := requireTemplateAgreements(entry, M{"PLAINS_ACCEPT_EULA": "0"}); err == nil {
			t.Fatal("canonical Plains default must not imply agreement")
		}
		if err := requireTemplateAgreements(entry, M{"PLAINS_ACCEPT_EULA": agreement.AcceptValue}); err != nil {
			t.Fatal(err)
		}
	}
	if !found {
		t.Fatal("Plains recipe missing")
	}
}
