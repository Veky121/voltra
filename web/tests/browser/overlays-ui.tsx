// UI-only regression fixture. It makes no panel or node requests.
import {StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Modal,Button,Select} from '../../src/lib';
import {MinecraftDialog} from '../../src/client/MinecraftDialog';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuSub,DropdownMenuSubTrigger,DropdownMenuSubContent} from '../../src/components/ui/dropdown-menu';
import {Tooltip,TooltipProvider,TooltipTrigger,TooltipContent} from '../../src/components/ui/tooltip';
import {Sheet,SheetContent,SheetTitle,SheetTrigger} from '../../src/components/ui/sheet';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/design-system.css';
import '../../src/shadcn.css';
import '../../src/shadcn-app.css';
import '../../src/ui/controls.css';

function Menu({label='Actions'}:{label?:string}){
 const [action,setAction]=useState('None');
 return <><DropdownMenu><DropdownMenuTrigger>{label}</DropdownMenuTrigger><DropdownMenuContent className="voltra-dropdown" aria-label={label}>
  <DropdownMenuItem onClick={()=>setAction('First')}>First action</DropdownMenuItem>
  <DropdownMenuSub><DropdownMenuSubTrigger>More actions</DropdownMenuSubTrigger><DropdownMenuSubContent className="voltra-dropdown"><DropdownMenuItem onClick={()=>setAction('Nested')}>Nested action</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub>
 </DropdownMenuContent></DropdownMenu><output>{action}</output></>;
}
function Controls(){
 const [choice,setChoice]=useState('one');
 return <><label className="field"><span>Dialog choice</span><Select aria-label="Dialog choice" value={choice} onChange={e=>setChoice(e.target.value)}><option value="one">First choice</option><option value="two">Second choice</option></Select></label>
 <Menu label="Dialog actions"/><Tooltip><TooltipTrigger>Dialog hint</TooltipTrigger><TooltipContent>Helpful dialog hint</TooltipContent></Tooltip></>;
}
function Fixture(){
 const [open,setOpen]=useState(false),[nested,setNested]=useState(false),[minecraft,setMinecraft]=useState(false);
 return <TooltipProvider delay={0}><main style={{padding:24}}>
  <h1>Overlay regression fixture</h1><button id="outside">Outside focus target</button>
  <div id="clipped-card" style={{position:'relative',transform:'translateZ(0)',filter:'brightness(1)',overflow:'hidden',height:160,maxWidth:500,border:'1px solid gray',padding:16}}>
   <Button id="open-modal" onClick={()=>setOpen(true)}>Open clipped modal</Button><Menu label="Clipped actions"/>
   {open&&<Modal title="Clipped modal" onClose={()=>setOpen(false)}><Controls/><Button id="open-nested" onClick={()=>setNested(true)}>Open nested dialog</Button><Button id="modal-last">Last modal control</Button>
    {nested&&<Modal title="Nested modal" onClose={()=>setNested(false)}><input aria-label="Nested input"/></Modal>}
   </Modal>}
  </div>
  <Button onClick={()=>setMinecraft(true)}>Open Minecraft dialog</Button>
  {minecraft&&<MinecraftDialog title="Minecraft fixture" onClose={()=>setMinecraft(false)}><Controls/></MinecraftDialog>}
  <Sheet><SheetTrigger>Open sheet</SheetTrigger><SheetContent><SheetTitle>Sheet fixture</SheetTitle><Menu label="Sheet actions"/></SheetContent></Sheet>
 </main></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
