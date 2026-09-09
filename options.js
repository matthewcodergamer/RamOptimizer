const $ = (selector) => document.querySelector(selector);
let state = null;
let statusTimer = null;

const modeDescriptions = {
  balanced: 'Starts near 88% memory use and favors tabs unused for about three hours.',
  smart: 'Starts near 82% memory use and favors tabs unused for about an hour.',
  maximum: 'Starts near 75% memory use and can unload more background tabs sooner.'
};

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || 'RamOptimizer could not complete that action.');
  return response;
}

function setStatus(text, kind = '') {
  clearTimeout(statusTimer);
  const node = $('#saveStatus');
  node.textContent = text;
  node.className = kind;
  if (kind) {
    statusTimer = setTimeout(() => {
      node.textContent = 'Ready';
      node.className = '';
    }, 2500);
  }
}

function render(data) {
  state = data;
  const { settings } = data;

  $('#enabledToggle').setAttribute('aria-checked', String(settings.enabled));
  $('#modeSelect').value = settings.mode;
  $('#modeSummary').textContent = modeDescriptions[settings.mode];

  const list = $('#protectedList');
  list.textContent = '';
  $('#protectedEmpty').hidden = settings.protectedHosts.length > 0;
  list.hidden = settings.protectedHosts.length === 0;

  settings.protectedHosts.forEach((host) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    const remove = document.createElement('button');
    label.textContent = host;
    remove.textContent = 'Remove';
    remove.type = 'button';
    remove.addEventListener('click', () => removeHost(host));
    item.append(label, remove);
    list.append(item);
  });

  const { stats } = settings;
  if (!stats.tabsDiscarded && !stats.manualRuns && !stats.cycles) {
    $('#statsText').textContent = 'No optimization activity recorded yet.';
  } else {
    $('#statsText').textContent = `${stats.tabsDiscarded} tabs unloaded · ${stats.manualRuns} manual runs · ${stats.cycles} automatic checks.`;
  }
}

async function refresh() {
  try {
    const response = await send('GET_DASHBOARD');
    render(response.data);
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function removeHost(host) {
  try {
    await send('UNPROTECT_HOST', { host });
    setStatus(`${host} removed`, 'success');
    await refresh();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

$('#enabledToggle').addEventListener('click', async () => {
  if (!state) return;
  try {
    await send('SET_ENABLED', { enabled: !state.settings.enabled });
    setStatus('Automatic optimization updated', 'success');
    await refresh();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

$('#modeSelect').addEventListener('change', async (event) => {
  try {
    await send('SET_MODE', { mode: event.target.value });
    setStatus('Optimization mode saved', 'success');
    await refresh();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

$('#protectForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#hostInput');
  const host = input.value.trim();
  if (!host) return;

  try {
    await send('PROTECT_HOST', { host });
    input.value = '';
    setStatus('Website protected', 'success');
    await refresh();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

$('#duplicatesButton').addEventListener('click', async () => {
  const button = $('#duplicatesButton');
  button.disabled = true;
  button.textContent = 'Running…';
  try {
    const response = await send('SLEEP_DUPLICATES');
    setStatus(
      response.discarded
        ? `${response.discarded} duplicate ${response.discarded === 1 ? 'tab' : 'tabs'} unloaded`
        : 'No duplicate tabs needed unloading',
      'success'
    );
    await refresh();
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Run';
  }
});

$('#resetStatsButton').addEventListener('click', async () => {
  try {
    await send('RESET_STATS');
    setStatus('Statistics reset', 'success');
    await refresh();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

refresh();
