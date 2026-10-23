import {EditorState} from '@codemirror/state';
import type {EditorView,Panel,ViewUpdate} from '@codemirror/view';
import {SearchQuery,closeSearchPanel,findNext,findPrevious,getSearchQuery,replaceAll,replaceNext,search,selectMatches,setSearchQuery} from '@codemirror/search';

function element<K extends keyof HTMLElementTagNameMap>(tag:K,className:string){const node=document.createElement(tag);node.className=className;return node}
function button(text:string,label:string,action:()=>void,className=''){
  const node=element('button',`editor-find-button ${className}`);
  node.type='button';node.textContent=text;node.title=label;node.setAttribute('aria-label',label);node.addEventListener('click',action);return node;
}

class FileSearchPanel implements Panel{
  dom=element('form','editor-find-panel');
  top=true;
  private field=element('input','editor-find-input');
  private replacement=element('input','editor-find-input');
  private count=element('span','editor-find-count');
  private options=element('div','editor-find-options');
  private replaceRow=element('div','editor-find-replace');
  private previous:HTMLButtonElement;
  private next:HTMLButtonElement;
  private selectAll:HTMLButtonElement;
  private replaceOne:HTMLButtonElement;
  private replaceEvery:HTMLButtonElement;
  private replaceToggle:HTMLButtonElement;
  private cases:HTMLButtonElement;
  private words:HTMLButtonElement;
  private regex:HTMLButtonElement;
  private query:SearchQuery;
  private matches:{from:number;to:number}[]=[];
  private capped=false;
  private timer:ReturnType<typeof setTimeout>|undefined;

