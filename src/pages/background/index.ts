// /pages/background/index.ts
import reloadOnUpdate from 'virtual:reload-on-update-in-background-script';
import 'webextension-polyfill';

reloadOnUpdate('pages/background');
reloadOnUpdate('pages/content/style.scss');

// console.log('[X Bot Cleaner - BG] 🚀 Background script initialized');

const SUPPORTED_HOSTS = [
  /^https:\/\/(?:[\w-]+\.)?x\.com(?:\/|$)/i,
  /^https:\/\/(?:[\w-]+\.)?twitter\.com(?:\/|$)/i,
];

function isSupportedUrl(url?: string | null) {
  if (!url) return false;
  return SUPPORTED_HOSTS.some(pattern => pattern.test(url));
}

// Helper function to detect SPA route changes
async function notifyRouteChange(
  tabId: number,
  url: string,
  method: 'historyStateUpdated' | 'tabUpdated',
) {
  // console.log(`[X Bot Cleaner - BG] 📍 Route change detected:`, {
  //   tabId,
  //   url,
  //   method,
  //   isSupportedUrl: isSupportedUrl(url),
  // });

  if (!isSupportedUrl(url)) {
    // console.log('[X Bot Cleaner - BG] ⚠️ URL not supported, skipping');
    return;
  }

  try {
    const message = {
      message: 'route_changed',
      url,
      method,
      timestamp: Date.now(),
    };

    // console.log(`[X Bot Cleaner - BG] 📤 Sending message to tab ${tabId}:`, message);

    await chrome.tabs.sendMessage(tabId, message);

    // console.log(`[X Bot Cleaner - BG] ✅ Message sent successfully to tab ${tabId}`);
  } catch (error) {
    // Critical error: Could not send message to content script
    console.error(`[X Bot Cleaner - BG] ❌ Failed to send route change message to tab ${tabId}:`, error);
    // Content script may not be loaded yet or tab may be closed
    // This is a normal situation
  }
}

// Detect route changes made with History API (pushState, replaceState)
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  // console.log('[X Bot Cleaner - BG] 🔄 webNavigation.onHistoryStateUpdated triggered:', details);
  void notifyRouteChange(details.tabId, details.url, 'historyStateUpdated');
});

// Detect tab URL updates (reload, redirect, etc.)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.url) {
    // console.log('[X Bot Cleaner - BG] 🔄 tabs.onUpdated triggered:', {
    //   tabId,
    //   changeInfo,
    //   tabUrl: tab.url,
    // });
    void notifyRouteChange(tabId, changeInfo.url, 'tabUpdated');
  }
});

// console.log('[X Bot Cleaner - BG] 👂 Event listeners registered successfully');

async function togglePanel(tabId: number) {
  try {
    // console.log(`[X Bot Cleaner - BG] 🎯 Toggling panel for tab ${tabId}`);
    await chrome.tabs.sendMessage(tabId, {
      message: 'browser_action_clicked',
    });
    // console.log(`[X Bot Cleaner - BG] ✅ Panel toggle message sent`);
  } catch (error) {
    console.error(`[X Bot Cleaner - BG] Unable to toggle panel for tab ${tabId}:`, error);
  }
}

chrome.action.onClicked.addListener(async () => {
  try {
    // console.log('[X Bot Cleaner - BG] 🖱️ Extension icon clicked');

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    // console.log('[X Bot Cleaner - BG] 📑 Active tab:', tab);

    if (!tab?.id) {
      console.error('[X Bot Cleaner - BG] ❌ No active tab found');
      return;
    }

    if (!isSupportedUrl(tab.url)) {
      console.warn('[X Bot Cleaner - BG] ⚠️ Action only works on x.com/twitter.com. Current URL:', tab.url);
      return;
    }

    await togglePanel(tab.id);
  } catch (error) {
    console.error('[X Bot Cleaner - BG] ❌ Error handling browser action:', error);
  }
});

export {};
