# X Bot Cleaner - Debugging Guide

## 🐛 Debug Logging System

Comprehensive debug logging system has been added to the extension. Console.log messages are found at all critical points.

## 📍 Log Categories

### 1. **Background Script Logs** (`[X Bot Cleaner - BG]`)

The following events are logged in the background script:

```
[X Bot Cleaner - BG] 🚀 Background script initialized
[X Bot Cleaner - BG] 👂 Event listeners registered successfully
[X Bot Cleaner - BG] 🔄 webNavigation.onHistoryStateUpdated triggered
[X Bot Cleaner - BG] 🔄 tabs.onUpdated triggered
[X Bot Cleaner - BG] 📍 Route change detected
[X Bot Cleaner - BG] 📤 Sending message to tab
[X Bot Cleaner - BG] ✅ Message sent successfully
[X Bot Cleaner - BG] ❌ Failed to send message
[X Bot Cleaner - BG] 🖱️ Extension icon clicked
[X Bot Cleaner - BG] 🎯 Toggling panel
```

**Opening Background Console:**

1. Go to `chrome://extensions` page
2. Enable Developer mode
3. Click **"Inspect views service worker"** link in X Bot Cleaner extension
4. Background console will open

### 2. **Content Script Logs** (`[X Bot Cleaner - CS]`)

The following events are logged in the content script entry point:

```
[X Bot Cleaner - CS] 🚀 Content script starting...
[X Bot Cleaner - CS] 📍 Current URL
[X Bot Cleaner - CS] 📦 Loading controller module...
[X Bot Cleaner - CS] ✅ Controller module loaded
[X Bot Cleaner - CS] 🎬 Initializing follower controller...
[X Bot Cleaner - CS] 👂 Setting up Chrome message listener...
[X Bot Cleaner - CS] 📥 Message received
[X Bot Cleaner - CS] 🔄 Route change message detected
[X Bot Cleaner - CS] 📞 Calling handleChromeRouteChange...
[X Bot Cleaner - CS] ✅ Chrome message listener registered
[X Bot Cleaner - CS] 🎉 Content script initialized
```

**Opening Content Script Console:**

1. Go to X.com or Twitter.com page
2. Open DevTools with F12 or Cmd+Option+I
3. Select Console tab

### 3. **Controller Logs** (`[X Bot Cleaner - Controller]`)

The following events are logged in the controller:

```
[X Bot Cleaner - Controller] 🎬 initFollowerController called
[X Bot Cleaner - Controller] ✅ Controller initialization started
[X Bot Cleaner - Controller] 👂 Event listeners registered
[X Bot Cleaner - Controller] 🔄 handleRouteChange triggered
[X Bot Cleaner - Controller] 📍 Current pathname
[X Bot Cleaner - Controller] 🔍 Is followers page active
[X Bot Cleaner - Controller] ✅ On followers page, initializing...
[X Bot Cleaner - Controller] 📥 handleChromeRouteChange called
[X Bot Cleaner - Controller] 🔍 Comparing URLs
[X Bot Cleaner - Controller] ✅ Route change detected
[X Bot Cleaner - Controller] 🎉 Controller initialization complete!
```

## 🔍 Debug Scenarios

### Scenario 1: Extension Loading

**Expected Log Sequence:**

1. **Background Console:**

```
[X Bot Cleaner - BG] 🚀 Background script initialized
[X Bot Cleaner - BG] 👂 Event listeners registered successfully
```

2. **Content Script Console (on X.com/Twitter.com page):**

```
[X Bot Cleaner - CS] 🚀 Content script starting...
[X Bot Cleaner - CS] 📍 Current URL: https://x.com/...
[X Bot Cleaner - CS] 📦 Loading controller module...
[X Bot Cleaner - CS] ✅ Controller module loaded
[X Bot Cleaner - CS] 🎬 Initializing follower controller...
[X Bot Cleaner - Controller] 🎬 initFollowerController called
[X Bot Cleaner - Controller] ✅ Controller initialization started
[X Bot Cleaner - Controller] 👂 Event listeners registered
[X Bot Cleaner - Controller] 🔄 handleRouteChange triggered
[X Bot Cleaner - Controller] 🎉 Controller initialization complete!
[X Bot Cleaner - CS] ✅ Chrome message listener registered
[X Bot Cleaner - CS] 🎉 Content script initialized
```

### Scenario 2: SPA Route Change (Profile → Followers)

**Expected Log Sequence:**

1. **Background Console:**

```
[X Bot Cleaner - BG] 🔄 webNavigation.onHistoryStateUpdated triggered: {...}
[X Bot Cleaner - BG] 📍 Route change detected: {
  tabId: 123,
  url: "https://x.com/username/followers",
  method: "historyStateUpdated",
  isSupportedUrl: true
}
[X Bot Cleaner - BG] 📤 Sending message to tab 123: {...}
[X Bot Cleaner - BG] ✅ Message sent successfully to tab 123
```

2. **Content Script Console:**

