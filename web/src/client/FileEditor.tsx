import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {basicSetup} from 'codemirror';
import {Compartment,EditorState,Prec} from '@codemirror/state';
import {EditorView,keymap} from '@codemirror/view';
import {HighlightStyle,syntaxHighlighting} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import {openSearchPanel} from '@codemirror/search';
import {detectLanguage,editorLanguages} from './editorLanguages';
import {fileSearch} from './editorSearch';
import {Icon} from '../Icons';
import './fileEditor.css';

const colors=HighlightStyle.define([
  {tag:tags.comment,color:'var(--muted)',fontStyle:'italic'},
  {tag:[tags.keyword,tags.modifier,tags.operatorKeyword],color:'#c7a3f4'},
  {tag:[tags.string,tags.special(tags.string)],color:'#a6d59a'},
  {tag:[tags.number,tags.bool,tags.null,tags.atom],color:'#e8b47d'},
  {tag:[tags.propertyName,tags.attributeName,tags.definition(tags.variableName)],color:'#8fc6ff'},
  {tag:[tags.typeName,tags.className,tags.namespace,tags.tagName],color:'#e8cd8a'},
  {tag:[tags.function(tags.variableName),tags.function(tags.propertyName)],color:'#8bd5ca'},
  {tag:[tags.operator,tags.punctuation,tags.bracket],color:'#b5bed0'},
  {tag:tags.heading,color:'var(--accent)',fontWeight:'bold'},
  {tag:tags.link,color:'var(--accent)',textDecoration:'underline'},
]);
const theme=EditorView.theme({
  '&':{backgroundColor:'var(--ui-input)',color:'var(--text)',fontSize:'calc(13px * var(--ui-font-scale,1))'},
  '&.cm-focused':{outline:'none'},
  '.cm-content':{fontFamily:"'IBM Plex Mono',monospace",padding:'14px 0',caretColor:'var(--accent)'},
  '.cm-line':{padding:'0 18px'},
  '.cm-scroller':{fontFamily:"'IBM Plex Mono',monospace",lineHeight:'1.7',overflow:'auto'},
  '.cm-gutters':{backgroundColor:'var(--ui-input)',color:'var(--muted)',borderRight:'1px solid var(--ui-divider)'},
  '.cm-activeLineGutter':{backgroundColor:'var(--ui-hover)',color:'var(--text)'},
  '.cm-activeLine':{backgroundColor:'var(--ui-hover)'},
  '.cm-cursor':{borderLeftColor:'var(--accent)'},
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,::selection':{backgroundColor:'color-mix(in srgb,var(--accent) 24%,transparent)'},
  '.cm-matchingBracket':{backgroundColor:'color-mix(in srgb,var(--accent) 14%,transparent)',outline:'1px solid var(--accent)'},
  '.cm-panels':{backgroundColor:'var(--ui-surface)',color:'var(--text)'},
  '.cm-searchMatch':{backgroundColor:'#82633166',outline:'1px solid #ad884e'},
  '.cm-searchMatch.cm-searchMatch-selected':{backgroundColor:'#a37e3755'},
  '.cm-tooltip':{backgroundColor:'var(--ui-surface)',border:'1px solid var(--ui-border)',color:'var(--text)'},
},{dark:true});

