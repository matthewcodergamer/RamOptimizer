const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const modeCopy = {
  balanced: 'Waits for heavier pressure and only unloads older background tabs.',
  smart: 'Adapts to memory pressure while keeping recently used tabs ready.',
  maximum: 'Starts earlier and unloads more inactive tabs on low-memory machines.'
};

let dashboard = null;
let busy = false;

function bytesToGiB(bytes) {
  return `${(bytes / (1024 ** 3)).toFixed(bytes >= 10 * 1024 ** 3 ? 1 : 2)} GB`;
}

function relativeTime(timestamp) {
  if (!timestamp) return 'No optimization run yet';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 20) return 'Optimized just now';
  if (seconds < 60) return `Optimized ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Optimized ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Optimized ${hours}h ago`;
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || 'RamOptimizer could not complete that action.');
  return response;
}

function setBusy(next) {
  busy = next;
  $('#optimizeButton').disabled = next;
  $('#optimizeLabel').textContent = next ? 'Optimizing…' : 'Optimize now';
}

function setResult(message, kind = '') {
  const node = $('#resultMessage');
  node.textContent = message || '';
  node.className = `result-message${kind ? ` ${kind}` : ''}`;
}

function render(data) {
  dashboard = data;
  const { settings, memory, tabs, currentSite } = data;

  $('#powerToggle').setAttribute('aria-checked', String(settings.enabled));
  $('#statusText').textContent = settings.enabled ? 'Automatic optimization is on' : 'Automatic optimization is off';

  const pct = Math.min(100, Math.max(0, memory.usedPercent));
  $('#memoryPercent').textContent = `${Math.round(pct)}%`;
  $('#memoryBar').style.width = `${pct}%`;
  $('#memoryBar').style.background = memory.pressure === 'critical'
    ? '#a13a32'
    : memory.pressure === 'high'
      ? '#9a5b13'
      : '#157a46';
  $('#memoryAvailable').textContent = `${bytesToGiB(memory.available)} available of ${bytesToGiB(memory.capacity)}`;

  const pressure = $('#pressureBadge');
  pressure.textContent = memory.pressure;
  pressure.className = `pressure ${memory.pressure}`;

  $('#tabCount').textContent = tabs.total;
  $('#sleepingCount').textContent = tabs.discarded;
  $('#protectedCount').textContent = tabs.protected;

  $$('.segmented button').forEach((button) => {
    const active = button.dataset.mode === settings.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  $('#modeDescription').textContent = modeCopy[settings.mode];

  $('#currentHost').textContent = currentSite.host || 'Browser page';
  $('#protectButton').disabled = !currentSite.host;
  $('#protectButton').textContent = currentSite.protected ? 'Unprotect' : 'Protect';

  $('#lastRun').textContent = relativeTime(settings.lastResult?.timestamp);
}

async function refresh() {
  try {
    const response = await send('GET_DASHBOARD');
    render(response.data);
  } catch (error) {
    setResult(error.message, 'error');
  }
}

$('#powerToggle').addEventListener('click', async () => {
  if (busy || !dashboard) return;
  const enabled = !dashboard.settings.enabled;
  try {
    await send('SET_ENABLED', { enabled });
    await refresh();
  } catch (error) {
    setResult(error.message, 'error');
  }
});

$$('.segmented button').forEach((button) => {
  button.addEventListener('click', async () => {
    if (busy || !dashboard || button.dataset.mode === dashboard.settings.mode) return;
    try {
      await send('SET_MODE', { mode: button.dataset.mode });
      setResult('');
      await refresh();
    } catch (error) {
      setResult(error.message, 'error');
    }
  });
});

$('#optimizeButton').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  setResult('Looking for safe inactive tabs…');

  try {
    const response = await send('RUN_OPTIMIZATION');
    const count = response.discarded?.length || 0;
    setResult(
      count
        ? `${count} inactive ${count === 1 ? 'tab' : 'tabs'} unloaded. Chrome reloads them when you return.`
        : response.result?.message || 'Nothing needed to be unloaded.',
      count ? 'success' : ''
    );
    await refresh();
  } catch (error) {
    setResult(error.message, 'error');
  } finally {
    setBusy(false);
  }
});

$('#protectButton').addEventListener('click', async () => {
  if (!dashboard?.currentSite.host) return;
  const protectedNow = dashboard.currentSite.protected;
  try {
    await send(protectedNow ? 'UNPROTECT_HOST' : 'PROTECT_HOST', { host: dashboard.currentSite.host });
    setResult(protectedNow ? 'Current site can be optimized again.' : 'Current site is now protected.', 'success');
    await refresh();
  } catch (error) {
    setResult(error.message, 'error');
  }
});

$('#openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());

refresh();
setInterval(() => {
  if (!busy) refresh();
}, 5000);
