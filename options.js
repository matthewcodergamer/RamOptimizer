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
  if (!response?.ok) throw new Error(response?.error || 'Browser Performance Manager could not complete that action.');
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
  const { settings, entitlement } = data;

  $('#enabledToggle').setAttribute('aria-checked', String(settings.enabled));
  $('#modeSelect').value = settings.mode;
  $('#suspendSelect').value = String(settings.autoSuspendMinutes);
  renderPro(data);
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


function formatExpiry(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderPro(data) {
  const { settings, entitlement } = data;
  const active = Boolean(entitlement?.active);
  $('#proStatus').textContent = active
    ? `Pro active · renews/expires ${formatExpiry(entitlement.expiresAt)}`
    : 'Free plan';
  $('#proStatus').className = `pro-status${active ? ' active' : ''}`;
  $('#manageProButton').hidden = !active;
  $('#deactivateLicenseButton').hidden = !active;
  $('#buyProButton').textContent = active ? 'Pro active' : 'Get Pro';

  const proValues = new Set(['5', '10', '15', '180', '360', '720', '1440']);
  [...$('#suspendSelect').options].forEach((option) => {
    option.disabled = proValues.has(option.value) && !active;
  });
  $('#suspendSummary').textContent = active
    ? 'Pro is active: choose any interval from 5 minutes to 24 hours.'
    : 'Free: 30 minutes to 2 hours. Pro unlocks 5 minutes through 24 hours.';
  $('#quietEnabled').checked = Boolean(settings.quietHours?.enabled);
  $('#quietStart').value = settings.quietHours?.start || '22:00';
  $('#quietEnd').value = settings.quietHours?.end || '07:00';
  $('#quietEnabled').disabled = !active;
  $('#quietStart').disabled = !active;
  $('#quietEnd').disabled = !active;

  const history = settings.performanceHistory || [];
  $('#historyPoints').textContent = history.length;
  if (history.length) {
    const values = history.map((point) => Number(point.usedPercent) || 0);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    $('#historyPeak').textContent = `${Math.max(...values).toFixed(1)}%`;
    $('#historyAverage').textContent = `${average.toFixed(1)}%`;
  } else {
    $('#historyPeak').textContent = '—';
    $('#historyAverage').textContent = '—';
  }

  const snapshots = settings.snapshots || [];
  const list = $('#snapshotList');
  list.textContent = '';
  $('#snapshotEmpty').hidden = snapshots.length > 0;
  list.hidden = snapshots.length === 0;
  snapshots.slice().reverse().forEach((snapshot) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${snapshot.name} · ${snapshot.tabs.length} tabs`;
    const actions = document.createElement('span');
    actions.className = 'snapshot-actions';
    const restore = document.createElement('button');
    restore.textContent = 'Restore';
    restore.type = 'button';
    restore.addEventListener('click', () => runSnapshotAction('RESTORE_SNAPSHOT', snapshot.id));
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.type = 'button';
    remove.addEventListener('click', () => runSnapshotAction('DELETE_SNAPSHOT', snapshot.id));
    actions.append(restore, remove);
    item.append(label, actions);
    list.append(item);
  });
}

async function refreshPro() {
  await refresh();
}

$('#suspendSelect').addEventListener('change', async (event) => {
  try {
    await send('SET_AUTO_SUSPEND', { minutes: Number(event.target.value) });
    setStatus('Suspension interval saved', 'success');
    await refreshPro();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

async function saveQuietHours() {
  try {
    await send('SET_QUIET_HOURS', {
      quietHours: {
        enabled: $('#quietEnabled').checked,
        start: $('#quietStart').value,
        end: $('#quietEnd').value
      }
    });
    setStatus('Quiet hours saved', 'success');
    await refreshPro();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

$('#quietEnabled').addEventListener('change', saveQuietHours);
$('#quietStart').addEventListener('change', saveQuietHours);
$('#quietEnd').addEventListener('change', saveQuietHours);

$('#buyProButton').addEventListener('click', () => {
  if (typeof BPM_BILLING_URL === 'string' && BPM_BILLING_URL) {
    chrome.tabs.create({ url: BPM_BILLING_URL });
  } else {
    setStatus('Billing is not configured yet. Connect your Stripe checkout to BPM_BILLING_URL.', 'error');
  }
});

$('#manageProButton').addEventListener('click', () => {
  if (typeof BPM_BILLING_URL === 'string' && BPM_BILLING_URL) {
    chrome.tabs.create({ url: BPM_BILLING_URL });
  } else {
    setStatus('Billing is not configured yet.', 'error');
  }
});

$('#activateLicenseButton').addEventListener('click', async () => {
  const token = $('#licenseInput').value.trim();
  if (!token) {
    setStatus('Paste your Pro license first.', 'error');
    return;
  }
  try {
    await send('ACTIVATE_LICENSE', { token });
    $('#licenseInput').value = '';
    setStatus('Pro activated on this device.', 'success');
    await refreshPro();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

$('#deactivateLicenseButton').addEventListener('click', async () => {
  try {
    await send('DEACTIVATE_LICENSE');
    setStatus('Pro deactivated on this device.', 'success');
    await refreshPro();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

$('#snapshotForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('#snapshotName').value.trim();
  if (!name) return;
  try {
    await send('SAVE_SNAPSHOT', { name });
    $('#snapshotName').value = '';
    setStatus('Snapshot saved.', 'success');
    await refreshPro();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

async function runSnapshotAction(type, id) {
  try {
    const response = await send(type, { id });
    setStatus(type === 'RESTORE_SNAPSHOT' ? `${response.created} tabs restored.` : 'Snapshot deleted.', 'success');
    await refreshPro();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}
