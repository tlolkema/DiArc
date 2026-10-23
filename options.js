import { DEFAULTS, settingsFrom, validOverlayLength, validActionTemplate, normalizeCustomAction } from './core.js';
const form = document.querySelector('#settings');
const status = document.querySelector('#save-status');
const sourceList = document.querySelector('#source-list');
const sourceLabels = { tab: 'Open tabs', bookmark: 'Bookmarks', history: 'History' };
const fields = document.querySelector('#settings-fields');
const actionList = document.querySelector('#custom-actions');
const addAction = document.querySelector('#add-custom-action');
let preferences = settingsFrom();
let ready = false;
let saveQueue = Promise.resolve();
let saveRevision = 0;

const isMac = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
for (const [id, mac, other] of [
  ['recommended-new-shortcut', '⌘T', 'Ctrl+T'],
  ['recommended-address-shortcut', '⌘L', 'Ctrl+L'],
  ['fallback-new-shortcut', '⌥T', 'Alt+T'],
  ['fallback-address-shortcut', '⌥L', 'Alt+L']
]) document.getElementById(id).textContent = isMac ? mac : other;

const shortcutLink = document.querySelector('#shortcut-settings-link');
async function openShortcutSettings(event) {
  if (event.type === 'auxclick' && event.button !== 1) return;
  event.preventDefault();
  const feedback = document.querySelector('#shortcut-status');
  feedback.textContent = '';
  try {
    // Internal browser URLs need the tabs API rather than ordinary link navigation.
    await chrome.tabs.create({ url: 'chrome://extensions/shortcuts', active: !(event.metaKey || event.ctrlKey || event.button === 1) });
  } catch (error) {
    feedback.textContent = `Could not open shortcut settings. Enter chrome://extensions/shortcuts in your browser. ${error.message}`;
  }
}
shortcutLink.addEventListener('click', openShortcutSettings);
shortcutLink.addEventListener('auxclick', openShortcutSettings);

function markValidity(field, valid) {
  if (valid) field.removeAttribute('aria-invalid');
  else field.setAttribute('aria-invalid', 'true');
}

function savePreferences(announcement = '') {
  if (!ready) return;
  const errors = [];
  const readNumber = (name, message) => {
    const field = form.elements[name];
    const valid = field.validity.valid;
    markValidity(field, valid);
    if (!valid) errors.push(message);
    return valid ? field.value : preferences[name];
  };
  const maxResults = readNumber('maxResults', 'Enter a whole result limit from 1 to 20.');
  const backgroundBlur = form.elements.backgroundBlur.checked;
  const lengths = {};
  for (const [name, axis] of [['overlayWidth', 'width'], ['overlayHeight', 'height']]) {
    const field = form.elements[name];
    const valid = validOverlayLength(field.value, axis);
    markValidity(field, valid);
    if (!valid) errors.push(`Enter a valid overlay ${axis} in ${axis === 'width' ? 'px, vw, vh, or %' : 'px, vh, or %'}.`);
    lengths[name] = valid ? field.value : preferences[name];
  }
  const customActions = [];
  for (const row of actionList.children) {
    const label = row.querySelector('.action-label');
    const url = row.querySelector('.action-url');
    const draft = {
      id: row.dataset.actionId,
      label: label.value,
      urlTemplate: url.value,
      enabled: row.querySelector('.action-enabled input').checked
    };
    const valid = normalizeCustomAction(draft);
    markValidity(label, Boolean(label.value.trim()) && label.value.trim().length <= 48);
    markValidity(url, validActionTemplate(url.value));
    if (valid) customActions.push(valid);
    else {
      errors.push('Complete each custom action with a label and an HTTP(S) URL.');
      const previous = preferences.customActions.find(action => action.id === draft.id);
      if (previous) customActions.push({ ...previous, enabled: draft.enabled });
    }
  }
  const data = new FormData(form);
  const values = settingsFrom({
    ...Object.fromEntries(data),
    maxResults,
    backgroundBlur,
    ...lengths,
    enabledSources: data.getAll('enabledSources'),
    sourceOrder: [...sourceList.children].map(row => row.dataset.source),
    enabledQuickActions: data.getAll('enabledQuickActions'),
    customActions
  });
  preferences = values;
  const revision = ++saveRevision;
  const validationMessage = errors.length ? `${[...new Set(errors)].join(' ')} Other changes save automatically.` : '';
  status.textContent = validationMessage || `${announcement} Saving…`.trim();
  // Serialize writes so a slow earlier change cannot overwrite a newer one.
  saveQueue = saveQueue.then(async () => {
    try {
      await chrome.storage.local.set(values);
      if (revision === saveRevision) status.textContent = validationMessage || `${announcement} Saved automatically. Reopen DiArc to apply.`.trim();
    } catch (error) {
      if (revision === saveRevision) status.textContent = `Could not save preferences: ${error.message}`;
    }
  });
}

function updateSourceRows() {
  const rows = [...sourceList.children];
  rows.forEach((row, index) => {
    row.querySelector('.source-rank').textContent = index + 1;
    row.querySelector('[data-direction="-1"]').disabled = index === 0;
    row.querySelector('[data-direction="1"]').disabled = index === rows.length - 1;
    row.dataset.enabled = String(row.querySelector('input').checked);
  });
}

