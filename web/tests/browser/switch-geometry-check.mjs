import assert from 'node:assert/strict';

export async function verifySwitchGeometry(page,fixtureURL='http://127.0.0.1:5195/geometry'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(fixtureURL);await page.locator('[data-slot=switch]').first().waitFor();
 async function measurements(){return page.locator('[data-slot=switch]').evaluateAll(switches=>switches.map(control=>{
  const track=control.getBoundingClientRect(),thumb=control.querySelector('[data-slot=switch-thumb]').getBoundingClientRect();
  return {name:control.getAttribute('aria-label'),checked:control.getAttribute('aria-checked')==='true',disabled:control.matches(':disabled'),width:track.width,height:track.height,left:thumb.left-track.left,right:track.right-thumb.right,top:thumb.top-track.top,bottom:track.bottom-thumb.bottom};
 }))}
 function verify(values){for(const value of values){assert.equal(value.width,28,value.name+' track width');assert.equal(value.height,17,value.name+' track height');for(const side of ['left','right','top','bottom'])assert.ok(value[side]>=0.5,value.name+' thumb must stay inside '+side);if(value.checked)assert.ok(value.left>value.right,value.name+' checked thumb must sit on the right');else assert.ok(value.left<value.right,value.name+' unchecked thumb must sit on the left')}}
 let values=await measurements();assert.equal(values.length,24);verify(values);
 const initial=values;
 for(const value of initial){const control=page.getByRole('switch',{name:value.name,exact:true});if(value.disabled){await control.evaluate(control=>control.click());assert.equal(await control.isChecked(),value.checked)}else{await control.click();assert.equal(await control.isChecked(),!value.checked);await page.waitForTimeout(170);verify(await measurements());await control.press('Space');assert.equal(await control.isChecked(),value.checked);await page.waitForTimeout(170);verify(await measurements())}}
 for(const accent of ['#c174b0','#5da9be']){await page.evaluate(accent=>document.documentElement.style.setProperty('--primary',accent),accent);verify(await measurements())}
 await page.setViewportSize({width:390,height:844});verify(await measurements());
 assert.deepEqual(errors,[]);
 return {contexts:6,switches:24,pointerAndKeyboardChecks:24,disabledChecks:12,themes:2,mobileWidth:390};
}
