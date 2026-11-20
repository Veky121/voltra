// A DOM-free React stand-in for component tests: real component code, a small
// hook runtime, and a plain object tree that tests can query and drive (type,
// click, submit) without a browser. Effects run after each render pass.
//
//   const r = createRenderer();
//   load(compiled, {react: r.React, 'react/jsx-runtime': r.jsxRuntime, ...});
//   const view = r.mount(Component, props);
//   view.change(view.find(n => n.props.id === 'name'), 'New name');
//   await view.submit(view.find(n => n.type === 'form'));

const Fragment = Symbol.for('dom-free.fragment');

export function createRenderer() {
  const instances = new Map();
  let current = null,
    dirty = false,
    effects = [],
    nextId = 0,
    rendering = false;
  const contexts = new Map();
  function slot() {
    if (!current) throw new Error('Hooks can only be called while a component renders.');
    return current.index++;
  }
  const React = {
    Fragment,
    useState(initial) {
      const inst = current,
        i = slot();
      if (!(i in inst.hooks)) {
        const hook = {value: typeof initial === 'function' ? initial() : initial};
        hook.set = value => {
          const next = typeof value === 'function' ? value(hook.value) : value;
          if (!Object.is(next, hook.value)) {
            hook.value = next;
            dirty = true;
          }
        };
        inst.hooks[i] = hook;
      }
      return [inst.hooks[i].value, inst.hooks[i].set];
    },
    useReducer(reducer, initial, init) {
      const [state, setState] = React.useState(() => (init ? init(initial) : initial));
      return [state, action => setState(previous => reducer(previous, action))];
    },
    useRef(initial) {
      const inst = current,
        i = slot();
      return (inst.hooks[i] ??= {current: initial});
    },
    useMemo(factory, deps) {
      const inst = current,
        i = slot(),
        old = inst.hooks[i];
      if (old && deps && deps.every((value, j) => Object.is(value, old.deps[j]))) return old.value;
      inst.hooks[i] = {deps, value: factory()};
      return inst.hooks[i].value;
    },
    useCallback(callback, deps) {
      return React.useMemo(() => callback, deps);
    },
    useEffect(effect, deps) {
      const inst = current,
        i = slot(),
        old = inst.hooks[i];
      if (old && deps && deps.every((value, j) => Object.is(value, old.deps[j]))) return;
      const hook = {deps, cleanup: old?.cleanup};
      inst.hooks[i] = hook;
      effects.push(() => {
        hook.cleanup?.();
        hook.cleanup = effect();
      });
    },
    useLayoutEffect(effect, deps) {
      return React.useEffect(effect, deps);
    },
    useId() {
      const inst = current,
        i = slot();
      return (inst.hooks[i] ??= `dom-free-${++nextId}`);
    },
    createContext(value) {
      const context = {defaultValue: value};
      context.Provider = ({value: provided, children}) => ({
        type: Fragment,
        props: {children},
        provide: [context, provided],
      });
      return context;
    },
    useContext(context) {
      return contexts.has(context) ? contexts.get(context) : context.defaultValue;
    },
    memo: component => component,
    forwardRef: render => Object.assign(props => render(props, props.ref), {displayName: render.name}),
    createElement(type, props, ...children) {
      const all = {...(props || {})};
      if (children.length) all.children = children.length === 1 ? children[0] : children;
      return {type, props: all, key: all.key ?? null};
    },
    isValidElement: value => !!value && typeof value === 'object' && 'type' in value && 'props' in value,
    Children: {
      toArray: children => [children].flat(Infinity).filter(child => child != null && typeof child !== 'boolean'),
    },
  };
  const jsx = (type, props, key) => ({type, props: props || {}, key: key ?? null});
  const jsxRuntime = {jsx, jsxs: jsx, Fragment};

  function visit(node, path) {
    if (node == null || typeof node === 'boolean') return null;
    if (Array.isArray(node))
      return node.map((child, index) => visit(child, `${path}.${child?.key ?? index}`)).filter(child => child !== null);
    if (typeof node !== 'object') return String(node);
    if (node.provide) {
      const [context, value] = node.provide,
        had = contexts.has(context),
        previous = contexts.get(context);
      contexts.set(context, value);
      try {
        return visit(node.props.children, path);
      } finally {
        had ? contexts.set(context, previous) : contexts.delete(context);
      }
    }
    if (node.type === Fragment) return visit(node.props.children, path);
    if (typeof node.type === 'function') {
      const id = `${path}/${node.type.displayName || node.type.name || 'Anonymous'}`;
      const inst = instances.get(id) ?? {hooks: []};
      instances.set(id, inst);
      inst.seen = true;
      const parent = current;
      current = inst;
      inst.index = 0;
      let output;
      try {
        output = node.type(node.props);
      } finally {
        current = parent;
      }
      return visit(output, id);
    }
    const {children, ...props} = node.props;
    return {
      type: node.type,
      props,
      children: [visit(children, `${path}/${node.type}`)].flat(Infinity).filter(child => child !== null),
    };
  }

  function mount(Component, props = {}) {
    let tree = null,
      element = {type: Component, props};
    function renderOnce() {
      for (const inst of instances.values()) inst.seen = false;
      rendering = true;
      try {
        tree = visit(element, 'root');
      } finally {
        rendering = false;
      }
      for (const [id, inst] of instances)
        if (!inst.seen) {
          for (const hook of inst.hooks) hook?.cleanup?.();
          instances.delete(id);
        }
    }
    function flush() {
      for (let pass = 0; pass < 50; pass++) {
        dirty = false;
        renderOnce();
        const pending = effects;
        effects = [];
        for (const run of pending) run();
        if (!dirty && !effects.length) return;
      }
      throw new Error('The component kept updating after 50 render passes.');
    }
    flush();
    const all = (node = tree, out = []) => {
      if (!node || typeof node !== 'object') return out;
      if (Array.isArray(node)) {
        for (const child of node) all(child, out);
        return out;
      }
      out.push(node);
      for (const child of node.children) all(child, out);
      return out;
    };
    const text = (node = tree) =>
      typeof node === 'string'
        ? node
        : Array.isArray(node)
          ? node.map(text).join('')
          : node
            ? node.children.map(text).join('')
            : '';
    const settle = async () => {
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setImmediate(resolve));
        flush();
      }
    };
    const view = {
      get tree() {
        return tree;
      },
      rerender(nextProps) {
        element = {type: Component, props: nextProps ?? element.props};
        flush();
      },
      findAll: predicate => all().filter(predicate),
      find(predicate) {
        const found = all().filter(predicate);
        if (found.length !== 1) throw new Error(`Expected one matching element, found ${found.length}.`);
        return found[0];
      },
      text,
      settle,
      // Event handlers receive a minimal event; state changes re-render before returning.
      change(node, value, extra = {}) {
        const target = {value, checked: value, ...extra};
        node.props.onChange?.({target, currentTarget: target, preventDefault() {}});
        node.props.onCheckedChange?.(value);
        node.props.onValueChange?.(value);
        flush();
      },
      async click(node) {
        await node.props.onClick?.({preventDefault() {}, stopPropagation() {}, currentTarget: node, target: node});
        await settle();
      },
      async submit(form) {
        await form.props.onSubmit?.({preventDefault() {}, currentTarget: form, target: form});
        await settle();
      },
      unmount() {
        for (const inst of instances.values()) for (const hook of inst.hooks) hook?.cleanup?.();
        instances.clear();
      },
    };
    return view;
  }
  return {React, jsxRuntime, mount, isRendering: () => rendering};
}