```
[X Bot Cleaner - CS] 📥 Message received: {
  message: "route_changed",
  url: "https://x.com/username/followers",
  method: "historyStateUpdated",
  ...
}
[X Bot Cleaner - CS] 🔄 Route change message detected
[X Bot Cleaner - CS] 📞 Calling handleChromeRouteChange...
[X Bot Cleaner - Controller] 📥 handleChromeRouteChange called: {...}
[X Bot Cleaner - Controller] 🔍 Comparing URLs: {
  receivedUrl: "https://x.com/username/followers",
  currentUrl: "https://x.com/username/followers",
  areEqual: true/false
}
[X Bot Cleaner - Controller] ✅ Route change detected via historyStateUpdated
[X Bot Cleaner - Controller] ⏳ Scheduling handleRouteChange in 100ms...
[X Bot Cleaner - Controller] 🎬 Executing handleRouteChange...
[X Bot Cleaner - Controller] 📍 Current URL at execution: https://x.com/username/followers
[X Bot Cleaner - Controller] 🔄 handleRouteChange triggered
[X Bot Cleaner - Controller] ✅ On followers page, initializing...
[X Bot Cleaner - Controller] ✅ Route change handling complete
```

### Scenario 3: Page Reload

**Expected Log Sequence:**

1. **Background Console:**

```
[X Bot Cleaner - BG] 🔄 tabs.onUpdated triggered: {
  tabId: 123,
  changeInfo: { url: "https://x.com/..." },
  tabUrl: "https://x.com/..."
}
[X Bot Cleaner - BG] 📍 Route change detected
[X Bot Cleaner - BG] 📤 Sending message to tab 123
```

2. **Content Script Console (new load):**

```
[X Bot Cleaner - CS] 🚀 Content script starting...
... (full initialization sequence)
```

## ❌ Common Issues and Solutions

### Issue 1: Background Logs Not Visible

**Reason:** Background console is not open

**Solution:**

1. `chrome://extensions` → Developer mode ON
2. X Bot Cleaner → "Inspect views service worker"
3. Check Console tab

### Issue 2: Content Script Logs Not Visible

**Reason:** Extension not injected yet or page not supported

**Solution:**

1. Make sure you are on X.com or Twitter.com page
2. Refresh the page (F5)
3. Search for `[X Bot Cleaner - CS]` in console

### Issue 3: Route Change Message Not Coming

**Reason:** Permissions might be missing

**Check:**

```javascript
// manifest.js should contain:
permissions: ['storage', 'activeTab', 'webNavigation', 'tabs'];
```

**Solution:**

1. Remove extension
2. Reload
3. Approve permissions

### Issue 4: URL Changes But handleRouteChange Not Working

**Debug Steps:**

1. **Is message being sent from background?**
   - `📤 Sending message` should appear in background console

2. **Is content script receiving the message?**
   - `📥 Message received` should appear in content console

3. **Is URL comparison correct?**
   - Check `🔍 Comparing URLs` log
   - If `areEqual: true`, URL hasn't changed

4. **Is setTimeout triggering?**
   - After `⏳ Scheduling handleRouteChange`
   - `🎬 Executing handleRouteChange` should appear after 100ms

## 🔧 Advanced Debugging

### Chrome DevTools Network Tab

To see Background → Content messaging:

1. Open content script console
2. Network tab → Filter by **Type: Other**
3. Change route
4. Check `chrome-extension://...` requests

### Chrome Extension Event Debugging

1. `chrome://extensions` → X Bot Cleaner → Details
2. See all active views under "Inspect views"
3. Each view has separate console

### Storage Debugging

```javascript
// Run in console:
chrome.storage.local.get(null, (data) => console.log(data));
```

## 📊 Log Emoji Reference

| Emoji | Meaning                  |
| ----- | ------------------------ |
| 🚀    | Initialization started   |
| ✅    | Operation successful     |
| ❌    | Error occurred           |
| ⚠️    | Warning                  |
| 📍    | Location/URL information |
| 🔄    | Route change             |
| 📥    | Message received         |
| 📤    | Message sent             |
| 👂    | Event listener set up    |
| 🎬    | Operation started        |
| 🔍    | Checking/Searching       |
| ⏳    | Timing/Waiting           |
| 🎉    | Successfully completed   |
| 🖱️    | User interaction         |
| 🎯    | Target operation         |
| 📦    | Module loading           |
| 🌍    | Global variable          |
| 📑    | Tab information          |

## 🧪 Test Checklist

Follow these steps when testing the extension:

- [ ] Background console is open and logs are visible
- [ ] Content console is open and logs are visible
- [ ] Extension shows initialization logs when first loaded
- [ ] Route change triggers on Profile → Followers transition
- [ ] Teardown logs appear on Followers → Profile transition
- [ ] Extension reinitializes after page reload
- [ ] handleRouteChange triggers with 100ms timeout on URL change
- [ ] Background → Content messaging is working

---

## 💡 Tips

1. **Use Console Filter:** Filter only extension logs by typing `[X Bot Cleaner` in console
2. **Preserve Log:** Enable "Preserve log" option in DevTools Settings → Console
3. **Verbose Level:** Enable "Verbose" option in console settings
4. **Background Console:** Service worker may go to sleep mode, trigger an event to reactivate (refresh page or change route)

---

With this documentation, you can track every step of the extension and identify issues! 🎯
