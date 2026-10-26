import {buttonVariants} from '../../src/components/ui/button';
import {defaultTheme,themeVariables} from '../../src/themePreferences';
import '../../src/client/fileWorkspace.css';
import '../../src/client/fileTransfers.css';
import '../../src/admin/management-ui.css';

// CSS-context checks only. No API writes, uploads or real account changes.
export async function runSolidButtonSuite(){
  const root=document.documentElement,previous=root.getAttribute('style');
  const fixture=document.createElement('div');
  fixture.innerHTML='<button class="button">Shared action</button><div class="management-ui"><button>Admin action</button></div><div class="file-draft-bar"><button class="draft-save">Save file</button></div><div class="file-transfers"><div data-uppy-theme="dark"><div class="uppy-StatusBar is-waiting"><button class="uppy-StatusBar-actionBtn--upload">Upload</button></div></div></div><span class="appearance-preview-button">Preview</span>';
  const installed=document.createElement('button');installed.dataset.slot='button';installed.className=buttonVariants();installed.textContent='Shadcn action';fixture.append(installed);
  document.body.append(fixture);
  const rgb=(hex:string)=>`rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`;
  const results=[];
  try{
    for(const first of ['#7957d5','#fedc00','#ffffff','#000000']){
      const variables=themeVariables({...defaultTheme,accentA:first,accentB:first==='#7957d5'?'#00cc99':'#250077',accentGradient:true});
      for(const [name,value]of Object.entries(variables))root.style.setProperty(name,value);
      await new Promise(r=>setTimeout(r,230));
      for(const element of [...fixture.querySelectorAll('button'),fixture.querySelector('.appearance-preview-button')!]){
        const style=getComputedStyle(element);
        if(style.backgroundImage!=='none'||style.backgroundColor!==rgb(first)||style.color!==rgb(variables['--theme-button-ink']))throw new Error(`Solid button mismatch: ${element.textContent}, ${first}, ${style.backgroundColor}, ${style.color}, ${style.backgroundImage}`);
      }
      if(!variables['--theme-background'].startsWith('linear-gradient('))throw new Error('Background theme must retain its gradient');
      results.push({first,controls:fixture.querySelectorAll('button').length+1,gradientButtons:0});
    }
    return results;
  }finally{
    fixture.remove();if(previous===null)root.removeAttribute('style');else root.setAttribute('style',previous);
  }
}
