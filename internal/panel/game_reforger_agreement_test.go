package panel

import (
	"net/http"
	"testing"
)

func TestReforgerReviewedPublisherAgreement(t *testing.T) {
	found := false
	for _, entry := range gameTemplates().Entries {
		if err := validateTemplateAgreements(entry); err != nil {
			t.Fatalf("%s: %v", entry.Path, err)
		}
		if entry.Path != "arma/arma_reforger/egg-arma-reforger.json" {
			continue
		}
		found = true
		if len(entry.Agreements) != 2 {
			t.Fatal("Reforger requires separate publisher and BattlEye agreements")
		}
		a := entry.Agreements[0]
		if a.Environment != "REFORGER_ACCEPT_EULA" || a.EffectiveDate != "" || a.ReviewedDate != "2026-10-24" || a.AcceptValue != "d1212a350a446961503f6cc8bbc032eaae375bcc4ac807f4c65e4eafdcc683f0" || len([]byte(a.Text)) != 3928 {
			t.Fatal("Reforger reviewed identity changed or publisher effective date was invented")
		}
		if requireTemplateAgreements(entry, M{"REFORGER_ACCEPT_EULA": "0"}) == nil {
			t.Fatal("default must not imply consent")
		}
		b := entry.Agreements[1]
		if b.Environment != "REFORGER_ACCEPT_BATTLEYE" || b.EffectiveDate != "" || b.ReviewedDate != "2026-10-24" || b.AcceptValue != "160cf73c53860a72b6c4aaf9617f27721bc535064dba63125281bbf6d4cd03f2" || len([]byte(b.Text)) != 2758 {
			t.Fatal("BattlEye reviewed identity changed")
		}
		for _, input := range []M{{"REFORGER_ACCEPT_EULA": a.AcceptValue}, {"REFORGER_ACCEPT_BATTLEYE": b.AcceptValue}, {"REFORGER_ACCEPT_EULA": a.AcceptValue, "REFORGER_ACCEPT_BATTLEYE": "0"}} {
			if requireTemplateAgreements(entry, input) == nil {
				t.Fatal("one agreement must not imply the other")
			}
		}
		if err := requireTemplateAgreements(entry, M{"REFORGER_ACCEPT_EULA": a.AcceptValue, "REFORGER_ACCEPT_BATTLEYE": b.AcceptValue}); err != nil {
			t.Fatal(err)
		}
	}
	if !found {
		t.Fatal("Reforger missing")
	}
}

func TestPublisherAgreementReviewDateValidation(t *testing.T) {
	entry := publisherAgreementFixture()
	entry.Agreements[0].EffectiveDate = ""
	entry.Agreements[0].ReviewedDate = "2026-10-24"
	if err := validateTemplateAgreements(entry); err != nil {
		t.Fatal(err)
	}
	for _, dates := range [][2]string{{"", ""}, {"", "2026-02-30"}, {"invalid", "2026-10-24"}, {"2026-03-03", "invalid"}} {
		entry.Agreements[0].EffectiveDate, entry.Agreements[0].ReviewedDate = dates[0], dates[1]
		if validateTemplateAgreements(entry) == nil {
			t.Fatalf("invalid agreement dates accepted: %v", dates)
		}
	}
}

func TestReforgerReviewedAgreementOptions(t *testing.T) {
	a, _, admin, _, _ := steamGamesFixture(t)
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	for _, entry := range gameTemplates().Entries {
		if entry.Path != "arma/arma_reforger/egg-arma-reforger.json" {
			continue
		}
		options := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/templates/"+entry.ID, nil, http.StatusOK)["attributes"])
		agreements := asSlice(options["agreements"])
		if len(agreements) != 2 || str(asMap(agreements[0])["effective_date"]) != "" || str(asMap(agreements[0])["reviewed_date"]) != "2026-10-24" || str(asMap(agreements[1])["environment"]) != "REFORGER_ACCEPT_BATTLEYE" {
			t.Fatal("actual Reforger options lost reviewed date or invented effective date")
		}
		return
	}
	t.Fatal("Reforger recipe missing")
}
