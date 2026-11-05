"""Write owned pending shared-callsite proposals and Go overlay, never live files."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
out=root/'artifacts/game-parity-20261029'
def once(text,old,new):
    if text.count(old)!=1: raise ValueError(f'Expected unique hook: {old[:100]}')
    return text.replace(old,new,1)
paths={}
source=(root/'internal/panel/game_templates.go').read_text()
anchor='\tAgreements               []templateAgreement   `json:"agreements,omitempty"`'
if source.count(anchor)!=2: raise ValueError('Template struct anchors changed')
source=source.replace(anchor,anchor+'\n\tSetupValidation          []templateSetupValidation `json:"setup_validation,omitempty"`')
source=once(source,'entry.Agreements = override.Agreements','entry.Agreements = override.Agreements\n\t\t\t\tentry.SetupValidation = override.SetupValidation')
source=once(source,'\tdetail := entry.Detail','\tif setupErr := validateTemplateSetupMetadata(entry.SetupValidation, entry.Egg); setupErr != nil {\n\t\terr, available = setupErr, false\n\t}\n\tdetail := entry.Detail')
source=once(source,'\tif entry.PrimaryPortEnv != "" {','\tif len(entry.SetupValidation)>0 { out["setup_validation"] = entry.SetupValidation }\n\tif entry.PrimaryPortEnv != "" {')
anchor='\tif err = guardTemplateSteamEnvironment(env, entry); err != nil {'
source=once(source,anchor,'\tif err = validateTemplateSetupEnvironment(entry.SetupValidation, entry.Egg, env); err != nil {\n\t\tfail(w, err)\n\t\treturn\n\t}\n'+anchor)
paths['internal/panel/game_templates.go']=source
source=(root/'internal/panel/game_install_ports.go').read_text()
anchor='\tip := gamePortBindIP(allocations)'
source=once(source,anchor,'\tif err := validateTemplateSetupEnvironment(entry.SetupValidation, entry.Egg, environment); err != nil { return gamePortPlan{}, nil, err }\n'+anchor)
anchor='\ta.writeGamePortPreview(w, r, in, entry, env)'
source=once(source,anchor,'\tif err = validateTemplateSetupEnvironment(entry.SetupValidation, entry.Egg, env); err != nil { fail(w,err); return }\n'+anchor)
paths['internal/panel/game_install_ports.go']=source
source=(root/'web/src/client/templateSetupValidation.ts').read_text()
source="import {templateSetupRuleProblems,type TemplateSetupValidation} from './templateSetupRules.ts';\n"+source
source=once(source,'  variables:(TemplateVariableDefinition','  setupValidation?:TemplateSetupValidation[]|null;\n  variables:(TemplateVariableDefinition')
anchor='  if(input.fs25&&!problems.some'
source=once(source,anchor,"  for(const problem of templateSetupRuleProblems(input.setupValidation,input.variables,input.environment))if(!problems.some(p=>p.field===problem.field))problems.push(problem);\n"+anchor)
paths['web/src/client/templateSetupValidation.ts']=source
source=(root/'web/src/client/TemplateGames.tsx').read_text()
source="import {type TemplateSetupValidation} from './templateSetupRules';\n"+source
source=once(source,'type TemplateOptions = Template & {','type TemplateOptions = Template & {setup_validation?:TemplateSetupValidation[]|null; ')
source=once(source,'agreements:options.agreements});','agreements:options.agreements,setupValidation:options.setup_validation});')
paths['web/src/client/TemplateGames.tsx']=source
overlay={}
for path,body in paths.items():
    target=out/('banana-wave4-setup-'+Path(path).name+'.pending')
    target.write_text(body,encoding='utf-8',newline='\n')
    if path.endswith('.go'): overlay[str((root/path).resolve())]=str(target.resolve())
test=root/'internal/panel/game_setup_validation_routes_test.go'
overlay[str(test.resolve())]=str((out/'banana-wave4-setup-routes_test.go.pending').resolve())
(out/'banana-wave4-setup-overlay.json').write_text(json.dumps({'Replace':overlay},indent=2)+'\n')
print('\n'.join(str(out/('banana-wave4-setup-'+Path(p).name+'.pending')) for p in paths))
