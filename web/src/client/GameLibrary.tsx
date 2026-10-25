import './games-ui.css';
import {useState} from "react";
import {Link, useNavigate, useSearchParams} from "react-router-dom";
import {Icon} from "../Icons";
import {Field, Input} from "../lib";
import {GameIcon} from "./GameIcon";
import {MinecraftDialog} from "./MinecraftDialog";
import {GameCatalog} from "./GameCatalog";
import {GameTemplateCatalog} from "./TemplateGames";
import {GameArtworkCredits,GameLibraryCard,minecraftArtwork} from "./GameLibraryCard";
import "./workspace.css";
import "./minecraftSetup.css";
import "./gameLibraryCards.css";
import "./gameLibraryBackground.css";
import "./minecraftCommunity.css";

export {MinecraftSetup} from "./MinecraftSetup";

export function GameLibrary() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [params] = useSearchParams();
  if (params.get('minecraft') === 'community') return <div className="page workspace-page game-library-page games-ui">
    <header className="page-header"><div><Link className="mc-back" to="/game-library">← Game Library</Link><p className="eyebrow">Minecraft</p><h1>Community software & patches</h1><p>Find the server software that fits your world.</p></div></header>
    <GameTemplateCatalog minecraftOnly/>
  </div>;
  return <div className="page workspace-page game-library-page games-ui">
    <header className="page-header game-library-heading"><div><p className="eyebrow">Game Library</p><h1>Choose your game</h1></div><Field label="Find a game"><Input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search games, versions or patches"/></Field></header>
    <GameCatalog search={search} minecraftCard={<GameLibraryCard name="Minecraft" subtitle="Java Edition · Vanilla, modded & modpacks" artwork={minecraftArtwork()} onClick={()=>setOpen(true)} guided/>}/>
    <GameArtworkCredits/>
    {open && <MinecraftDialog title="Set up Minecraft" onClose={() => setOpen(false)}>
      <div className="mc-choices">
        <Link className="mc-choice" to="/game-library/minecraft?setup=custom"><GameIcon minecraft/><strong>Custom setup</strong><span>Choose a loader, game version and Java runtime.</span><span className="mc-choice-action">Configure server <span aria-hidden="true">&rarr;</span></span></Link>
        <Link className="mc-choice" to="/game-library/minecraft?setup=modpack"><Icon name="download"/><strong>Start from a modpack</strong><span>Browse CurseForge and Modrinth packs.</span><span className="mc-choice-action">Browse modpacks <span aria-hidden="true">&rarr;</span></span></Link>
        <Link className="mc-choice mc-choice-community" to="/game-library?minecraft=community"><Icon name="server"/><strong>Community software & patches</strong><span>Unofficial servers, loaders and proxies, including Paper, Fabric and more.</span><span className="mc-choice-action">Browse community software <span aria-hidden="true">&rarr;</span></span></Link>
      </div>
      <form className="mc-choice-search" role="search" onSubmit={e => {e.preventDefault(); navigate(`/game-library/minecraft?setup=modpack&query=${encodeURIComponent(query.trim())}`);}}>
        <label className="field"><span>Find a modpack</span><div className="mc-search-row"><input type="search" placeholder="Search modpacks" value={query} onChange={e => setQuery(e.target.value)}/><button type="submit">Search</button></div></label>
      </form>
    </MinecraftDialog>}
  </div>;
}
