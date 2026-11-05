import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useState,type ReactNode} from 'react';
import {defaultTheme,parseTheme,themeKey,themeVariables,type ThemePreferences} from './themePreferences';

type ThemeContextValue={saved:ThemePreferences;preview:(theme:ThemePreferences|null)=>void;save:(theme:ThemePreferences)=>Promise<void>;ready:boolean;error:string;reload:()=>void;desktop:boolean};
const ThemeContext=createContext<ThemeContextValue|null>(null);
export function useTheme(){const context=useContext(ThemeContext);if(!context)throw new Error('Theme provider is missing.');return context}
async function desktopTheme(account:string,theme?:ThemePreferences){
 const response=await fetch('/desktop/theme',{method:theme?'POST':'GET',cache:'no-store',headers:{'Content-Type':'application/json','X-Voltra-Account':account},...(theme?{body:JSON.stringify(theme)}:{})});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not access local theme settings.');
 if(data.theme!==null&&!parseTheme(data.theme))throw new Error('Saved theme settings are invalid.');
 return parseTheme(data.theme)||defaultTheme;
}
export function ThemeProvider({account,children}:{account:string;children:ReactNode}){
 const desktop=import.meta.env.VITE_DESKTOP==='true';
 const key=themeKey(window.location.origin,account);
 const [saved,setSaved]=useState<ThemePreferences>(defaultTheme),[draft,setDraft]=useState<ThemePreferences|null>(null),[ready,setReady]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const reload=useCallback(()=>setRevision(v=>v+1),[]);
 const preview=useCallback((theme:ThemePreferences|null)=>setDraft(theme),[]);
 useEffect(()=>{
  let active=true;setReady(false);setError('');
  async function load(){try{let theme=defaultTheme;if(desktop)theme=await desktopTheme(account);else{const raw=localStorage.getItem(key);if(raw!==null){const parsed=parseTheme(JSON.parse(raw));if(!parsed)throw new Error('Saved theme settings are invalid. Reset them to continue.');theme=parsed}}
   if(active){setSaved(theme);setReady(true)}
  }catch(e){if(active){setError(e instanceof Error?e.message:String(e));setReady(true)}}}
  void load();
  const changed=(event:StorageEvent)=>{if(event.key===key||event.key===null)reload()};
  if(!desktop)window.addEventListener('storage',changed);
  return()=>{active=false;window.removeEventListener('storage',changed)};
 },[account,key,desktop,revision,reload]);
 const variables=useMemo(()=>themeVariables(draft||saved),[draft,saved]);
 useLayoutEffect(()=>{const root=document.documentElement;root.dataset.voltraTheme='soft';for(const [name,value] of Object.entries(variables))root.style.setProperty(name,value);return()=>{delete root.dataset.voltraTheme;for(const name of Object.keys(variables))root.style.removeProperty(name)}},[variables]);
 async function save(theme:ThemePreferences){
  const valid=parseTheme(theme);if(!valid)throw new Error('Choose valid theme colors.');
  if(!ready)throw new Error('Theme settings are still loading.');
  try{if(desktop)await desktopTheme(account,valid);else localStorage.setItem(key,JSON.stringify(valid));setSaved(valid);setDraft(null);setError('')}catch(e){const message=e instanceof Error?e.message:String(e);setError(message);throw new Error(message)}
 }
 return <ThemeContext.Provider value={{saved,preview,save,ready,error,reload,desktop}}>{children}</ThemeContext.Provider>;
}