type Props={path:string;storageKey:string;content:string;dirty:boolean;readOnly:boolean;onChange:(text:string)=>void;onSave:()=>void};
export default function FileEditor({path,storageKey,content,readOnly,onChange,onSave}:Props){
  const preferenceKey=`voltra:file-language:${storageKey}:${path}`;
  const [selection,setSelection]=useState(()=>{
    try{const saved=localStorage.getItem(preferenceKey);return saved==='Plain text'||editorLanguages.some(l=>l.name===saved)?saved!:'auto'}catch{return 'auto'}
  });
  const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[languageError,setLanguageError]=useState(''),[loadingLanguage,setLoadingLanguage]=useState(false);
  const [menuHeight,setMenuHeight]=useState(300);
  const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),picker=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),searchInput=useRef<HTMLInputElement>(null);
  const callbacks=useRef({onChange,onSave});callbacks.current={onChange,onSave};
  const language=useRef(new Compartment()),access=useRef(new Compartment());
  const detected=useMemo(()=>detectLanguage(path,content),[path,content]);
  const languageName=selection==='auto'?detected.name:selection;
  const languageDescription=editorLanguages.find(l=>l.name===languageName);
  const options=[{name:'auto',label:`Auto-detect · ${detected.name}`,detail:'Use file name and contents'},{name:'Plain text',label:'Plain text',detail:'No syntax highlighting'},...editorLanguages.map(l=>({name:l.name,label:l.name,detail:l.extensions.map(ext=>'.'+ext).join(' ')}))].filter(option=>`${option.label} ${option.detail} ${editorLanguages.find(l=>l.name===option.name)?.alias.join(' ')||''}`.toLowerCase().includes(search.toLowerCase().trim()));

  useEffect(()=>{
    if(!host.current)return;
    const separator=content.includes('\r\n')?'\r\n':content.includes('\r')&&!content.includes('\n')?'\r':'\n';
    const editor=new EditorView({parent:host.current,state:EditorState.create({doc:content,extensions:[
      basicSetup,fileSearch,theme,syntaxHighlighting(colors),EditorState.lineSeparator.of(separator),
      language.current.of([]),access.current.of(EditorState.readOnly.of(readOnly)),
      EditorView.contentAttributes.of({'aria-label':`Edit ${path}`,spellcheck:'false',autocapitalize:'off'}),
      Prec.highest(keymap.of([{key:'Mod-s',run:()=>{callbacks.current.onSave();return true}}])),
      EditorView.updateListener.of(update=>{if(update.docChanged)callbacks.current.onChange(update.state.sliceDoc())}),
    ]})});
    view.current=editor;
    return()=>{view.current=null;editor.destroy()};
  },[]);
  useEffect(()=>{view.current?.dispatch({effects:access.current.reconfigure(EditorState.readOnly.of(readOnly))})},[readOnly]);
  useEffect(()=>{
    let cancelled=false;
    setLanguageError('');setLoadingLanguage(!!languageDescription);
    // Drop the previous parser immediately so a failed load cannot leave misleading highlighting.
    view.current?.dispatch({effects:language.current.reconfigure([])});
    if(languageDescription)void languageDescription.load().then(support=>{
      if(!cancelled)view.current?.dispatch({effects:language.current.reconfigure(support)});
    }).catch(()=>{if(!cancelled)setLanguageError(`Could not load ${languageName} highlighting. Your text is still editable. Select another language or reopen the file to retry.`)}).finally(()=>{if(!cancelled)setLoadingLanguage(false)});
    return()=>{cancelled=true};
  },[languageName]);
  useEffect(()=>{
    if(!open)return;
    searchInput.current?.focus();
    const outside=(event:PointerEvent)=>{if(!picker.current?.contains(event.target as Node))setOpen(false)};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  useLayoutEffect(()=>{
    if(!open)return;
    const fit=()=>{
      const footer=picker.current?.closest('.file-editor-hints'),boundary=picker.current?.closest('.file-document-content,.file-editor-panel');
      if(footer)setMenuHeight(Math.max(160,Math.min(420,footer.getBoundingClientRect().top-Math.max(0,boundary?.getBoundingClientRect().top||0)-8)));
    };
    fit();window.addEventListener('resize',fit);return()=>window.removeEventListener('resize',fit);
  },[open]);
  function choose(name:string){
    setSelection(name);setOpen(false);setSearch('');trigger.current?.focus();
    try{if(name==='auto')localStorage.removeItem(preferenceKey);else localStorage.setItem(preferenceKey,name)}catch{/* Storage may be disabled; the current selection still works. */}
  }
  const languagePicker=<div ref={picker} className="editor-language-picker" onKeyDown={event=>{
        if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus()}
        if(open&&(event.key==='ArrowDown'||event.key==='ArrowUp')){
          event.preventDefault();const buttons=Array.from(picker.current?.querySelectorAll<HTMLButtonElement>('[role=option]')||[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[index===-1?(event.key==='ArrowDown'?0:buttons.length-1):(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
        }
        if(open&&event.key==='Enter'&&event.target===searchInput.current&&options.length){event.preventDefault();choose(options[0].name)}
      }}>
        <button ref={trigger} type="button" className="editor-language-trigger" aria-label={`Syntax: ${selection==='auto'?'Auto · ':''}${languageName}`} aria-haspopup="dialog" aria-expanded={open} title={selection==='auto'?detected.reason:'Manual language selection for this file'} onClick={()=>{setOpen(v=>!v);setSearch('')}}>
          <Icon name="file"/><span>{selection==='auto'&&<small>Auto · </small>}{languageName}</span><span aria-hidden="true">⌄</span>
        </button>
        {open&&<div className="editor-language-menu" style={{maxHeight:menuHeight}} role="dialog" aria-label="Choose syntax language">
          <div className="editor-language-search"><Icon name="search"/><input ref={searchInput} type="search" aria-label="Search syntax languages" placeholder={`Search ${editorLanguages.length} languages…`} value={search} onChange={event=>setSearch(event.target.value)}/></div>
          <div className="editor-language-options" role="listbox" aria-label="Syntax languages">
            {options.map(option=><button type="button" role="option" aria-selected={selection===option.name} key={option.name} onClick={()=>choose(option.name)}><span>{option.label}</span>{selection===option.name&&<span aria-hidden="true">✓</span>}<small>{option.detail||'Syntax highlighting'}</small></button>)}
            {!options.length&&<p>No matching languages.</p>}
          </div>
          <p className="editor-language-help">{selection==='auto'?detected.reason:'Manual selection saved for this file in this browser.'} Highlighting does not change the file format.</p>
        </div>}
      </div>;
  return <>
    {(loadingLanguage||languageError)&&<p className={`editor-language-notice${languageError?' is-error':''}`} role="status">{languageError||`Loading ${languageName} highlighting…`}</p>}
    <div ref={host} className="file-code-editor" data-language={languageName}/>
    <div className="file-editor-hints"><span>{readOnly?'Read only':<><kbd>Ctrl/Cmd + S</kbd> Save</>}</span><button type="button" onClick={()=>{if(view.current)openSearchPanel(view.current)}}><kbd>Ctrl/Cmd + F</kbd> Find</button>{languagePicker}</div>
  </>;
}
