# Testing

## Unit and routing checks

```sh
npm test
npm run check
```

The 48 dependency-free Node tests cover:

- Settings open automatically on first install, not on updates or browser upgrades
- Settings defaults, validation, result limits, and migration of older preferences
- Enabled sources, custom priority, deduplication, and all-disabled behavior
- Disabled sources are not queried
- URL resolution, search engines, and unsafe schemes
- Ranking, query matching, recency, and frequency
- New-tab versus same-tab submission
- Opening either overlay mode does not create or navigate a tab
- Protected pages show a toolbar warning without opening a fallback page
- Source URLs cannot select a different navigation target through query parameters
- Closed source tabs produce an error without opening a substitute tab
- Partial browser API failures
- On-demand injection and toolbar warning reset
- No native new-tab override or launcher files
- HTTP/HTTPS access on all sites, without automatic content scripts
- Browser-protected pages remain unavailable for overlays
- DiArc branding and the supplied rainbow logo before the wordmark
- Keyboard setup appears first with a clickable shortcut-configuration URL
- Optimized square PNGs and matching toolbar/manifest icon paths
- Bounded CSS dimensions, backdrop blur, and safe defaults
- Optional quick actions, custom templates, query encoding, and disabled actions
- Custom action navigation resolves current saved preferences and opens a new tab
- Unsafe templates, credential URLs, and query-controlled hostnames are rejected
- Auto-saving settings with no save button and no edits before preferences load

## Browser regression suite

Requires `agent-browser` on PATH:

```sh
npm run test:browser
```

The suite uses a disposable browser session with the production manifest. It does not attach to a user's test window.

### Settings checks

- Supplied rainbow logo at 80 px, wordmark at 56 px, alignment, a larger subtitle, and section navigation
- Keyboard appears first; the prominent configuration URL opens the actual browser shortcut page
- Centered dropdown chevrons with a 12 px inset on desktop and mobile
- Responsive single-column layout at 390 px without horizontal overflow
- System dark theme
- Source toggles and ordering save without a button
- Keyboard focus follows a reordered source
- Preferences persist after reload
- All sources can be disabled while the typed action remains available
- Empty, fractional, and out-of-range result limits do not replace the last valid value
- Other controls continue to save while a result limit is invalid
- Delayed writes remain serialized and retain the latest value
- A storage error is reported, and a later change can save successfully
- Dimensions and the blur on/off toggle save automatically and survive reload
- Existing numeric blur settings migrate to on/off without losing a disabled setting
- Invalid dimensions retain the last valid value while other settings save
- Built-in and custom actions can be enabled and disabled
- Custom actions can be added, edited, validated, and removed
- Invalid action edits retain the last valid saved template
- Custom action text is encoded in the URL

### Overlay checks

The suite loads the shipped palette over the **existing settings page** as a test harness. It does not navigate to a command page. It exercises the real browser search APIs and stubs navigation to avoid leaving the fixture.

- No suggestions before typing
- No settings, Esc, or mode labels inside the bar
- Opening the overlay does not change the URL or tab count
- Results show enabled quick actions before matches in configured source priority
- The overlay uses the configured width, maximum height, and fixed blur when enabled
- The initial bar remains compact despite its configured maximum height
- Typing and backspace retain visible results while responses are pending
- Search requests debounce to the latest query
- Old rows cannot navigate during a pending search
- Out-of-order responses cannot replace current results
- Clearing input prevents a late response from reopening suggestions
- Enter during loading submits current text rather than an old URL
- Address mode selects the current page URL without initial results
- Submission, Escape, and outside clicks dismiss the overlay and restore focus
- Older worker responses with missing layout preferences use safe defaults instead of throwing
- No browser page errors during these checks

A separate local HTTP fixture checks the real content-script injection bridge. It verifies that HTTP/HTTPS access is granted, pages do not automatically receive an overlay, and the extension can inject and open the bar without a prior toolbar click or active-tab grant. The test server and browser session close after the suite.

Native extension accelerators still need the manual checks below. Dia-specific behavior was not tested directly.

## Manual checks

1. Load the production directory through **Load unpacked**.
2. Open a normal website. Record its URL and the number of tabs.
3. Press **⌥T / Alt+T**. Confirm the overlay appears on that page, without changing its URL or creating a tab.
4. Type a URL and press Enter. Confirm a new tab opens and the source remains unchanged.
5. Return to the source. Press **⌥L / Alt+L**. Confirm the current URL is selected and suggestions are initially hidden.
6. Edit the URL, use the arrow keys, and press Enter. Confirm the same tab navigates.
7. Invoke the overlay again. Test Escape and outside clicks. Confirm the prior page control receives focus.
8. Try a browser-internal page. Confirm no launcher tab or replacement page opens. The toolbar icon should show `!`, with an explanation in its tooltip.
9. Return to a normal website and invoke DiArc. Confirm the warning clears.
10. Right-click the toolbar icon and open Options. Change each setting and the source order. Reload Settings and confirm persistence without a save button.
11. Confirm native **⌘T / Ctrl+T** and **⌘L / Ctrl+L** retain the browser's default behavior.
12. Repeat in Dia or another target Chromium browser. Check extension shortcut settings for conflicts.

A standard extension cannot inject overlays into browser-protected pages or reliably replace reserved native shortcuts.