function renderSources(values) {
  sourceList.replaceChildren();
  for (const source of values.sourceOrder) {
    const row = document.createElement('li');
    row.className = 'source-item';
    row.dataset.source = source;
    const rank = document.createElement('span');
    rank.className = 'source-rank';
    rank.setAttribute('aria-hidden', 'true');
    const label = document.createElement('label');
    label.className = 'source-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.className = 'toggle-input';
    checkbox.name = 'enabledSources'; checkbox.value = source;
    checkbox.checked = values.enabledSources.includes(source);
    label.append(checkbox, document.createTextNode(sourceLabels[source]));
    const controls = document.createElement('div');
    controls.className = 'source-controls';
    for (const direction of [-1, 1]) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'source-move'; button.dataset.direction = direction;
      const description = `Move ${sourceLabels[source]} ${direction === -1 ? 'up' : 'down'}`;
      button.setAttribute('aria-label', description); button.title = description;
      button.textContent = direction === -1 ? '↑' : '↓';
      button.addEventListener('click', () => {
        const adjacent = direction === -1 ? row.previousElementSibling : row.nextElementSibling;
        if (!adjacent) return;
        if (direction === -1) sourceList.insertBefore(row, adjacent);
        else sourceList.insertBefore(adjacent, row);
        updateSourceRows();
        (button.disabled ? controls.querySelector(`button[data-direction="${-direction}"]`) : button).focus();
        savePreferences(`${sourceLabels[source]} moved to position ${[...sourceList.children].indexOf(row) + 1}.`);
      });
      controls.append(button);
    }
    row.append(rank, label, controls);
    sourceList.append(row);
  }
  updateSourceRows();
}

function updateActionList() {
  document.querySelector('#custom-empty').hidden = actionList.children.length > 0;
  addAction.disabled = actionList.children.length >= 12;
  addAction.textContent = addAction.disabled ? 'Maximum of 12 custom actions' : 'Add quick action';
}

function appendCustomAction(action, focus = false) {
  const row = document.createElement('div');
  row.className = 'custom-action'; row.dataset.actionId = action.id;
  const heading = document.createElement('div'); heading.className = 'action-heading';
  function field(title, className, value, placeholder, maxLength) {
    const label = document.createElement('label'); label.className = 'action-field';
    label.append(document.createTextNode(title));
    const input = document.createElement('input');
    input.type = 'text'; input.className = className; input.value = value;
    input.placeholder = placeholder; input.maxLength = maxLength; input.autocomplete = 'off'; input.spellcheck = false;
    label.append(input);
    return { label, input };
  }
  const name = field('Label', 'action-label', action.label, 'e.g. Search GitHub', 48);
  const url = field('URL', 'action-url', action.urlTemplate, 'https://github.com/search?q={query}', 2048);
  url.input.inputMode = 'url';
  const remove = document.createElement('button');
  remove.type = 'button'; remove.className = 'action-remove'; remove.textContent = 'Remove';
  const updateRemoveLabel = () => remove.setAttribute('aria-label', `Remove ${name.input.value.trim() || 'custom action'}`);
  updateRemoveLabel(); name.input.addEventListener('input', updateRemoveLabel);
  remove.addEventListener('click', () => {
    row.remove(); updateActionList(); addAction.focus(); savePreferences('Custom action removed.');
  });
  const enabled = document.createElement('label'); enabled.className = 'action-enabled';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox'; checkbox.className = 'toggle-input'; checkbox.checked = action.enabled !== false;
  enabled.append(checkbox, document.createTextNode('Enabled'));
  heading.append(name.label, remove);
  row.append(heading, url.label, enabled);
  actionList.append(row); updateActionList();
  if (focus) name.input.focus();
}

function renderCustomActions(values) {
  actionList.replaceChildren();
  for (const action of values.customActions) appendCustomAction(action);
  updateActionList();
}

renderSources(DEFAULTS);
renderCustomActions(DEFAULTS);
addAction.addEventListener('click', () => {
  if (actionList.children.length >= 12) return;
  appendCustomAction({ id: crypto.randomUUID(), label: '', urlTemplate: '', enabled: true }, true);
  savePreferences();
});
form.addEventListener('input', () => { updateSourceRows(); savePreferences(); });
form.addEventListener('submit', event => event.preventDefault());

try {
  preferences = settingsFrom(await chrome.storage.local.get(DEFAULTS));
  for (const key of ['maxResults', 'searchEngine', 'theme', 'overlayWidth', 'overlayHeight']) form.elements[key].value = preferences[key];
  form.elements.backgroundBlur.checked = preferences.backgroundBlur;
  for (const checkbox of form.querySelectorAll('[name="enabledQuickActions"]')) checkbox.checked = preferences.enabledQuickActions.includes(checkbox.value);
  renderSources(preferences); renderCustomActions(preferences);
  ready = true; fields.disabled = false;
} catch (error) { status.textContent = `Could not load preferences: ${error.message}`; }

try {
  const commands = await chrome.commands.getAll();
  for (const [name, id] of [['new-tab', 'new-shortcut'], ['edit-address', 'address-shortcut']]) {
    document.getElementById(id).textContent = commands.find(command => command.name === name)?.shortcut || 'Not assigned';
  }
} catch (error) {
  if (ready && saveRevision === 0) status.textContent = `Could not load keyboard shortcuts: ${error.message}`;
}
