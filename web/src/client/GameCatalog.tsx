import './games-ui.css';
import {type ReactNode} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {Button, ErrorBox} from '../lib';
import {GameLibraryCard, gameArtwork} from './GameLibraryCard';
import {MinecraftDialog} from './MinecraftDialog';
import {useGameRequest} from './useGameRequest';
import {familyMatches, groupGameCatalog, variantVerification, type CatalogSteamGame, type CatalogTemplate, type GameFamily, type GameVariant, type VariantKind} from './gameFamiliesModel';
import './gameFamilies.css';

function familyArtwork(family: GameFamily) {
  const primary = family.variants.find(variant => variant.kind === 'default') ?? family.variants[0];
  return (primary.steamID ? gameArtwork('steam', primary.steamID) : undefined)
    ?? (primary.templateID ? gameArtwork('templates', primary.templateID) : undefined)
    ?? gameArtwork('categories', family.category);
}

export function GameCatalog({minecraftCard, search}: {minecraftCard: ReactNode; search: string}) {
  const templates = useGameRequest<{games: CatalogTemplate[]; can_install: boolean}>('/api/client/game-library/templates');
  const steam = useGameRequest<{games: CatalogSteamGame[]}>('/api/client/game-library/steam');
  const [params, setParams] = useSearchParams();
  const families = groupGameCatalog(templates.data?.games ?? [], steam.data?.games ?? []);
  const matches = families.filter(family => familyMatches(family, search));
  const selected = families.find(family => family.id === params.get('family'));
  const showMinecraft = !search.trim() || /minecraft|vanilla|modpack|paper|fabric|forge|quilt|bedrock/i.test(search);
  const loading = templates.loading || steam.loading;
  // Both catalogs must settle before a plain recipe can be treated as a single
  // option. Otherwise a late guided response could change the clicked target.
  const settled = !loading;
  function select(id: string | null) {
    setParams(previous => {const next = new URLSearchParams(previous); if (id) next.set('family', id); else next.delete('family'); return next;});
  }
  const reason = (variant: GameVariant) => !variant.available ? 'Compatibility review needed' : templates.data?.can_install === false ? 'Administrator access required' : undefined;
  return <section className="game-family-catalog games-ui" aria-label="Games">
    <ErrorBox>{templates.error}</ErrorBox>{templates.error && <Button onClick={templates.reload} variant="secondary">Retry game recipes</Button>}
    <ErrorBox>{steam.error}</ErrorBox>{steam.error && <Button onClick={steam.reload} variant="secondary">Retry guided setups</Button>}
    {loading && <p className="muted" role="status">Loading games...</p>}
    {settled && <p className="game-family-count muted" role="status">{matches.length + Number(showMinecraft)} games{search.trim() ? ` matching "${search.trim()}"` : ''}</p>}
    <div className="game-library-grid">
      {showMinecraft && minecraftCard}
      {matches.map(family => {
        const variant = family.variants[0];
        const multiple = family.variants.length > 1;
        return <GameLibraryCard key={family.id} name={family.name}
          subtitle={multiple ? (family.variants.some(option => option.kind === 'default') ? 'Vanilla, versions & community servers' : 'Community servers & alternatives') : variant.guided ? 'Dedicated server · Steam updates' : family.category.replaceAll('_', ' ')}
          artwork={familyArtwork(family)} to={!multiple && settled ? variant.to : undefined}
          onClick={multiple && settled ? () => select(family.id) : undefined}
          note={multiple ? `${family.variants.length} server options` : variantVerification(variant)}
          noteTitle={!multiple ? variant.detail : undefined} source={!multiple ? variant.source : undefined}
          disabledReason={!settled ? 'Loading options...' : !multiple ? reason(variant) : undefined}
          guided={family.variants.some(option => option.guided)}/>;
      })}
    </div>
    {settled && !matches.length && !showMinecraft && !templates.error && !steam.error && <p className="muted">No games match this search.</p>}
    {selected && <GameFamilyDialog family={selected} onClose={() => select(null)} disabledReason={reason}/>}
  </section>;
}

const sectionNames: Record<VariantKind, string> = {default: 'Vanilla & default servers', community: 'Community software & patches', other: 'Other versions & platforms'};

export function GameFamilyDialog({family, onClose, disabledReason}: {family: GameFamily; onClose: () => void; disabledReason: (variant: GameVariant) => string | undefined}) {
  return <MinecraftDialog title={`Set up ${family.name}`} onClose={onClose}>
    <div className="game-family-dialog">
      <p className="muted">Choose your server software.</p>
      {(['default', 'community', 'other'] as const).map(kind => {
        const variants = family.variants.filter(variant => variant.kind === kind);
        if (!variants.length) return null;
        return <section key={kind} className="game-family-section" aria-label={sectionNames[kind]}>
          <h3>{sectionNames[kind]}</h3>
          <div className="game-family-options">{variants.map(variant => {
            const blocked = disabledReason(variant);
            const content = <><strong>{variant.name}{!variant.guided && kind === 'default' && family.variants.some(option => option.guided) ? ' · Recipe setup' : ''}</strong>
              <span>{family.id === 'rust' && kind === 'default' ? 'Uses the Autowipe recipe, with vanilla as the default framework. Wipe controls stay in setup.' : variant.description || 'Configure this server using its existing setup.'}</span>
              <small>{blocked ?? (variant.guided ? 'Guided setup · Steam updates' : variantVerification(variant))}</small></>;
            return <div className="game-family-option" key={variant.id}>
              {blocked ? <div className="game-family-option-main is-disabled" aria-disabled="true">{content}</div> : <Link className="game-family-option-main" to={variant.to}>{content}<span className="game-family-option-arrow" aria-hidden="true">→</span></Link>}
              {variant.source && <a className="game-family-recipe" href={variant.source} target="_blank" rel="noreferrer" aria-label={`View recipe for ${variant.name}`}>Recipe</a>}
            </div>;
          })}</div>
        </section>;
      })}
    </div>
  </MinecraftDialog>;
}
