// The real template setup form and Steam maintenance panel, rendered without a
// browser (see domFreeReact.mjs). Models and validators are the real modules;
// network, routing and layout primitives are fixtures that record what happens.
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createRenderer} from './domFreeReact.mjs';

const fixture = '__privateSteamFixture';
const current = `globalThis.${fixture}`;
const stubs = {
  react: `const r=()=>${current}.renderer.React;
    export const useState=(...a)=>r().useState(...a),useEffect=(...a)=>r().useEffect(...a),useRef=(...a)=>r().useRef(...a),
      useMemo=(...a)=>r().useMemo(...a),useCallback=(...a)=>r().useCallback(...a),useId=()=>r().useId();
    export default {};`,
  'react/jsx-runtime': `const r=()=>${current}.renderer.jsxRuntime;
    export const jsx=(...a)=>r().jsx(...a),jsxs=(...a)=>r().jsx(...a);
    export const Fragment=Symbol.for('dom-free.fragment');`,
  'react-router-dom': `export const useNavigate=()=>path=>${current}.navigations.push(path),useParams=()=>({}),Link='a';`,
  lib: `import {jsx} from 'react/jsx-runtime';
    export const api=(path,options={})=>${current}.api(path,options);
    export const unwrap=value=>value?.attributes??value,rows=value=>(value?.data??[]).map(unwrap);
    export const Button=({children,variant,...props})=>jsx('button',{type:'button',...props,children});
    export const Card=({children,className})=>jsx('section',{className,children});
    export const Input=props=>jsx('input',props),Select=props=>jsx('select',props);
    export const ErrorBox=({children})=>children?jsx('div',{role:'alert',children}):null;
    export const Field=({label,children})=>jsx('label',{children:[label,children]});`,
  notifications: `import {jsx} from 'react/jsx-runtime';export const Feedback=({message,id})=>jsx('p',{id,role:'status',children:message});`,
  disclosure: `import {jsx} from 'react/jsx-runtime';export const Disclosure=({children})=>jsx('details',{children}),DisclosureTrigger=({children})=>jsx('summary',{children});`,
  heading: `export const PageHeading=({children})=>children;`,
  gameSwitch: `import {jsx} from 'react/jsx-runtime';export const GameSwitch=({checked,onCheckedChange})=>jsx('button',{type:'button',role:'switch','aria-checked':checked,onCheckedChange});`,
  setupFields: `import {jsx} from 'react/jsx-runtime';
    export const GameNameField=({value,onChange})=>jsx('input',{id:'game-server-name',value,onChange:e=>onChange(e.target.value)});
    export const GameNodeField=({value,onChange})=>jsx('select',{id:'game-server-node',value,onChange:e=>onChange(e.target.value)});
    export const GameMemoryField=({value,onChange})=>jsx('input',{id:'game-server-memory',value,onChange:e=>onChange(e.target.value)});
    export const GameAgreementField=()=>null;`,
  ports: `export const GamePorts=()=>null,rememberInstallationPorts=()=>{};
    export const useGamePortPlan=(_path,node,environment,enabled)=>{${current}.ports.push({node,environment,enabled});return {data:{ports:[]},loading:false,error:'',reload(){}}};`,
  common: `export const json=(method,body)=>({method,body:JSON.stringify(body)}),can=()=>true,date=value=>String(value),useServer=()=>${current}.server;`,
  gameRequest: `export const useGameRequest=path=>${current}.request(path);`,
  dashboard: `export const useServerTelemetry=()=>({state:'offline',updated:1,error:''});`,
  empty: `export const SteamSetupForm=()=>null,GameLibraryCard=()=>null,gameArtwork=()=>null,compareGamePopularity=()=>0,isMinecraftTemplate=()=>false,minecraftProjectKey=()=>'';export default {};`,
};
const routes = [
  [/^react$/, 'react'],
  [/^react\/jsx-runtime$/, 'react/jsx-runtime'],
  [/^react-router-dom$/, 'react-router-dom'],
  [/\/lib$/, 'lib'],
  [/\/notifications$/, 'notifications'],
  [/ui\/Disclosure$/, 'disclosure'],
  [/ui\/PageHeading$/, 'heading'],
  [/\/GameSwitch$/, 'gameSwitch'],
  [/\/GameSetupFields$/, 'setupFields'],
  [/\/GamePorts$/, 'ports'],
  [/^\.\.\/shared\/common$/, 'common'],
  [/\/useGameRequest$/, 'gameRequest'],
  [/\/ServerDashboard$/, 'dashboard'],
  [
    /\/(SteamGames|GameLibraryCard|gameLibraryOrder|minecraftCommunityModel)$|minecraftCommunityArtwork\.json$/,
    'empty',
  ],
];
const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({
  stdin: {
    contents:
      "export {TemplateSetupForm} from './src/features/game-library/TemplateGames'; export {default as PrivateSteamMaintenance} from './src/features/game-library/PrivateSteamMaintenance';",
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  loader: {'.css': 'empty'},
  logLevel: 'silent',
  plugins: [
    {
      name: 'private-steam-fixtures',
      setup(builder) {
        builder.onResolve({filter: /.*/}, args => {
          if (args.namespace === 'fixture') return {path: args.path, namespace: 'fixture'};
          const hit = routes.find(([pattern]) => pattern.test(args.path));
          return hit ? {path: hit[1], namespace: 'fixture'} : undefined;
        });
        builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: stubs[args.path], loader: 'js'}));
      },
    },
  ],
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

