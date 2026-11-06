import {fs25} from './fs25.js';
// Each provider/game owns extraction, validation and matching. No remote code.
export const modules = [fs25];
export const moduleFor = id => modules.find(module => module.id === id);
