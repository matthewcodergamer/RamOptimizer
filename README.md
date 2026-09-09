# RamOptimizer

A lightweight Chrome extension for MacBooks, laptops, and desktops that keeps Chrome responsive by watching real system memory pressure and safely unloading inactive tabs.

RamOptimizer does **not** pretend to clear macOS or Windows RAM directly. It uses Chrome's supported extension APIs to make better tab-management decisions and lets Chrome reclaim the resources from tabs it safely discards.

## What V1 does

- Reads real physical-memory capacity and available memory with `chrome.system.memory`.
- Checks memory pressure every two minutes with a Manifest V3 service worker.
- Uses Balanced, Smart, and Maximum Saver policies.
- Scores inactive tabs using age, duplicate URLs, tab groups, and safety state.
- Never intentionally unloads active, pinned, audible, loading, non-discardable, internal, or user-protected tabs.
- Keeps unloaded tabs in the tab strip; Chrome reloads them when selected.
- One-click **Optimize now** action.
- Per-site protection from the popup and settings page.
- Duplicate-tab sleeper that unloads older duplicate copies without closing them.
- Local-only statistics and settings.
- No framework, cloud backend, analytics SDK, content injection, or page tracking.

## Download from GitHub Actions

Every push to `main` creates a downloadable extension artifact automatically.

1. Open the repository's **Actions** tab.
2. Open the latest successful **Build RamOptimizer** run.
3. Scroll to **Artifacts**.
4. Download `RamOptimizer-v1.0.0` (the version number follows `manifest.json`).
5. Unzip the downloaded artifact.
6. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the unzipped folder containing `manifest.json`.

The workflow validates the manifest and JavaScript syntax before publishing the artifact.

## Versioned releases

Pushing a Git tag such as `v1.0.0` runs the same validation and automatically creates a GitHub Release containing `RamOptimizer-v1.0.0.zip`.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder containing `manifest.json`.
6. Pin **RamOptimizer** from Chrome's Extensions menu.

The extension is designed to work directly from the repository; there is no build command.

## Modes

| Mode | Auto trigger | Inactive-tab age | Max tabs per cycle |
| --- | ---: | ---: | ---: |
| Balanced | ~88% memory used | ~3 hours | 3 |
| Smart | ~82% memory used | ~1 hour | 6 |
| Maximum Saver | ~75% memory used | ~20 minutes | 10 |

Manual **Optimize now** remains conservative about active/pinned/audio/protected tabs but can consider inactive tabs after a shorter waiting period.

## Permissions

- `system.memory` — reads total and currently available physical memory.
- `tabs` — inspects tab state and asks Chrome to discard safe inactive tabs.
- `storage` — saves extension preferences and local statistics.
- `alarms` — schedules low-overhead memory checks while Chrome is running.

RamOptimizer has no host permissions and does not inject scripts into websites.

## Architecture

- `background.js` — memory-pressure engine, safe tab scoring, alarms, storage, and toolbar badge.
- `popup.html` / `popup.css` / `popup.js` — compact extension popup.
- `options.html` / `options.css` / `options.js` — full settings and protected-site management.
- `.github/workflows/build-extension.yml` — validates, packages, uploads Actions artifacts, and publishes tagged releases.
- `icons/ram.svg` — editable source icon.
- `icons/ram-128.png` — Chrome toolbar/extension icon.

## Safety model

A tab is excluded from optimization when it is active, pinned, audible, currently loading, already discarded, marked non-discardable by Chrome, not an HTTP(S) page, or matches a protected hostname. Tab state can change between scoring and discard, so every discard is also wrapped defensively and failed candidates are skipped.

## Next useful additions

Future versions can add workspace-aware protection, optional conservative request blocking, richer pressure history, and a native companion if true per-process macOS memory statistics are ever needed. Those features should stay optional so the optimizer itself remains lightweight.