export function steamVariable(env_variable, default_value, extra = {}) {
  return {
    name: env_variable,
    env_variable,
    default_value,
    rules: 'nullable|string|max:64',
    user_viewable: true,
    ...extra,
  };
}
// A template whose private Steam install is supported, with a trusted node unless told otherwise.
export function privateReady(variables, trusted = true) {
  return {
    id: 'fixture',
    name: 'Private fixture',
    description: 'fixture',
    detail: '',
    verification: 'not_verified',
    source: 'https://example.invalid',
    available: true,
    variables,
    private_content_supported: true,
    steam_installation: {
      default_mode: 'private',
      private_candidate: true,
      private_supported: true,
      controls: {},
      coverage: 'reviewed',
    },
    nodes: [
      {
        id: 1,
        name: 'Fixture node',
        available_memory: 65536,
        available_disk: 131072,
        setup_available: true,
        private_content_ready: trusted,
        allocations: [],
      },
    ],
    images: [{label: 'fixture', value: 'fixture:image'}],
    defaults: {memory: 4096, disk: 8192},
  };
}
export function templateForm() {
  const f = {
    renderer: createRenderer(),
    requests: [],
    ports: [],
    navigations: [],
    async api(path, options) {
      f.requests.push({path, method: options.method, body: JSON.parse(options.body)});
      return {attributes: {identifier: 'created'}};
    },
    mount(options) {
      globalThis[fixture] = f;
      return f.renderer.mount(ui.TemplateSetupForm, {options});
    },
    disabled: view => view.find(n => n.type === 'button' && n.props.type === 'submit').props.disabled,
  };
  return f;
}
export function maintenanceForm() {
  const f = {
    renderer: createRenderer(),
    requests: [],
    fail: false,
    server: {base: '/api/client/servers/s', permissions: ['*'], server: {status: null}},
    request(path) {
      const data = path?.endsWith('/authorizations')
        ? {data: [{attributes: {id: 'auth-1', saved_password: false, revoked: false, created_at: '2026-11-01'}}]}
        : path?.endsWith('/jobs')
          ? {data: []}
          : null;
      return {data, error: '', loading: false, reload() {}};
    },
    async api(path, options) {
      f.requests.push({path, method: options.method, body: options.body ? JSON.parse(options.body) : undefined});
      if (f.fail) throw new Error('Steam rejected the job.');
      return {attributes: {id: 'auth-1'}};
    },
    mount(controls) {
      globalThis[fixture] = f;
      return f.renderer.mount(ui.PrivateSteamMaintenance, {
        status: {
          supported: true,
          ready: true,
          reason: '',
          app_id: 1,
          branch: 'public',
          private_content: true,
          original_controls: controls,
        },
        unavailable: false,
        reload() {},
      });
    },
  };
  return f;
}
