// Share the prefetch with React.lazy, but allow a failed prefetch to retry when
// the route is actually rendered, e.g. after a temporary connection failure.
export function preloadRoute<T>(load:()=>Promise<T>):()=>Promise<T> {
  let pending:Promise<T>|undefined;
  return()=>pending??=(Promise.resolve().then(load).catch(error=>{pending=undefined;throw error}));
}
