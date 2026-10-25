import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes, useLocation, useNavigate} from 'react-router-dom';
import {GameLibrary} from '../../src/client/GameLibrary';
import catalog from '../../../internal/panel/game_library/upstream/catalog.json';
import '../../src/styles.css';
import '../../src/theme.css';

const games = catalog.entries.map(entry => ({id: entry.path, name: entry.egg.name, category: entry.path.split('/')[0], source: `https://github.com/pterodactyl/game-eggs/blob/pinned/${entry.path}`, description: entry.egg.description ?? '', available: true, verification: 'runtime_unverified', detail: '', managed_game: entry.path.includes('palworld/egg-palworld-proton') ? 'palworld-proton' : entry.path.includes('palworld/egg-palworld.json') ? 'palworld-native' : entry.path.startsWith('satisfactory/') ? 'satisfactory' : entry.path.startsWith('7_days_to_die/') ? '7days' : undefined}));
const profiles = ['palworld-native', 'palworld-proton', 'palworld', 'satisfactory', 'valheim', '7days'].map(id => ({id, name: id === '7days' ? '7 Days to Die' : id.startsWith('palworld') ? `Palworld${id === 'palworld' ? '' : id === 'palworld-native' ? ' Linux' : ' Proton'}` : id[0].toUpperCase() + id.slice(1), description: 'Guided dedicated server.'}));
let denied = false, steamFailure = false;
const calls: string[] = [];
window.fetch = async (input, init) => {
  const path = String(input); calls.push(`${init?.method ?? 'GET'} ${path}`);
  if (init?.method && init.method !== 'GET') throw Error('Fixture blocks all mutations.');
  const headers = {'Content-Type': 'application/json'};
  if (path === '/api/client/game-library/templates') return new Response(JSON.stringify({attributes: {games, can_install: !denied}}), {headers});
  if (path === '/api/client/game-library/steam') return steamFailure ? new Response(JSON.stringify({errors: [{detail: 'Fixture Steam unavailable'}]}), {status:503, headers}) : new Response(JSON.stringify({attributes: {games: profiles}}), {headers});
  throw Error(`Fixture blocked unexpected fetch: ${path}`);
};
const root = createRoot(document.getElementById('root')!);
function Destination() {
  const location = useLocation(), navigate = useNavigate();
  return <div><p data-destination>{location.pathname}</p><button onClick={() => navigate(-1)}>Back to library</button></div>;
}
function View() {return <MemoryRouter initialEntries={['/game-library']}><Routes><Route path="/game-library" element={<GameLibrary/>}/><Route path="*" element={<Destination/>}/></Routes></MemoryRouter>;}
async function mount() {await act(async () => {root.render(<View key={crypto.randomUUID()}/>);}); await act(async () => {});}
function assert(ok: unknown, detail: string): asserts ok {if (!ok) throw Error(detail);}
function card(name: string) {return [...document.querySelectorAll<HTMLElement>('.library-card')].filter(node => node.querySelector('h3')?.textContent === name);}
async function click(element: Element | undefined | null) {assert(element, 'Missing click target'); await act(async () => {(element as HTMLElement).click();}); await act(async () => {});}
async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[type=search]')!;
  await act(async () => {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', {bubbles:true}));});
}
async function open(name: string) {assert(card(name).length === 1, `Expected one ${name} card`); await click(card(name)[0].querySelector('button'));}
async function close() {await click(document.querySelector('button[aria-label="Close dialog"]'));}
async function run() {
  const passed: string[] = [];
  const check = (ok: unknown, detail: string) => {assert(ok, detail); passed.push(detail);};
  await mount();
  for (const name of ['Rust', 'Counter-Strike 1.6', 'Palworld', 'Valheim', 'Satisfactory', '7 Days to Die', 'Terraria', 'Minecraft']) check(card(name).length === 1, `One ${name} card`);
  check(card('Counter-Strike 2').length === 1 && card('Counter-Strike: Source').length === 1, 'Distinct Counter-Strike games retained');
  check(card('Rust Staging').length === 0 && card('Rust Autowipe').length === 0, 'Rust variants absent at library root');
  await open('Rust');
  let dialog = document.querySelector('dialog')!;
  check(dialog.open && dialog.querySelector('h2')?.textContent === 'Set up Rust', 'Rust opens accessible modal');
  check(dialog.querySelector('.game-family-section')?.getAttribute('aria-label') === 'Vanilla & default servers', 'Rust default section first');
  check(dialog.querySelector('.game-family-option strong')?.textContent === 'Vanilla / Autowipe', 'Rust default retains truthful Autowipe label');
  const staging = [...dialog.querySelectorAll<HTMLAnchorElement>('.game-family-option-main')].find(link => link.textContent?.includes('Rust Staging'));
  check(staging?.getAttribute('href') === '/game-library/template/rust%2Frust_staging%2Fegg-rust-staging.json', 'Staging uses original setup route');
  await click(staging);
  check(!!document.querySelector('[data-destination]')?.textContent?.includes('rust_staging'), 'Staging route navigates');
  await click([...document.querySelectorAll('button')].find(button => button.textContent === 'Back to library'));
  check(document.querySelector('dialog')?.open === true, 'Back restores family selector');
  await close();
  check(!document.querySelector('dialog'), 'Close removes selector');
  await search('ReHLDS');
  check(card('Counter-Strike 1.6').length === 1 && card('Rust').length === 0, 'Patch search returns parent game');
  await open('Counter-Strike 1.6');
  dialog = document.querySelector('dialog')!;
  check(dialog.querySelector('.game-family-option strong')?.textContent === 'Vanilla', 'CS1.6 Vanilla before ReHLDS');
  check(!!dialog.textContent?.includes('ReHLDS'), 'CS1.6 keeps community patch');
  await close(); await search('');
  await open('Palworld');
  check(document.querySelectorAll('dialog .game-family-option').length === 3, 'Palworld three distinct guided choices, no recipe duplicates');
  await close(); await open('Among Us');
  check(!document.querySelector('dialog [aria-label="Vanilla & default servers"]'), 'Community-only game has no invented vanilla');
  await close();
  denied = true; await mount(); await open('Rust');
  check(document.querySelectorAll('dialog .game-family-option-main[aria-disabled=true]').length === 2 && !document.querySelector('dialog a.game-family-option-main'), 'Permissions disable setup choices');
  await close();
  denied = false; steamFailure = true; await mount();
  check(document.body.textContent?.includes('Fixture Steam unavailable') && !![...document.querySelectorAll('button')].find(button => button.textContent === 'Retry guided setups'), 'Guided catalog error offers retry');
  check(card('Rust').length === 1 && card('Palworld').length === 1, 'Recipe catalog remains usable when Steam fails');
  steamFailure = false; await click([...document.querySelectorAll('button')].find(button => button.textContent === 'Retry guided setups'));
  check(!document.body.textContent?.includes('Fixture Steam unavailable') && card('Palworld').length === 1, 'Retry restores guide without duplicate card');
  check(calls.every(call => call.startsWith('GET ')), 'No real mutation attempted');
  const output = document.createElement('output'); output.id = 'suite-result'; output.textContent = `${passed.length} checks passed`; output.dataset.passed = String(passed.length); document.body.append(output);
  return passed;
}
(window as any).runGameFamilySuite = run;
if (new URLSearchParams(location.search).has('suite')) void run().catch(error => {const out = document.createElement('pre');out.id='suite-result';out.textContent=`FAIL: ${error.message}`;document.body.append(out);});
else void mount();
