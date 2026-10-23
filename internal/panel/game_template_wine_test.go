package panel

import "testing"

func TestTemplateTypedWinePrerequisiteOwnership(t *testing.T) {
	for _, raw := range []string{"vcrun2022 corefonts", "dotnet48", "", "literal operator value"} {
		env := M{"AUTO_UPDATE": "1", "WINETRICKS_RUN": raw, "VOLTRA_WINETRICKS_RUN": "spoofed"}
		if err := templateRuntimeEnvironment(M{"features": []any{"voltra_steam_template", "voltra_typed_wine"}}, env); err != nil {
			t.Fatal(err)
		}
		if env["WINETRICKS_RUN"] != "" || env["VOLTRA_WINETRICKS_RUN"] != raw || env["AUTO_UPDATE"] != "0" || env["VOLTRA_STEAM_AUTO_UPDATE"] != "1" {
			t.Fatal("typed runtime lost original prerequisite selection")
		}
	}
	for _, features := range [][]any{nil, {"voltra_steam_template"}, {"voltra_typed_wine"}} {
		env := M{"AUTO_UPDATE": "1", "WINETRICKS_RUN": "dotnet48"}
		if err := templateRuntimeEnvironment(M{"features": features}, env); err != nil {
			t.Fatal(err)
		}
		if env["WINETRICKS_RUN"] != "dotnet48" || env["VOLTRA_WINETRICKS_RUN"] != nil {
			t.Fatal("unrelated image prerequisite behavior changed")
		}
	}
	if err := templateRuntimeEnvironment(M{"features": []any{"voltra_steam_template", "voltra_private_wine"}}, M{"AUTO_UPDATE": "0", "WINETRICKS_RUN": "dotnet48"}); err == nil {
		t.Fatal("legacy fixed-mono guard changed")
	}
}
