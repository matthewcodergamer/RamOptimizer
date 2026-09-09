const STORAGE_KEY = 'ramOptimizerSettings';
const ALARM_NAME = 'ram-optimizer-memory-check';

const DEFAULTS = Object.freeze({
  enabled: true,
  mode: 'smart',
  protectedHosts: [],
  stats: {
    cycles: 0,
    tabsDiscarded: 0,
    manualRuns: 0
  },
  lastResult: null
});

const MODES = Object.freeze({
  balanced: {
    label: 'Balanced',
    triggerPercent: 88,
    minimumAgeMinutes: 180,
    maxPerCycle: 3
  },
  smart: {
    label: 'Smart',
    triggerPercent: 82,
    minimumAgeMinutes: 60,
    maxPerCycle: 6
  },
  maximum: {
    label: 'Maximum Saver',
    triggerPercent: 75,
    minimumAgeMinutes: 20,
    maxPerCycle: 10
  }
});

function normalizeSettings(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const stats = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};

  return {
    ...DEFAULTS,
    ...raw,
    mode: MODES[raw.mode] ? raw.mode : DEFAULTS.mode,
    protectedHosts: Array.isArray(raw.protectedHosts)
      ? [...new Set(raw.protectedHosts.map(normalizeHost).filter(Boolean))]
      : [],
    stats: {
      ...DEFAULTS.stats,
      ...stats
    }
  };
}

async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeSettings(stored[STORAGE_KEY]);
}

async function setSettings(next) {
  const normalized = normalizeSettings(next);
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

async function patchSettings(patch) {
  const current = await getSettings();
  return setSettings({ ...current, ...patch });
}

function normalizeHost(input) {
  if (!input || typeof input !== 'string') return '';
  let value = input.trim().toLowerCase();
  if (!value) return '';

  try {
    if (value.includes('://')) value = new URL(value).hostname;
  } catch (_) {
    return '';
  }

  value = value.replace(/^www\./, '').replace(/^\.+|\.+$/g, '');
  if (!value || value.includes('/') || value.includes(' ')) return '';
  return value;
}

function hostFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return normalizeHost(parsed.hostname);
  } catch (_) {
    return '';
  }
}

function hostIsProtected(host, protectedHosts) {
  if (!host) return false;
  return protectedHosts.some((saved) => host === saved || host.endsWith(`.${saved}`));
}

function isNeverDiscard(tab, settings) {
  const host = hostFromUrl(tab.url || tab.pendingUrl || '');

  return Boolean(
    tab.active ||
      tab.pinned ||
      tab.audible ||
      tab.discarded ||
      tab.autoDiscardable === false ||
      tab.status === 'loading' ||
      !host ||
      hostIsProtected(host, settings.protectedHosts)
  );
}

function ageMinutes(tab) {
  const lastAccessed = Number(tab.lastAccessed);
  if (!Number.isFinite(lastAccessed) || lastAccessed <= 0) return 0;
  return Math.max(0, (Date.now() - lastAccessed) / 60000);
}

function pressureLabel(usedPercent) {
  if (usedPercent >= 92) return 'critical';
  if (usedPercent >= 84) return 'high';
  if (usedPercent >= 74) return 'moderate';
  return 'healthy';
}

async function getMemorySnapshot() {
  const info = await chrome.system.memory.getInfo();
  const capacity = Number(info.capacity || 0);
  const available = Number(info.availableCapacity || 0);
  const used = Math.max(0, capacity - available);
  const usedPercent = capacity > 0 ? Math.round((used / capacity) * 1000) / 10 : 0;

  return {
    capacity,
    available,
    used,
    usedPercent,
    pressure: pressureLabel(usedPercent)
  };
}

async function getTabsSnapshot(settings) {
  const tabs = await chrome.tabs.query({});
  let protectedCount = 0;
  let eligibleCount = 0;

  for (const tab of tabs) {
    if (isNeverDiscard(tab, settings)) protectedCount += 1;
    else eligibleCount += 1;
  }

  return {
    total: tabs.length,
    active: tabs.filter((tab) => tab.active).length,
    discarded: tabs.filter((tab) => tab.discarded).length,
    protected: protectedCount,
    eligible: eligibleCount
  };
}

function candidateScore(tab, duplicateUrls) {
  const age = ageMinutes(tab);
  let score = Math.min(age, 720);

  if (duplicateUrls.has(tab.url)) score += 90;
  if (typeof tab.groupId === 'number' && tab.groupId >= 0) score -= 25;
  if (tab.highlighted) score -= 20;

  return score;
}

