// Deliberately fails closed. Replace with publisher/game-specific observations;
// never treat these example hooks as native evidence.
const missing = () => { throw Error('Configure game-specific evidence hooks before execution'); };
export const verifyBuild = missing;
export const ready = missing;
export const settings = missing;
export const saved = missing;
export const loaded = missing;
