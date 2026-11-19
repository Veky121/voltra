import {createElement,lazy,useState,type ComponentType} from 'react';
import {preloadRoute} from './preloadRoute';

/**
 * A lazy route that is drawn at once when its module has already loaded.
 *
 * React.lazy shows its fallback for at least one render even when the module
 * is in memory, and React then keeps a fallback on screen for a while before
 * replacing it. The first page is preloaded, so drawing it directly removes
 * that wait from every start. A route that is not ready behaves exactly like
 * React.lazy, including the retry after a failed preload.
 */
export function readyRoute<P extends object>(load:()=>Promise<{default:ComponentType<P>}>){
  let ready:ComponentType<P>|undefined;
  const preload=preloadRoute(()=>load().then(module=>{ready=module.default;return module}));
  const Lazy=lazy(preload) as unknown as ComponentType<P>;
  function Route(props:P){
    // Chosen once per mount: changing the component type later would remount the page.
    const [Page]=useState<ComponentType<P>>(()=>ready??Lazy);
    return createElement(Page,props);
  }
  return Object.assign(Route,{preload});
}
