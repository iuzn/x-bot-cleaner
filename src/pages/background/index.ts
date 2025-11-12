// /pages/background/index.ts
import reloadOnUpdate from 'virtual:reload-on-update-in-background-script';
import 'webextension-polyfill';

reloadOnUpdate('pages/background');
reloadOnUpdate('pages/content/style.scss');

const SUPPORTED_HOSTS = [
  /^https:\/\/(?:[\w-]+\.)?x\.com(?:\/|$)/i,
  /^https:\/\/(?:[\w-]+\.)?twitter\.com(?:\/|$)/i,
];

function isSupportedUrl(url?: string | null) {
  if (!url) return false;
  return SUPPORTED_HOSTS.some(pattern => pattern.test(url));
}

async function togglePanel(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      message: 'browser_action_clicked',
    });
  } catch (error) {
    console.error('[X Bot Cleaner] Unable to toggle panel', error);
  }
}

chrome.action.onClicked.addListener(async () => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) {
      console.error('[X Bot Cleaner] No active tab found');
      return;
    }

    if (!isSupportedUrl(tab.url)) {
      console.warn('[X Bot Cleaner] Action only works on x.com/twitter.com');
      return;
    }

    await togglePanel(tab.id);
  } catch (error) {
    console.error('[X Bot Cleaner] Error handling browser action', error);
  }
});

export {};
