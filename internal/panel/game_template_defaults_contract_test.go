package panel

import "testing"

// A valid egg import is insufficient if its default environment cannot be
// transformed into the daemon configuration used during server creation.
func TestGameCatalogRuntimeDefaultsContract(t *testing.T) {
	for _, entry := range gameTemplates().Entries {
		t.Run(entry.Path, func(t *testing.T) {
			egg, variables, err := parseEggDocument(entry.Egg)
			if err != nil {
				t.Fatal(err)
			}
			env := M{}
			for _, variable := range variables {
				env[str(variable["env_variable"])] = variable["default_value"]
			}
			if err := templateRuntimeEnvironment(egg, env); err != nil {
				t.Fatalf("default environment cannot produce daemon configuration: %v", err)
			}
		})
	}
}
