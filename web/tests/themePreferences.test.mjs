import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultTheme,parseTheme,themeKey,themeVariables,readablePair,contrast} from '../src/themePreferences.ts';

test('theme parser rejects malformed, incomplete and unsupported stored preferences',()=>{
 assert.deepEqual(parseTheme(defaultTheme),defaultTheme);
 for(const value of [null,{},[],{...defaultTheme,version:2},{...defaultTheme,accentA:'red'},{...defaultTheme,backgroundA:'url(https://example.test)'},{...defaultTheme,accentGradient:'false'},{...defaultTheme,backgroundGradient:undefined}])assert.equal(parseTheme(value),null);
 assert.equal(parseTheme({...defaultTheme,accentA:'#ABCDEF',token:'ignored'}).accentA,'#abcdef');
 assert.equal('token' in parseTheme({...defaultTheme,token:'ignored'}),false);
});
test('storage namespaces isolate account and panel without ambiguous delimiters',()=>{
 assert.notEqual(themeKey('https://one.test','a'),themeKey('https://one.test','b'));
 assert.notEqual(themeKey('https://one.test','a'),themeKey('https://two.test','a'));
 assert.notEqual(themeKey('a:b','c'),themeKey('a','b:c'));
});

test('legacy themes upgrade without losing colors and glass settings are strictly bounded',()=>{
 const {glassCards,cardOpacity,...legacy}=defaultTheme;
 assert.deepEqual(parseTheme(legacy),defaultTheme);
 for(const value of [null,'57',NaN,Infinity,34,101,57.5])assert.equal(parseTheme({...defaultTheme,cardOpacity:value}),null);
 for(const value of [null,0,'true'])assert.equal(parseTheme({...defaultTheme,glassCards:value}),null);
 for(const opacity of [35,57,100])assert.equal(parseTheme({...defaultTheme,cardOpacity:opacity}).cardOpacity,opacity);
 const customized={...defaultTheme,glassCards:false,cardOpacity:42,backgroundA:'#233144'};
 assert.deepEqual(parseTheme(JSON.parse(JSON.stringify(customized))),customized);
});

test('glass opacity preserves readable console surfaces and the solid option preserves the chosen opacity',()=>{
 const translucent=themeVariables({...defaultTheme,cardOpacity:35});
 assert.equal(translucent['--theme-card-surface'],'rgba(24,28,37,0.35)');
 assert.equal(translucent['--theme-console-surface'],'rgba(15,18,24,0.85)');
 assert.equal(translucent['--theme-card-blur'],'24px');
 const solid=themeVariables({...defaultTheme,glassCards:false,cardOpacity:35});
 assert.equal(solid['--theme-card-surface'],'rgba(24,28,37,1)');
 assert.equal(solid['--theme-console-surface'],'rgba(15,18,24,1)');
 assert.equal(solid['--theme-card-blur'],'0px');
});
test('both gradient endpoints meet normal text contrast for arbitrary colors',()=>{
 const colors=['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00','#777777','#4d78c9','#326f73'];
 for(const a of colors)for(const b of colors)for(const white of [true,false]){const pair=readablePair(a,b,white);const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));for(let i=0;i<=20;i++){const right=rgb(pair.b);const color='#'+rgb(pair.a).map((n,j)=>Math.round(n+(right[j]-n)*i/20).toString(16).padStart(2,'0')).join('');assert.ok(contrast(color,pair.ink)>=4.5);if(white)assert.ok(contrast(color,'#a6afbf')>=4.5)}}
});
test('disabled gradients use only the first color while preserving second preferences',()=>{
 const values=themeVariables({...defaultTheme,accentGradient:false,backgroundGradient:false});
 const renderedAccent=values['--theme-primary'].match(/#[\da-f]{6}/g);
 assert.equal(renderedAccent.length,2);
 assert.equal(renderedAccent[0],renderedAccent[1]);
 assert.ok(contrast(renderedAccent[0],values['--theme-primary-ink'])>=4.5);
 assert.equal(values['--theme-background'],`linear-gradient(155deg,${defaultTheme.backgroundA},${defaultTheme.backgroundA})`);
 assert.equal(defaultTheme.accentB,'#326f73');
});
