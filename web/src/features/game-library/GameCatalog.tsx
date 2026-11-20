import './games-ui.css';
import {useMemo, useState, type ReactNode} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {api, Button, ErrorBox, unwrap, useAPI} from '../../lib';
import {GameLibraryCard, GameLibraryCardPlaceholder, gameArtwork} from './GameLibraryCard';
import {gameCatalogPath, loadAndSaveGameCatalog, readGameCatalogSnapshot} from './gameLibraryCatalog';
import {MinecraftDialog} from './MinecraftDialog';
import {useGameRequest} from './useGameRequest';
import {
  groupGameCatalog,
  variantVerification,
  type CatalogSteamGame,
  type CatalogTemplate,
  type GameFamily,
  type GameVariant,
  type VariantKind,
} from './gameFamiliesModel';
import {
  categoryCounts,
  familySubtitle,
  filterGameFamilies,
  gameCategories,
  isGameCategory,
  minecraftVisible,
  pageGameFamilies,
  type GameCategory,
} from './gameLibraryFilters';
import {ToggleGroup, ToggleGroupItem} from '../../components/ui/toggle-group';
import './gameFamilies.css';
import type {Account, Resource} from '../../types/api';

function familyArtwork(family: GameFamily) {
  const primary = family.variants.find(variant => variant.kind === 'default') ?? family.variants[0];
  return (
    (primary.steamID ? gameArtwork('steam', primary.steamID) : undefined) ??
    (primary.templateID ? gameArtwork('templates', primary.templateID) : undefined) ??
    gameArtwork('categories', family.category)
  );
}

type LibraryCatalog = {templates: CatalogTemplate[]; steam: CatalogSteamGame[]; can_install: boolean};
const placeholders = Array.from({length: 11}, (_, index) => index);
// The answer is saved by the request itself, for the account that made it.
const requestCatalog = <T,>(path: string, options?: RequestInit) =>
  loadAndSaveGameCatalog(api, path, options) as Promise<T>;

export function GameCatalog({minecraftCard, search}: {minecraftCard: ReactNode; search: string}) {
  // Recipes and guided setups arrive in one response, so the grid is grouped
  // once. The copy saved from the last visit is shown until that response lands.
  const catalog = useGameRequest<LibraryCatalog>(gameCatalogPath, 0, requestCatalog);
  const profile = unwrap(useAPI<Resource<Account>>('/api/client/account').data);
  const account = String(profile?.uuid ?? profile?.id ?? '');
  // Read again when the account is known: before that there is nobody to read it for.
  const saved = useMemo(() => readGameCatalogSnapshot(), [account]);
  const live = catalog.data;
  const templates = live ? (live.templates ?? []) : saved?.templates;
  const steam = live ? (live.steam ?? []) : saved?.steam;
  // Installing is offered only when the panel said so in as many words.
  const canInstall = live ? live.can_install === true : saved?.canInstall === true;
  const ready = !!templates && !!steam;
  const [params, setParams] = useSearchParams();
  const families = useMemo(() => (templates && steam ? groupGameCatalog(templates, steam) : []), [templates, steam]);
  const requested = params.get('category');
  const category: GameCategory | null = isGameCategory(requested) ? requested : null;
  // Filtering and paging run over the one catalog already in memory.
  const matches = useMemo(() => filterGameFamilies(families, {search, category}), [families, search, category]);
  const counts = useMemo(() => categoryCounts(families, search), [families, search]);
  const selected = families.find(family => family.id === params.get('family'));
  const showMinecraft = minecraftVisible(search, category);
  // A new search or category starts again from the first page.
  const filterKey = `${search.trim()}|${category ?? ''}`;
  const [paging, setPaging] = useState({key: filterKey, pages: 1});
  const pages = paging.key === filterKey ? paging.pages : 1;
  const {shown, remaining} = pageGameFamilies(matches, pages);
  function select(id: string | null) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (id) next.set('family', id);
      else next.delete('family');
      return next;
    });
  }
  function filter(id: GameCategory | null) {
    setParams(
      previous => {
        const next = new URLSearchParams(previous);
        if (id) next.set('category', id);
        else next.delete('category');
        return next;
      },
      {preventScrollReset: true}
    );
  }
  const total = matches.length + Number(showMinecraft);
  const reason = (variant: GameVariant) =>
    !variant.available ? 'Compatibility review needed' : !canInstall ? 'Administrator access required' : undefined;
  return (
    <section className="game-family-catalog games-ui" aria-label="Games">
      <ErrorBox>{catalog.error}</ErrorBox>
      {catalog.error && (
        <Button onClick={catalog.reload} variant="secondary">
          Retry games
        </Button>
      )}
      {ready && (
        <ToggleGroup
          className="game-library-categories"
          aria-label="Game categories"
          value={[category ?? 'all']}
          onValueChange={(next: unknown[]) => {
            const choice = next[0];
            if (choice === 'all') filter(null);
            else if (isGameCategory(choice)) filter(choice);
          }}
        >
          <ToggleGroupItem value="all">
            All<span>{Object.values(counts).reduce((sum, count) => sum + count, 0)}</span>
          </ToggleGroupItem>
          {gameCategories
            .filter(option => counts[option.id] > 0 || option.id === category)
            .map(option => (
              <ToggleGroupItem key={option.id} value={option.id}>
                {option.label}
                <span>{counts[option.id]}</span>
              </ToggleGroupItem>
            ))}
        </ToggleGroup>
      )}
      {ready ? (
        <p className="game-family-count muted" role="status">
          {total} {total === 1 ? 'game' : 'games'}
          {category ? ` in ${gameCategories.find(option => option.id === category)!.label}` : ''}
          {search.trim() ? ` matching "${search.trim()}"` : ''}
        </p>
      ) : (
        catalog.loading && (
          <p className="game-family-count muted" role="status">
            Loading games...
          </p>
        )
      )}
      <div className="game-library-grid">
        {showMinecraft && minecraftCard}
        {shown.map(family => {
          const variant = family.variants[0];
          const multiple = family.variants.length > 1;
          return (
            <GameLibraryCard
              key={family.id}
              name={family.name}
              subtitle={familySubtitle(family)}
              artwork={familyArtwork(family)}
              to={!multiple ? variant.to : undefined}
              onClick={multiple ? () => select(family.id) : undefined}
              note={multiple ? `${family.variants.length} server options` : variantVerification(variant)}
              noteTitle={!multiple ? variant.detail : undefined}
              source={!multiple ? variant.source : undefined}
              disabledReason={!multiple ? reason(variant) : undefined}
              guided={family.variants.some(option => option.guided)}
            />
          );
        })}
        {!ready && catalog.loading && placeholders.map(index => <GameLibraryCardPlaceholder key={index} />)}
      </div>
      {remaining > 0 && (
        <div className="game-library-more">
          <Button variant="secondary" onClick={() => setPaging({key: filterKey, pages: pages + 1})}>
            Show more games
          </Button>
          <span className="muted">
            {shown.length + Number(showMinecraft)} of {total} shown
          </span>
        </div>
      )}
      {ready && !matches.length && !showMinecraft && !catalog.error && (
        <p className="muted">{category ? 'No games in this category match.' : 'No games match this search.'}</p>
      )}
      {selected && <GameFamilyDialog family={selected} onClose={() => select(null)} disabledReason={reason} />}
    </section>
  );
}

