"""Pending-only correction for one publisher-defined public numeric timeout."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[2]
out=root/'artifacts/game-parity-20261029'
source=(root/'internal/panel/game_settings_openttd_fields.go').read_text()
assert source.count('import "strings"')==1
source=source.replace('import "strings"','import ("strings"; "strconv")')
anchor='\t\tfolded := strings.ToLower(gameSettingsINIFold(field.key))'
assert source.count(anchor)==1
source=source.replace(anchor,anchor+'''
        if file == "/openttd.cfg" && folded == "network/max_password_time" {
            if field.kind != "readonly" && openttdTimeoutValue(field.value) { field.kind = "number" } else { field.kind = "readonly" }
        }
''')
anchor='\treturn parsed\n}'
assert source.count(anchor)==1
source=source.replace(anchor,'''
    patch := parsed.patch
    parsed.patch = func(changes map[string]string) ([]byte,error) {
        for key,value := range changes {
            if file == "/openttd.cfg" && strings.ToLower(gameSettingsINIFold(key)) == "network/max_password_time" && !openttdTimeoutValue(value) { return nil,bad("Password-entry timeout must be a whole number from 0 to 32000.") }
        }
        return patch(changes)
    }
    return parsed
}''')
source+='''
// Publisher15.3 network_settings.ini: SLE_UINT16, default2000, min0, max32000.
// This is a public timeout, not a credential. Exceptions require valid numeric
// type/value AND exact recipe/document/key; actual passwords stay protected.
func openttdTimeoutValue(value string) bool {
    n,err:=strconv.ParseUint(value,10,16)
    return err==nil && n<=32000 && strconv.FormatUint(n,10)==value
}
func openttdPublicNumericField(egg M,file string,field gameSetting) bool {
    return file=="/openttd.cfg" && field.kind=="number" && strings.ToLower(gameSettingsINIFold(field.key))=="network/max_password_time" && openttdTimeoutValue(field.value) && nativeSettingsIsRecipe(egg,"openttd/egg-open-t-t-d-server.json")
}
'''
(out/'banana-wave4-openttd-timeout-fields.go.pending').write_text(source)
documents=(root/'internal/panel/game_settings_documents.go').read_text()
lines=[line for line in documents.splitlines() if 'secret := f.secret || gameSettingSecret.MatchString(f.key)' in line]
assert len(lines)==1
anchor=lines[0]
assert '&& !(' in anchor and anchor.endswith(')')
# Retain root's current Craftopia/TShock/other explicit exceptions exactly.
documents=documents.replace(anchor,anchor[:-1]+' || openttdPublicNumericField(egg, file, f))')
(out/'banana-wave4-openttd-timeout-documents.go.pending').write_text(documents)
overlay={'Replace':{
str((root/'internal/panel/game_settings_openttd_fields.go').resolve()):str((out/'banana-wave4-openttd-timeout-fields.go.pending').resolve()),
str((root/'internal/panel/game_settings_documents.go').resolve()):str((out/'banana-wave4-openttd-timeout-documents.go.pending').resolve()),
str((root/'internal/panel/game_settings_openttd_timeout_test.go').resolve()):str((out/'banana-wave4-openttd-timeout_test.go.pending').resolve())}}
(out/'banana-wave4-openttd-timeout-overlay.json').write_text(json.dumps(overlay,indent=2)+'\n')
print('Pending exact timeout field/helper/getter proposal; canonical Go unchanged.')
