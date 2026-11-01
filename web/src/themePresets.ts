import {defaultTheme, type ThemePreferences} from './themePreferences';

export const themePresets: {name:string;theme:ThemePreferences}[] = [
  {name:'Soft capsule',theme:defaultTheme},
  {name:'Graphite',theme:{...defaultTheme,backgroundA:'#202124',backgroundB:'#121315',accentA:'#a1a1aa',accentB:'#71717a',backgroundGradient:false,accentGradient:false,glassCards:false}},
  {name:'Midnight',theme:{...defaultTheme,backgroundA:'#172540',backgroundB:'#0b1020',accentA:'#739cf4',accentB:'#67c4d8'}},
  {name:'Ocean',theme:{...defaultTheme,backgroundA:'#12343c',backgroundB:'#101b2e',accentA:'#40b9b1',accentB:'#5993db'}},
  {name:'Evergreen',theme:{...defaultTheme,backgroundA:'#20372c',backgroundB:'#101e1b',accentA:'#7fb48a',accentB:'#c1ac73'}},
  {name:'Iris dusk',theme:{...defaultTheme,backgroundA:'#211e32',backgroundB:'#151b27',accentA:'#735bb7',accentB:'#3a6e9d'}},
  {name:'Aurora',theme:{...defaultTheme,backgroundA:'#2f2245',backgroundB:'#102c32',accentA:'#b49ae8',accentB:'#6bc8b5'}},
  {name:'Coral tide',theme:{...defaultTheme,backgroundA:'#251e28',backgroundB:'#171c25',accentA:'#ac5363',accentB:'#366c7c'}},
  {name:'Rosewood',theme:{...defaultTheme,backgroundA:'#38252e',backgroundB:'#1c1924',accentA:'#dc8fa6',accentB:'#a899d5'}},
  {name:'Ember',theme:{...defaultTheme,backgroundA:'#38281e',backgroundB:'#1b1b24',accentA:'#e5a064',accentB:'#c77577'}},
  {name:'Sandstone',theme:{...defaultTheme,backgroundA:'#302e28',backgroundB:'#1b201f',accentA:'#c6b58e',accentB:'#83a899',glassCards:false}},
  {name:'Obsidian',theme:{...defaultTheme,backgroundA:'#09090b',backgroundB:'#09090b',accentA:'#eeeeef',accentB:'#a1a1aa',backgroundGradient:false,accentGradient:false,glassCards:false}},
];
