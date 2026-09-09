# Privacy

RamOptimizer is designed to work locally inside Chrome.

- No account is required.
- No analytics or telemetry SDK is included.
- No browsing data is sent to a remote server.
- No content scripts are injected into websites.
- No host permissions are requested.
- Preferences, protected hostnames, and optimization statistics are stored with `chrome.storage.local` on the local Chrome profile.

The extension reads tab metadata such as URL, active/pinned/audible/discarded state, and last-access time because that information is necessary to decide which tabs are safe candidates for Chrome's tab-discard API.
