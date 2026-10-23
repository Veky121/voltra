// Original environment controls are part of the recipe compatibility contract.
import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const profiles=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const rows=[];
for(const entry of catalog.entries){
 const profile=profiles[entry.path];if(!profile)continue;
 const variables=new Set(profile.egg.variables.map(variable=>variable.env_variable));
 const missing=entry.egg.variables.map(variable=>variable.env_variable).filter(name=>!variables.has(name));
 const changed=entry.egg.variables.flatMap(original=>{
  const reviewed=profile.egg.variables.find(variable=>variable.env_variable===original.env_variable);
  return reviewed&&reviewed.rules!==original.rules?[{variable:original.env_variable,original_rules:original.rules,reviewed_rules:reviewed.rules}]:[];
 });
 const mixedCase=entry.egg.variables.map(variable=>variable.env_variable).filter(name=>name!==name.toUpperCase());
 rows.push({path:entry.path,revision:profile.revision,verification:profile.verification||'not_verified',missing_original_variables:missing,original_variables_requiring_uppercase_runtime_alias:mixedCase,changed_original_rules:changed});
}
const report={catalog_revision:catalog.revision,scope:'Variable-name retention and rule differences only. Retained names do not establish behavioral parity; changed rules require recipe-level review. Mixed-case original variables require runtime alias review because Wings uppercases environment names; their presence here does not establish a bug or a passing alias.',profiles:rows.length,profiles_with_missing_variables:rows.filter(row=>row.missing_original_variables.length).length,profiles_requiring_runtime_case_review:rows.filter(row=>row.original_variables_requiring_uppercase_runtime_alias.length).length,changed_rule_count:rows.reduce((count,row)=>count+row.changed_original_rules.length,0),entries:rows};
fs.writeFileSync('artifacts/game-profile-variable-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({profiles:report.profiles,profiles_with_missing_variables:report.profiles_with_missing_variables,missing:rows.filter(row=>row.missing_original_variables.length)},null,2));