async function buildCandidates(settings, manual = false) {
  const tabs = await chrome.tabs.query({});
  const mode = MODES[settings.mode];
  const frequency = new Map();

  for (const tab of tabs) {
    if (tab.url) frequency.set(tab.url, (frequency.get(tab.url) || 0) + 1);
  }

  const duplicateUrls = new Set(
    [...frequency.entries()].filter(([, count]) => count > 1).map(([url]) => url)
  );

  const minimumAge = manual ? Math.min(mode.minimumAgeMinutes, 30) : mode.minimumAgeMinutes;

  return tabs
    .filter((tab) => !isNeverDiscard(tab, settings))
    .filter((tab) => ageMinutes(tab) >= minimumAge)
    .map((tab) => ({
      tab,
      score: candidateScore(tab, duplicateUrls),
      ageMinutes: Math.round(ageMinutes(tab))
    }))
    .sort((a, b) => b.score - a.score);
}

function chooseDiscardCount(memory, mode, manual, candidateCount) {
  if (!candidateCount) return 0;
  if (manual) return Math.min(mode.maxPerCycle, candidateCount);
  if (memory.usedPercent < mode.triggerPercent) return 0;

  const pressureOverage = Math.max(0, memory.usedPercent - mode.triggerPercent);
  const desired = 1 + Math.floor(pressureOverage / 3);
  return Math.min(Math.max(1, desired), mode.maxPerCycle, candidateCount);
}

async function discardCandidates(candidates, count) {
  const discarded = [];

  for (const candidate of candidates.slice(0, count)) {
    try {
      const result = await chrome.tabs.discard(candidate.tab.id);
      if (result?.discarded) {
        discarded.push({
          id: candidate.tab.id,
          title: candidate.tab.title || 'Inactive tab',
          host: hostFromUrl(candidate.tab.url || ''),
          ageMinutes: candidate.ageMinutes
        });
      }
    } catch (_) {
      // Tabs can become active/close between scoring and discard. Skip safely.
    }
  }

  return discarded;
}

async function runOptimization({ manual = false, reason = 'automatic' } = {}) {
  const settings = await getSettings();
  const memory = await getMemorySnapshot();
  const mode = MODES[settings.mode];

  if (!settings.enabled && !manual) {
    return { ok: true, skipped: true, skipReason: 'disabled', memory, discarded: [] };
  }

  const candidates = await buildCandidates(settings, manual);
  const discardCount = chooseDiscardCount(memory, mode, manual, candidates.length);

  if (discardCount === 0) {
    const result = {
      timestamp: Date.now(),
      reason,
      discarded: 0,
      beforeUsedPercent: memory.usedPercent,
      message: memory.usedPercent < mode.triggerPercent && !manual
        ? 'Memory pressure is below the current trigger.'
        : 'No safe inactive tabs are old enough to unload.'
    };

    await setSettings({
      ...settings,
      stats: {
        ...settings.stats,
        cycles: settings.stats.cycles + (manual ? 0 : 1),
        manualRuns: settings.stats.manualRuns + (manual ? 1 : 0)
      },
      lastResult: result
    });

    return { ok: true, memory, discarded: [], result };
  }

  const discarded = await discardCandidates(candidates, discardCount);
  const result = {
    timestamp: Date.now(),
    reason,
    discarded: discarded.length,
    beforeUsedPercent: memory.usedPercent,
    message: discarded.length
      ? `${discarded.length} inactive ${discarded.length === 1 ? 'tab was' : 'tabs were'} unloaded.`
      : 'Chrome kept all candidate tabs active.'
  };

  await setSettings({
    ...settings,
    stats: {
      ...settings.stats,
      cycles: settings.stats.cycles + (manual ? 0 : 1),
      manualRuns: settings.stats.manualRuns + (manual ? 1 : 0),
      tabsDiscarded: settings.stats.tabsDiscarded + discarded.length
    },
    lastResult: result
  });

  return { ok: true, memory, discarded, result };
}

