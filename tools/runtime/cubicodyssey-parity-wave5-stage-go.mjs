import fs from 'node:fs';
import path from 'node:path';
const test='internal/panel/game_settings_cubic_test.go.pending';
let body=fs.readFileSync(test,'utf8');
const sample=fs.readFileSync('tools/runtime/cubicodyssey-parity-wave5-publisher.sample','utf8');
if(!body.includes('func TestCubicSettingsActualPublisherSample(')){
body+='\nconst cubicActualPublisherSample = '+JSON.stringify(sample)+'\n\n'+`func TestCubicSettingsActualPublisherSample(t *testing.T) {
 p,err:=parseCubicSettings([]byte(cubicActualPublisherSample)); if err!=nil {t.Fatal(err)}
 if len(p.fields)!=3 {t.Fatalf("unexpected exposed fields: %#v",p.fields)}
 out,err:=p.patch(map[string]string{"serverName":"Operator chosen","privateServer":"TRUE","galaxySeed":"00042"});if err!=nil {t.Fatal(err)}
 want:=strings.Replace(cubicActualPublisherSample, "\\\"Cubic Odyssey Dedicated Server\\\"", "\\\"Operator chosen\\\"",1)
 want=strings.Replace(want,"privateServer FALSE","privateServer TRUE",1)
 want=strings.Replace(want,"galaxySeed 0","galaxySeed 00042",1)
 if string(out)!=want {t.Fatal("publisher unknown Difficulty/server fields were changed")}
 if _,err=parseCubicSettings(out);err!=nil {t.Fatal(err)}
}
`;
fs.writeFileSync(test,body);
}
const replacement={};for(const name of['game_settings_cubic.go','game_settings_cubic_test.go'])replacement[path.resolve('internal/panel',name)]=path.resolve('internal/panel',name+'.pending');
const overlay='artifacts/game-parity-20261029/cubicodyssey-wave5-go-overlay.json';fs.writeFileSync(overlay,JSON.stringify({Replace:replacement},null,2)+'\n');console.log(JSON.stringify({overlay,canonical_go_edited:false}));
