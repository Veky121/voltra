export const desktopResizeBorder = 8;
export const desktopResizeCorner = 18;
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const resizeCursors: Record<ResizeEdge, string> = {n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize',ne:'nesw-resize',sw:'nesw-resize',nw:'nwse-resize',se:'nwse-resize'};

export function desktopResizeEdge(x: number, y: number, width: number, height: number): ResizeEdge | '' {
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || x >= width || y >= height) return '';
  const horizontal = x < desktopResizeBorder ? 'w' : x >= width - desktopResizeBorder ? 'e' : '';
  const vertical = y < desktopResizeBorder ? 'n' : y >= height - desktopResizeBorder ? 's' : '';
  if (!horizontal && !vertical) return '';
  // Corners extend along the edge without covering an 18px square of content.
  const cornerX = x < desktopResizeCorner ? 'w' : x >= width - desktopResizeCorner ? 'e' : '';
  const cornerY = y < desktopResizeCorner ? 'n' : y >= height - desktopResizeCorner ? 's' : '';
  return ((vertical && cornerX) ? vertical + cornerX : (horizontal && cornerY) ? cornerY + horizontal : vertical || horizontal) as ResizeEdge;
}

// External localhost pages receive Wails Core but not its drag.ts listeners.
// Keep the native gesture protocol, with CSS cursor feedback for the same hit
// region. No overlay is needed, so dialogs and scrollbars keep their layout.
export function installDesktopWindowGestures(target: Window, invoke: (message: string) => void, isResizable: () => boolean, maximize: () => void) {
  const root = target.document.documentElement;
  let origin: {x: number; y: number; edge: ResizeEdge | ''} | null = null;
  let hovered: ResizeEdge | '' = '';
  let suppressClick = false;
  const edge = (event: MouseEvent) => isResizable() && !target.document.fullscreenElement ? desktopResizeEdge(event.clientX,event.clientY,target.innerWidth,target.innerHeight) : '';
  function cursor(next: ResizeEdge | '') {
    if (hovered === next) return;
    hovered = next;
    if (next) {root.dataset.desktopResizeEdge = next; root.style.setProperty('--desktop-resize-cursor',resizeCursors[next]);}
    else {delete root.dataset.desktopResizeEdge; root.style.removeProperty('--desktop-resize-cursor');}
  }
  const draggable = (event: MouseEvent) => {
    const element = event.target as Element | null;
    return element?.nodeType === 1 && target.getComputedStyle(element).getPropertyValue('--wails-draggable').trim() === 'drag';
  };
  const down = (event: MouseEvent) => {
    origin = null; suppressClick = false;
    if (event.button !== 0) return;
    const border = edge(event); cursor(border);
    if (border || draggable(event)) origin = {x:event.clientX,y:event.clientY,edge:border};
    if (border) {suppressClick = true; event.preventDefault(); event.stopPropagation();}
  };
  const move = (event: MouseEvent) => {
    if (!(event.buttons & 1)) origin = null;
    if (origin && event.buttons & 1) {
      const start = origin;
      if (!start.edge && Math.abs(event.clientX-start.x)+Math.abs(event.clientY-start.y)<3) return;
      origin = null;
      if (start.edge) {
        if (!isResizable() || target.document.fullscreenElement) {cursor(''); return;}
        event.preventDefault(); event.stopPropagation();
        invoke(`wails:resize:${start.edge}-resize`);
      } else invoke('wails:drag');
      return;
    }
    cursor(edge(event));
  };
  const up = () => {origin = null;};
  const reset = () => {origin = null; suppressClick = false; cursor('');};
  const leave = (event: MouseEvent) => {if (!event.relatedTarget) reset();};
  const click = (event: MouseEvent) => {if (suppressClick) {suppressClick = false;event.preventDefault();event.stopImmediatePropagation();}};
  const double = (event: MouseEvent) => {if (!edge(event) && draggable(event)) maximize();};
  target.addEventListener('mousedown',down,true);target.addEventListener('mousemove',move,true);target.addEventListener('mouseup',up,true);
  target.addEventListener('click',click,true);target.addEventListener('dblclick',double,true);target.addEventListener('mouseout',leave,true);
  target.addEventListener('blur',reset);target.addEventListener('resize',reset);target.document.addEventListener('fullscreenchange',reset);
  return () => {
    target.removeEventListener('mousedown',down,true);target.removeEventListener('mousemove',move,true);target.removeEventListener('mouseup',up,true);
    target.removeEventListener('click',click,true);target.removeEventListener('dblclick',double,true);target.removeEventListener('mouseout',leave,true);
    target.removeEventListener('blur',reset);target.removeEventListener('resize',reset);target.document.removeEventListener('fullscreenchange',reset);reset();
  };
}
