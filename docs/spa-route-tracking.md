# SPA Route Tracking Implementation

## Overview

SPA (Single Page Application) dynamic route change detection feature has been integrated into the X Bot Cleaner extension using Chrome Extension APIs.

## Architecture

### 1. Background Script (`src/pages/background/index.ts`)

Background script detects route changes using two different Chrome APIs:

- **`chrome.webNavigation.onHistoryStateUpdated`**: Catches client-side route changes made with History API (pushState, replaceState)
- **`chrome.tabs.onUpdated`**: Catches URL changes at tab level (redirect, reload, etc.)

When either event is triggered, background script sends a message to content script:

```typescript
{
  message: 'route_changed',
  url: string,
  method: 'historyStateUpdated' | 'tabUpdated',
  timestamp: number
}
```

### 2. Content Script Entry Point (`src/pages/content/ui/index.ts`)

Content script listens for Chrome runtime messages and catches `route_changed` messages:

```typescript
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.message === 'route_changed' && message.url && message.method) {
    controllerModule.handleChromeRouteChange(message.url, message.method);
  }
  return false;
});
```

### 3. Controller (`src/pages/content/followers/controller.ts`)

Controller contains a new public export function: `handleChromeRouteChange(url, method)`

This function:

- Checks if URL has actually changed
- If changed, triggers `handleRouteChange()` function after a short delay (100ms)
- This delay allows the browser to update the URL

## Permissions (manifest.js)

The following permissions have been added:

```javascript
permissions: ['storage', 'activeTab', 'webNavigation', 'tabs'];
```

## Advantages

1. **Reliable Detection**: All SPA route changes are caught using Chrome's native APIs
2. **Framework Agnostic**: Works with React Router, Vue Router, Angular Router or custom navigation systems
3. **Backward Compatible**: Existing `locationchange` and `popstate` event listeners are preserved
4. **Performant**: No polling thanks to event-driven architecture
5. **Type-Safe**: TypeScript structure is maintained

## Test Scenarios

To test the extension:

1. Log in to X.com or Twitter.com
2. Load the extension (`chrome://extensions`)
3. Open Developer Console
4. Navigate between different profile pages
5. You should see these logs in console:
   - `[X Bot Cleaner] Route change detected via historyStateUpdated: <url>`
   - `[X Bot Cleaner] Content script initialized with Chrome route tracking`

## Technical Details

### Route Change Flow

```
User navigates
    ↓
Chrome detects change (webNavigation/tabs API)
    ↓
Background script → notifyRouteChange()
    ↓
chrome.tabs.sendMessage() → Content Script
    ↓
chrome.runtime.onMessage.addListener()
    ↓
handleChromeRouteChange() → Controller
    ↓
setTimeout(100ms) → handleRouteChange()
    ↓
Extension UI updates
```

### Duplicate Prevention

URL comparison is done in controller:

```typescript
if (url !== currentUrl) {
  // Only trigger on actual changes
}
```

This prevents multiple triggers for the same URL.

## Future Improvements

- [ ] URL pattern matching to trigger only on relevant routes
- [ ] Add debounce mechanism for optimization in very fast changes
- [ ] Route history tracking (record back/forward navigations)

## Resources

- [Chrome WebNavigation API](https://developer.chrome.com/docs/extensions/reference/webNavigation/)
- [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/tabs/)
- [Message Passing in Chrome Extensions](https://developer.chrome.com/docs/extensions/mv3/messaging/)
