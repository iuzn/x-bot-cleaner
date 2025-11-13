# Chrome Web Store Privacy Form - X Bot Cleaner

## Single Purpose Description (1000 character limit)

X Bot Cleaner is a Chrome extension that helps users manually identify and remove bot followers from their X (Twitter) accounts. The extension provides tools to classify followers as "Real" or "Bot" through manual user actions, capture follower profiles for review, and bulk remove bot-marked accounts. All data processing happens locally in the user's browser. The extension only interacts with X/Twitter's interface when the user explicitly triggers actions such as marking followers or removing bots. No automatic detection or external data processing occurs.

---

## Permission Justifications

### storage justification (1000 character limit)

The storage permission is required to save user classifications and preferences locally in the browser. The extension stores:

- Lists of usernames marked as "Real" or "Bot" by the user
- User preferences (visibility filter settings)
- Captured follower profile data (username, display name, avatar URL, bio, verification status)
- Timestamps for last bulk removal operation

All data is stored locally using Chrome's local storage API and never transmitted to external servers. This allows the extension to persist user classifications across browser sessions and provide a seamless experience when reviewing followers.

---

### activeTab justification (1000 character limit)

The activeTab permission is required to enable the extension's browser action functionality. When users click the extension icon, the extension needs to:

- Query the currently active tab to check if it's an X/Twitter followers page
- Send messages to the content script on the active tab to toggle the control panel visibility
- Ensure the extension only activates on supported X/Twitter pages

This permission provides temporary access to the active tab only when the user explicitly clicks the extension icon, ensuring minimal permission usage while maintaining functionality.

---

### webNavigation justification (1000 character limit)

The webNavigation permission is required to detect Single Page Application (SPA) route changes on X/Twitter pages. X/Twitter uses client-side routing (pushState/replaceState) for navigation between pages without full page reloads. The extension needs to:

- Detect when users navigate between different X/Twitter pages (profile → followers, followers → profile, etc.)
- Automatically reinitialize the extension's UI components when entering followers pages
- Track navigation events to update follower classification buttons and visibility filters

This permission is used only for route change detection and does not access or modify browsing history. All navigation data processing happens locally in the browser.

---

### tabs justification (1000 character limit)

The tabs permission is required for two specific purposes related to SPA navigation tracking:

- Detect tab URL updates that occur during page redirects, reloads, or external navigation
- Complement webNavigation events for comprehensive route change detection on X/Twitter pages

When combined with webNavigation, this ensures the extension reliably detects all types of navigation on X/Twitter's SPA architecture. The permission is used only to monitor URL changes on supported domains and does not access tab content or browsing history.

---

### Host Permission Justification (1000 character limit)

Host permissions for x.com and twitter.com are required because:

- The extension injects content scripts into X/Twitter follower pages to add classification buttons next to each follower
- The extension needs to interact with X/Twitter's DOM to capture follower profile data (display names, avatars, bios, verification status)
- The extension automates user interactions with X/Twitter's interface to remove followers when the user explicitly triggers bulk removal
- All interactions only occur on follower pages (https://x.com/*/followers or https://twitter.com/*/followers)

The extension does not access any other websites or domains. All data processing happens locally in the browser, and no data is sent to external servers.

---

## Remote Code

**Answer: No, I am not using Remote code**

Justification: All JavaScript code is bundled and included in the extension package. No external scripts are loaded from remote servers, no eval() is used, and no dynamic code execution occurs. All code is static and included in the extension's package.

---

## Data Usage

### What user data do you plan to collect from users?

**Selected:**

- ✅ **Website content** - The extension reads follower profile information (display names, usernames, avatars, bios, verification status) from X/Twitter pages to enable classification and review features.

**NOT Selected (not collected):**

- ❌ Personally identifiable information
- ❌ Health information
- ❌ Financial and payment information
- ❌ Authentication information
- ❌ Personal communications
- ❌ Location
- ❌ Web history
- ❌ User activity

### Data Collection Details

**Website Content Collected:**

- Follower usernames (publicly visible on X/Twitter)
- Follower display names (publicly visible)
- Follower avatar URLs (publicly visible)
- Follower bio text (publicly visible)
- Verification status (publicly visible)

**How it's used:**

- Stored locally in browser storage for user's classification workflow
- Displayed in the extension's UI for review and classification
- Used to identify followers when performing bulk removal operations

**Storage:**

- All data is stored locally using Chrome's local storage API
- Data never leaves the user's browser
- Optional Chrome sync may sync data across user's devices if enabled

**Data Sharing:**

- No data is shared with third parties
- No data is sent to external servers
- No analytics or tracking is performed

---

## Certifications

✅ **I do not sell or transfer user data to third parties, outside of the approved use cases**

✅ **I do not use or transfer user data for purposes that are unrelated to my item's single purpose**

✅ **I do not use or transfer user data to determine creditworthiness or for lending purposes**

---

## Privacy Policy URL

**Note:** You need to create and host a privacy policy page. Suggested content:

```
https://your-domain.com/privacy-policy
```

Or if using GitHub Pages:

```
https://your-username.github.io/x-bot-cleaner/privacy-policy
```

### Privacy Policy Template Content:

**X Bot Cleaner - Privacy Policy**

**Last Updated:** [Date]

**Data Collection:**
X Bot Cleaner collects follower profile information (usernames, display names, avatars, bios, verification status) from X/Twitter pages you visit. This data is collected only when you use the extension on follower pages.

**Data Storage:**
All data is stored locally in your browser using Chrome's local storage API. No data is transmitted to external servers.

**Data Usage:**

- Your classifications (Real/Bot labels) are stored locally
- Follower profile data is stored for review purposes
- Data may sync across your devices if Chrome sync is enabled

**Data Sharing:**
We do not sell, share, or transfer your data to third parties. No data is sent to external servers.

**Your Rights:**
You can clear all stored data at any time using the extension's reset feature. Uninstalling the extension will remove all locally stored data.

**Contact:**
[Your contact information]