const sectionNames: Record<VariantKind, string> = {
  default: 'Vanilla & default servers',
  community: 'Community software & patches',
  other: 'Other versions & platforms',
};

export function GameFamilyDialog({
  family,
  onClose,
  disabledReason,
}: {
  family: GameFamily;
  onClose: () => void;
  disabledReason: (variant: GameVariant) => string | undefined;
}) {
  return (
    <MinecraftDialog title={`Set up ${family.name}`} onClose={onClose}>
      <div className="game-family-dialog">
        <p className="muted">Choose your server software.</p>
        {(['default', 'community', 'other'] as const).map(kind => {
          const variants = family.variants.filter(variant => variant.kind === kind);
          if (!variants.length) return null;
          return (
            <section key={kind} className="game-family-section" aria-label={sectionNames[kind]}>
              <h3>{sectionNames[kind]}</h3>
              <div className="game-family-options">
                {variants.map(variant => {
                  const blocked = disabledReason(variant);
                  const content = (
                    <>
                      <strong>
                        {variant.name}
                        {!variant.guided && kind === 'default' && family.variants.some(option => option.guided)
                          ? ' · Recipe setup'
                          : ''}
                      </strong>
                      <span>
                        {family.id === 'rust' && kind === 'default'
                          ? 'Uses the Autowipe recipe, with vanilla as the default framework. Wipe controls stay in setup.'
                          : variant.description || 'Configure this server using its existing setup.'}
                      </span>
                      <small>
                        {blocked ?? (variant.guided ? 'Guided setup · Steam updates' : variantVerification(variant))}
                      </small>
                    </>
                  );
                  return (
                    <div className="game-family-option" key={variant.id}>
                      {blocked ? (
                        <div className="game-family-option-main is-disabled" aria-disabled="true">
                          {content}
                        </div>
                      ) : (
                        <Link className="game-family-option-main" to={variant.to}>
                          {content}
                          <span className="game-family-option-arrow" aria-hidden="true">
                            →
                          </span>
                        </Link>
                      )}
                      {variant.source && (
                        <a
                          className="game-family-recipe"
                          href={variant.source}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`View recipe for ${variant.name}`}
                        >
                          Recipe
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </MinecraftDialog>
  );
}
