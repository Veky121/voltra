import {modules} from './modules/index.js';

function attach() {
  if (document.getElementById('voltra-addon-button')) return;
  const module = modules.find(module => module.readMod(document, location.href));
  if (!module) return;
  const anchor = document.querySelector('.download-box');
  if (!anchor) return;
  const button = document.createElement('button');
  button.id = 'voltra-addon-button';
  button.type = 'button';
  button.textContent = 'Add to Voltra';
  button.className = 'button button-buy button-middle';
  button.style.cssText = 'margin-top:8px;cursor:pointer';
  button.addEventListener('click', async event => {
    if (!event.isTrusted) return;
    const mod = module.readMod(document, location.href);
    if (mod) await chrome.runtime.sendMessage({type: 'open', mod});
  });
  anchor.append(button);
}
attach();
new MutationObserver(attach).observe(document.body, {childList: true, subtree: true});
