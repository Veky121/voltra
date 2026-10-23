import {useState} from "react";
import {Link, useNavigate} from "react-router-dom";
import {Icon} from "../Icons";
import {GameIcon} from "./GameIcon";
import {MinecraftDialog} from "./MinecraftDialog";
import {SteamGameTiles} from "./SteamGames";
import {GameTemplateCatalog} from "./TemplateGames";
import {GameArtworkCredits,GameLibraryCard,minecraftArtwork} from "./GameLibraryCard";
import "./workspace.css";
import "./minecraftSetup.css";
import "./gameLibraryCards.css";
import "./gameLibraryBackground.css";

export {MinecraftSetup} from "./MinecraftSetup";

export function GameLibrary() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  return <div className="page workspace-page game-library-page">
    <header className="page-header"><div><p className="eyebrow">Game Library</p><h1>Choose your game</h1><p>Start with a guided setup or browse the full template catalog.</p></div></header>
    <div className="game-library-grid">
      <GameLibraryCard name="Minecraft" subtitle="Java Edition · Vanilla, modded & modpacks" artwork={minecraftArtwork()} onClick={()=>setOpen(true)} guided/>
      <SteamGameTiles/>
    </div>
    <GameTemplateCatalog/>
    <GameArtworkCredits/>
    {open && <MinecraftDialog title="Set up Minecraft" onClose={() => setOpen(false)}>
      <div className="mc-choices">
        <Link className="mc-choice" to="/game-library/minecraft?setup=custom"><GameIcon minecraft/><strong>Custom setup</strong><span>Choose a loader, game version and Java runtime.</span><span className="mc-choice-action">Configure server <span aria-hidden="true">&rarr;</span></span></Link>
        <Link className="mc-choice" to="/game-library/minecraft?setup=modpack"><Icon name="download"/><strong>Start from a modpack</strong><span>Browse CurseForge and Modrinth packs.</span><span className="mc-choice-action">Browse modpacks <span aria-hidden="true">&rarr;</span></span></Link>
      </div>
      <form className="mc-choice-search" role="search" onSubmit={e => {e.preventDefault(); navigate(`/game-library/minecraft?setup=modpack&query=${encodeURIComponent(query.trim())}`);}}>
        <label className="field"><span>Find a modpack</span><div className="mc-search-row"><input type="search" placeholder="Search modpacks" value={query} onChange={e => setQuery(e.target.value)}/><button type="submit">Search</button></div></label>
      </form>
    </MinecraftDialog>}
  </div>;
}