async function sleepDuplicateTabs() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  const buckets = new Map();

  // Group every normal web tab first so an active or pinned copy can serve as
  // the keeper while older safe copies are still eligible to be unloaded.
  for (const tab of tabs) {
    const host = hostFromUrl(tab.url || '');
    if (!tab.url || !host) continue;
    if (!buckets.has(tab.url)) buckets.set(tab.url, []);
    buckets.get(tab.url).push(tab);
  }

  const toDiscard = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;

    bucket.sort((a, b) => {
      const aProtected = isNeverDiscard(a, settings) ? 1 : 0;
      const bProtected = isNeverDiscard(b, settings) ? 1 : 0;
      if (aProtected !== bProtected) return bProtected - aProtected;
      return Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0);
    });

    const [, ...duplicates] = bucket;
    toDiscard.push(...duplicates.filter((tab) => !isNeverDiscard(tab, settings)));
  }

  const discarded = [];
  for (const tab of toDiscard) {
    try {
      const result = await chrome.tabs.discard(tab.id);
      if (result?.discarded) discarded.push(tab.id);
    } catch (_) {}
  }

  if (discarded.length) {
    const refreshed = await getSettings();
    await setSettings({
      ...refreshed,
      stats: {
        ...refreshed.stats,
        tabsDiscarded: refreshed.stats.tabsDiscarded + discarded.length
      },
      lastResult: {
        timestamp: Date.now(),
        reason: 'duplicates',
        discarded: discarded.length,
        message: `${discarded.length} duplicate ${discarded.length === 1 ? 'tab was' : 'tabs were'} unloaded.`
      }
    });
  }

  return { ok: true, discarded: discarded.length };
}

async function getDashboard() {
  const settings = await getSettings();
  const [memory, tabs, activeTabs] = await Promise.all([
    getMemorySnapshot(),
    getTabsSnapshot(settings),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]);

  const active = activeTabs[0];
  const currentHost = hostFromUrl(active?.url || '');

  return {
    settings,
    modeConfig: MODES[settings.mode],
    memory,
    tabs,
    currentSite: {
      host: currentHost,
      protected: hostIsProtected(currentHost, settings.protectedHosts)
    }
  };
}

async function setBadgeFromMemory() {
  try {
    const settings = await getSettings();
    if (!settings.enabled) {
      await chrome.action.setBadgeText({ text: 'OFF' });
      await chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
      return;
    }

    const memory = await getMemorySnapshot();
    if (memory.pressure === 'critical') {
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#b42318' });
    } else if (memory.pressure === 'high') {
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#b54708' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (_) {}
}

async function ensureInitialized() {
  const current = await getSettings();
  await setSettings(current);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 2 });
  await setBadgeFromMemory();
}

chrome.runtime.onInstalled.addListener(() => {
  ensureInitialized();
});

chrome.runtime.onStartup.addListener(() => {
  ensureInitialized();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  runOptimization({ reason: 'memory-pressure-check' })
    .catch(() => null)
    .finally(() => setBadgeFromMemory());
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'optimize-now') {
    runOptimization({ manual: true, reason: 'keyboard-shortcut' })
      .catch(() => null)
      .finally(() => setBadgeFromMemory());
  }
});

chrome.tabs.onRemoved.addListener(() => setBadgeFromMemory());
chrome.tabs.onActivated.addListener(() => setBadgeFromMemory());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'GET_DASHBOARD':
        return { ok: true, data: await getDashboard() };

      case 'RUN_OPTIMIZATION':
        return await runOptimization({ manual: true, reason: 'manual' });

      case 'SET_ENABLED': {
        const settings = await patchSettings({ enabled: Boolean(message.enabled) });
        await setBadgeFromMemory();
        return { ok: true, settings };
      }

      case 'SET_MODE': {
        if (!MODES[message.mode]) throw new Error('Unknown optimizer mode.');
        const settings = await patchSettings({ mode: message.mode });
        return { ok: true, settings };
      }

      case 'PROTECT_HOST': {
        const host = normalizeHost(message.host);
        if (!host) throw new Error('Enter a valid website hostname.');
        const settings = await getSettings();
        const protectedHosts = [...new Set([...settings.protectedHosts, host])].sort();
        return { ok: true, settings: await patchSettings({ protectedHosts }) };
      }

      case 'UNPROTECT_HOST': {
        const host = normalizeHost(message.host);
        const settings = await getSettings();
        const protectedHosts = settings.protectedHosts.filter((saved) => saved !== host);
        return { ok: true, settings: await patchSettings({ protectedHosts }) };
      }

      case 'SLEEP_DUPLICATES':
        return await sleepDuplicateTabs();

      case 'RESET_STATS': {
        const settings = await getSettings();
        return {
          ok: true,
          settings: await setSettings({
            ...settings,
            stats: { ...DEFAULTS.stats },
            lastResult: null
          })
        };
      }

      default:
        return { ok: false, error: 'Unknown request.' };
    }
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error?.message || 'RamOptimizer error.' }));

  return true;
});