  constructor(private view:EditorView){
    this.query=getSearchQuery(view.state);
    this.dom.setAttribute('role','search');this.dom.setAttribute('aria-label','Find in file');
    this.field.type='text';this.field.name='search';this.field.placeholder='Find in file…';this.field.setAttribute('aria-label','Find in file');this.field.setAttribute('main-field','true');this.field.autocomplete='off';this.field.spellcheck=false;
    this.replacement.type='text';this.replacement.name='replace';this.replacement.placeholder='Replace with…';this.replacement.setAttribute('aria-label','Replace with');this.replacement.autocomplete='off';this.replacement.spellcheck=false;
    this.count.setAttribute('role','status');this.count.setAttribute('aria-live','polite');this.count.setAttribute('aria-atomic','true');
    const main=element('div','editor-find-main'),inputGroup=element('div','editor-find-field'),actions=element('div','editor-find-actions');
    inputGroup.append(this.field,this.count);
    this.previous=button('↑','Previous match · Shift+Enter',()=>findPrevious(view),'editor-find-icon');
    this.next=button('↓','Next match · Enter',()=>findNext(view),'editor-find-icon');
    this.replaceToggle=button('Replace','Show replace controls',()=>{
      const expanded=this.replaceRow.hidden;this.replaceRow.hidden=!expanded;this.replaceToggle.setAttribute('aria-expanded',String(expanded));
      if(expanded)this.replacement.focus();
    });this.replaceToggle.setAttribute('aria-expanded','false');
    const optionsToggle=button('Options','Search options',()=>{this.options.hidden=!this.options.hidden;optionsToggle.setAttribute('aria-expanded',String(!this.options.hidden))});optionsToggle.setAttribute('aria-expanded','false');
    const close=button('×','Close find · Escape',()=>this.close(),'editor-find-icon editor-find-close');
    actions.append(this.previous,this.next,this.replaceToggle,optionsToggle,close);main.append(inputGroup,actions);
    const toggle=(text:string,label:string)=>{
      const control=button(text,label,()=>{control.setAttribute('aria-pressed',String(control.getAttribute('aria-pressed')!=='true'));this.commit()},'editor-find-toggle');control.setAttribute('aria-pressed','false');return control;
    };
    this.cases=toggle('Match case','Match case');this.words=toggle('Whole word','Whole word');this.regex=toggle('Regex','Use regular expression');
    this.selectAll=button('Select all matches','Select all matches',()=>{selectMatches(view);view.focus()});
    this.options.append(this.cases,this.words,this.regex,this.selectAll);this.options.hidden=true;
    this.replaceOne=button('Replace next','Replace next match',()=>replaceNext(view));
    this.replaceEvery=button('Replace all','Replace all matches',()=>replaceAll(view));
    this.replaceRow.append(this.replacement,this.replaceOne,this.replaceEvery);this.replaceRow.hidden=true;
    this.dom.append(main,this.options,this.replaceRow);
    this.field.addEventListener('input',()=>this.commit());this.replacement.addEventListener('input',()=>this.commit());
    this.dom.addEventListener('submit',event=>{event.preventDefault();findNext(view)});
    this.dom.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close()}
      if(event.key==='Enter'&&(event.target===this.field||event.target===this.replacement)){
        event.preventDefault();event.stopPropagation();
        if(event.target===this.replacement)replaceNext(view);else (event.shiftKey?findPrevious:findNext)(view);
      }
    });
    this.sync();this.scheduleCount();
  }
  mount(){this.field.focus();this.field.select()}
  update(update:ViewUpdate){
    const query=getSearchQuery(update.state);
    if(!query.eq(this.query)||update.docChanged){this.query=query;this.sync();this.scheduleCount()}
    else this.showCount();
    this.updateAccess();
  }
  destroy(){clearTimeout(this.timer)}
  private close(){closeSearchPanel(this.view);this.view.focus()}
  private commit(){
    const query=new SearchQuery({search:this.field.value,replace:this.replacement.value,caseSensitive:this.cases.getAttribute('aria-pressed')==='true',wholeWord:this.words.getAttribute('aria-pressed')==='true',regexp:this.regex.getAttribute('aria-pressed')==='true',literal:true});
    if(!query.eq(this.query))this.view.dispatch({effects:setSearchQuery.of(query)});
  }
  private sync(){
    if(this.field.value!==this.query.search)this.field.value=this.query.search;
    if(this.replacement.value!==this.query.replace)this.replacement.value=this.query.replace;
    this.cases.setAttribute('aria-pressed',String(this.query.caseSensitive));this.words.setAttribute('aria-pressed',String(this.query.wholeWord));this.regex.setAttribute('aria-pressed',String(this.query.regexp));
    this.field.setAttribute('aria-invalid',String(!!this.query.search&&!this.query.valid));
    this.updateAccess();
  }
  private updateAccess(){
    const readOnly=this.view.state.facet(EditorState.readOnly);
    this.replaceToggle.hidden=readOnly;
    if(readOnly)this.replaceRow.hidden=true;
    this.replacement.disabled=readOnly;
    const disabled=!this.query.valid||!this.query.search||!this.matches.length;
    this.previous.disabled=disabled;this.next.disabled=disabled;this.selectAll.disabled=disabled;
    this.replaceOne.disabled=disabled||readOnly;this.replaceEvery.disabled=disabled||readOnly;
  }
  private scheduleCount(){
    clearTimeout(this.timer);this.matches=[];this.capped=false;
    this.showCount();this.updateAccess();
    if(!this.query.search||!this.query.valid)return;
    this.count.textContent='Searching…';
    this.timer=setTimeout(()=>{
      const cursor=this.query.getCursor(this.view.state);
      for(let found=cursor.next();!found.done;found=cursor.next()){
        if(this.matches.length===10000){this.capped=true;break}
        this.matches.push({from:found.value.from,to:found.value.to});
      }
      this.showCount();this.updateAccess();
    },100);
  }
  private showCount(){
    if(!this.query.search){this.count.textContent='';return}
    if(!this.query.valid){this.count.textContent='Invalid regex';return}
    const selection=this.view.state.selection.main;
    const current=this.matches.findIndex(match=>match.from===selection.from&&match.to===selection.to);
    const total=this.matches.length.toLocaleString()+(this.capped?'+':'');
    this.count.textContent=current>=0?`${(current+1).toLocaleString()} of ${total}`:this.matches.length?`${total} ${this.matches.length===1?'match':'matches'}`:'No matches';
  }
}

export const fileSearch=search({top:true,literal:true,createPanel:view=>new FileSearchPanel(view)});
