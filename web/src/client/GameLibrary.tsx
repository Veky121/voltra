import {PageHeading} from '../ui/PageHeading';
import './games-ui.css';
import {useState} from "react";
import {Link, useSearchParams} from "react-router-dom";
import {Field, Input} from "../lib";
import {GameCatalog,GameFamilyDialog} from "./GameCatalog";
import type {GameFamily} from "./gameFamiliesModel";
import {GameTemplateCatalog} from "./TemplateGames";
import {GameArtworkCredits,GameLibraryCard,minecraftArtwork} from "./GameLibraryCard";
import "./workspace.css";
import "./minecraftSetup.css";
import "./gameLibraryCards.css";
import "./gameLibraryBackground.css";
import "./minecraftCommunity.css";

export {MinecraftSetup} from "./MinecraftSetup";

const minecraftFamily:GameFamily={id:'minecraft',name:'Minecraft',category:'minecraft',variants:[
  {id:'custom',name:'Vanilla & loaders',description:'Choose a Minecraft version, loader and Java runtime.',kind:'default',to:'/game-library/minecraft?setup=custom',available:true,guided:true,aliases:[]},
  {id:'modpack',name:'Modpacks',description:'Browse CurseForge and Modrinth packs.',kind:'community',to:'/game-library/minecraft?setup=modpack',available:true,guided:true,aliases:[]},
  {id:'community',name:'Community software',description:'Browse alternative servers and proxies.',kind:'community',to:'/game-library?minecraft=community',available:true,guided:true,aliases:[]},
]};

export function GameLibrary() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [params] = useSearchParams();
  if (params.get('minecraft') === 'community') return <div className="page workspace-page game-library-page games-ui">
    <header className="page-header"><div><Link className="mc-back" to="/game-library">← Game Library</Link><PageHeading title={<>Community software & patches</>}/></div></header>
    <GameTemplateCatalog minecraftOnly/>
  </div>;
  return <div className="page workspace-page game-library-page games-ui">
    <header className="page-header game-library-heading"><PageHeading title="Choose your game"/><Field label="Find a game"><Input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search games, versions or patches"/></Field></header>
    <GameCatalog search={search} minecraftCard={<GameLibraryCard name="Minecraft" subtitle="Java Edition · Vanilla, modded & modpacks" artwork={minecraftArtwork()} onClick={()=>setOpen(true)} note={`${minecraftFamily.variants.length} server options`}/>}/>
    <GameArtworkCredits/>
    {open && <GameFamilyDialog family={minecraftFamily} onClose={()=>setOpen(false)} disabledReason={()=>undefined}/>}
  </div>;
}
