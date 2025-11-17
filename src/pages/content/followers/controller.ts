import {
  followerClassificationStorage,
  ensureState,
  normalizeUsername,
} from '@/shared/storages/followerClassificationStorage';
import {
  followerSnapshotStorage,
  ensureSnapshotState,
} from '@/shared/storages/followerSnapshotStorage';
import type {
  BulkRemovalResult,
  FollowerClassificationState,
  FollowerScrapePhase,
  FollowerScrapeStatus,
  FollowerStatus,
  FollowerRemovalStatus,
  FollowerSnapshotEntry,
  FollowerSnapshotState,
  RemovalProgress,
} from '@/types/followers';
import { defaultFollowerScrapeStatus } from '@/types/followers';
import { followerMetricsStore } from '@/pages/content/followers/metricsStore';
import followersWorkspaceStorage from '@/shared/storages/followersWorkspaceStorage';
import {
  ACTION_BUTTON_ATTRIBUTE,
  BUTTON_CONTAINER_ATTRIBUTE,
  HIDDEN_ATTRIBUTE,
  PROCESSED_ATTRIBUTE,
  STATUS_ATTRIBUTE,
  STYLE_TAG_ID,
  USERNAME_ATTRIBUTE,
  USERNAME_LINK_SELECTOR,
  USER_CELL_SELECTOR,
  BUTTON_BASE_CLASS,
} from '@/pages/content/followers/constants';

type RemoveBotsOptions = {
  requireConfirmation?: boolean;
  alertOnFinish?: boolean;
  delayMs?: number;
  onProgress?: (progress: RemovalProgress) => void;
};

type EnsureFollowersOptions = {
  autoStartCapture?: boolean;
  autoStartRemoval?: boolean;
};

const FOLLOWERS_PATH = /\/followers(\/|$)/;
const SUPPORTED_HOST_REGEX = /(?:^|\.)((x|twitter)\.com)$/i;
const BUTTON_ACTIVE_ATTR = 'data-xbc-active';
const DEFAULT_SCRAPE_OPTIONS = {
  scrollDelay: 900,
  idleThreshold: 6,
} as const;
const FOLLOWERS_NAVIGATION_TIMEOUT = 15_000;
const FOLLOWERS_NAVIGATION_POLL_INTERVAL = 300;
const FOLLOWERS_TARGET_RESOLUTION_TIMEOUT = 8_000;
const FOLLOWERS_TARGET_RESOLUTION_INTERVAL = 250;
const REMOVAL_SCROLL_DELAY_MS = 900;
const REMOVAL_SCROLL_MAX_ATTEMPTS = 80;
const RESERVED_ROOT_ROUTES = new Set([
  '',
  'home',
  'explore',
  'notifications',
  'messages',
  'settings',
  'compose',
  'search',
  'connect',
  'lists',
  'topics',
  'i',
  'bookmarks',
  'communities',
  'verified',
  'premium',
  'followers',
  'following',
]);

type StartScrapeOptions = {
  scrollDelay?: number;
  idleThreshold?: number;
};

let initialized = false;
let mutationObserver: MutationObserver | null = null;
let processRaf: number | null = null;
let metricsRaf: number | null = null;
let cachedState: FollowerClassificationState = ensureState();
let cachedSnapshotState: FollowerSnapshotState = ensureSnapshotState();
let realSet = new Set<string>();
let botSet = new Set<string>();
let realHidden = false;
let verifiedHidden = false;
let scrapeStatus: FollowerScrapeStatus = { ...defaultFollowerScrapeStatus };
let scrapeTimer: number | null = null;
let lastSnapshotCount = 0;
let activeScrapeOptions: Required<StartScrapeOptions> = {
  ...DEFAULT_SCRAPE_OPTIONS,
};
let autoRemovalInFlight = false;
let followersNavigationInFlight = false;
let routeChangeDebounceTimer: number | null = null;

export function initFollowerController() {
  // console.log('[X Bot Cleaner - Controller] 🎬 initFollowerController called');
  // console.log('[X Bot Cleaner - Controller] 📍 Initialized:', initialized);
  // console.log('[X Bot Cleaner - Controller] 🌍 Window defined:', typeof window !== 'undefined');

  if (initialized || typeof window === 'undefined') {
    // console.log('[X Bot Cleaner - Controller] ⚠️ Already initialized or window undefined, skipping');
    return;
  }

  initialized = true;
  // console.log('[X Bot Cleaner - Controller] ✅ Controller initialization started');

  followerClassificationStorage
    .get()
    .then((state) => {
      cachedState = ensureState(state);
      syncSetsFromState();
      realHidden = cachedState.preferences.hideRealOnPage;
      verifiedHidden = cachedState.preferences.hideVerifiedOnPage;
      if (isFollowersPageActive()) {
        ensureButtonStyles();
        processFollowers();
        applyRealVisibilityToCells();
        applyVerifiedVisibilityToCells();
        scheduleMetricsUpdate();
      }
    })
    .catch((error) => {
      console.error('[X Bot Cleaner] Failed to load follower state', error);
    });

  followerSnapshotStorage
    .get()
    .then((state) => {
      cachedSnapshotState = ensureSnapshotState(state);
      lastSnapshotCount = cachedSnapshotState.totalCaptured;
      if (isFollowersPageActive()) {
        scheduleMetricsUpdate();
        // Also check for auto capture on initial load
        void checkAndStartAutoCapture();
      }
    })
    .catch((error) => {
      console.error('[X Bot Cleaner] Failed to load follower snapshot', error);
    });

  followerSnapshotStorage.subscribe(() => {
    const snapshot = followerSnapshotStorage.getSnapshot();
    if (!snapshot) return;
    cachedSnapshotState = ensureSnapshotState(snapshot);
    lastSnapshotCount = cachedSnapshotState.totalCaptured;
    scheduleMetricsUpdate();
  });

  followerClassificationStorage.subscribe(() => {
    const snapshot = followerClassificationStorage.getSnapshot();
    if (!snapshot) return;
    cachedState = ensureState(snapshot);
    syncSetsFromState();
    realHidden = cachedState.preferences.hideRealOnPage;
    verifiedHidden = cachedState.preferences.hideVerifiedOnPage;
    syncCellsWithState();
    applyRealVisibilityToCells();
    applyVerifiedVisibilityToCells();
    scheduleMetricsUpdate();
  });

  document.addEventListener('click', handleDelegatedAction, true);
  window.addEventListener('locationchange', handleRouteChange);
  window.addEventListener('popstate', handleRouteChange);
  // console.log('[X Bot Cleaner - Controller] 👂 Event listeners registered');

  // console.log('[X Bot Cleaner - Controller] 🎬 Triggering initial route change...');
  handleRouteChange();

  window.toggleBots = () => toggleRealVisibility();
  window.removeAllBots = () => removeAllBotsFromPage();

  // console.log('[X Bot Cleaner - Controller] 🎉 Controller initialization complete!');
}

/**
 * Public API to trigger route changes from Chrome Extension messages
 * This function is called by the content script entry point
 */
export function handleChromeRouteChange(url: string, method: string) {
  // console.log('[X Bot Cleaner - Controller] 📥 handleChromeRouteChange called:', {
  //   url,
  //   method,
  //   currentUrl: typeof window !== 'undefined' ? window.location.href : 'undefined',
  // });

  if (typeof window === 'undefined') {
    console.warn(
      '[X Bot Cleaner - Controller] Window is undefined, skipping route change',
    );
    return;
  }

  const currentUrl = window.location.href;

  // console.log('[X Bot Cleaner - Controller] 🔍 URL Check:', {
  //   receivedUrl: url,
  //   currentUrl,
  //   areEqual: url === currentUrl,
  // });

  // Process even if URL is the same when Chrome route change message arrives
  // Because DOM or state might have changed (SPA navigation, pushState, etc.)
  // console.log(`[X Bot Cleaner - Controller] 🔄 Processing route change via ${method}: ${url}`);

  // Debounce: If multiple events arrive simultaneously (tabUpdated + historyStateUpdated)
  // only process the last one
  if (routeChangeDebounceTimer !== null) {
    // console.log('[X Bot Cleaner - Controller] ⏸️ Clearing previous debounce timer');
    window.clearTimeout(routeChangeDebounceTimer);
  }

  // Call handleRouteChange with a short delay
  // This allows the browser to fully update the DOM and URL
  // console.log('[X Bot Cleaner - Controller] ⏳ Scheduling handleRouteChange in 200ms (debounced)...');

  routeChangeDebounceTimer = window.setTimeout(() => {
    routeChangeDebounceTimer = null;
    // console.log('[X Bot Cleaner - Controller] 🎬 Executing handleRouteChange (after debounce)...');
    // console.log('[X Bot Cleaner - Controller] 📍 Current URL at execution:', window.location.href);
    // console.log('[X Bot Cleaner - Controller] 📍 Current pathname:', window.location.pathname);
    handleRouteChange();
    // console.log('[X Bot Cleaner - Controller] ✅ handleRouteChange executed');
  }, 200);
}

export async function toggleRealVisibility(force?: boolean) {
  const nextValue =
    typeof force === 'boolean'
      ? force
      : !(cachedState.preferences.hideRealOnPage ?? false);
  await followerClassificationStorage.setHideReal(nextValue);
  realHidden = nextValue;
  applyRealVisibilityToCells();
  scheduleMetricsUpdate();
  return nextValue;
}

export async function toggleBotVisibility(force?: boolean) {
  return toggleRealVisibility(force);
}

export async function toggleVerifiedVisibility(force?: boolean) {
  const nextValue =
    typeof force === 'boolean'
      ? force
      : !(cachedState.preferences.hideVerifiedOnPage ?? false);
  await followerClassificationStorage.setHideVerified(nextValue);
  verifiedHidden = nextValue;
  applyVerifiedVisibilityToCells();
  scheduleMetricsUpdate();
  return nextValue;
}

export async function ensureFollowersPageActive(
  timeoutMs = FOLLOWERS_NAVIGATION_TIMEOUT,
  options: EnsureFollowersOptions = {},
): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  if (isFollowersPageActive()) {
    return true;
  }

  const shouldAutoCapture = Boolean(options.autoStartCapture);
  const shouldAutoRemoval = Boolean(options.autoStartRemoval);

  if (shouldAutoCapture) {
    await followerSnapshotStorage.setAutoStartCapture(true);
  }

  if (shouldAutoRemoval) {
    await followerClassificationStorage.setAutoStartRemoval(true);
  }

  const navigated = await triggerFollowersNavigation();
  if (!navigated) {
    if (shouldAutoCapture) {
      await followerSnapshotStorage.clearAutoStartCapture();
    }
    if (shouldAutoRemoval) {
      await followerClassificationStorage.clearAutoStartRemoval();
    }
    return false;
  }

  return waitForFollowersPage(timeoutMs);
}

export async function startFollowerScrape(
  options?: StartScrapeOptions,
): Promise<void> {
  if (scrapeStatus.phase === 'running') return;
  if (!isFollowersPageActive()) {
    throw new Error('Open your followers list to start the scan.');
  }

  activeScrapeOptions = {
    ...DEFAULT_SCRAPE_OPTIONS,
    ...options,
  } as Required<StartScrapeOptions>;
  lastSnapshotCount = getScrapedFollowersCount();

  await followerSnapshotStorage.markScrapeStart(Date.now());
  updateScrapeStatus({
    phase: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    captured: lastSnapshotCount,
    iterations: 0,
    idleStreak: 0,
    message: undefined,
  });

  scheduleScrapeLoop();
}

export function stopFollowerScrape(
  phase: Extract<FollowerScrapePhase, 'idle' | 'error'> = 'idle',
  message?: string,
) {
  if (scrapeStatus.phase !== 'running') return;
  finalizeScrape(phase, message);
}

export async function removeAllBotsFromPage(
  options?: RemoveBotsOptions,
): Promise<BulkRemovalResult> {
  const targets = Array.from(botSet);
  const startedAt = Date.now();
  const mergedOptions: Required<Omit<RemoveBotsOptions, 'onProgress'>> = {
    requireConfirmation: options?.requireConfirmation ?? true,
    alertOnFinish: options?.alertOnFinish ?? true,
    delayMs: options?.delayMs ?? 1800,
  };

  if (targets.length === 0) {
    return {
      attempted: 0,
      removed: 0,
      failed: 0,
      startedAt,
      finishedAt: Date.now(),
      reports: [],
    };
  }

  if (mergedOptions.requireConfirmation) {
    const confirmed = window.confirm(
      `${targets.length} bots will be removed. Are you sure?`,
    );
    if (!confirmed) {
      return {
        attempted: targets.length,
        removed: 0,
        failed: 0,
        startedAt,
        finishedAt: Date.now(),
        reports: targets.map((username) => ({
          username,
          status: 'skipped' as FollowerRemovalStatus,
          reason: 'User cancelled',
        })),
      };
    }
  }

  const reports: BulkRemovalResult['reports'] = [];
  let removed = 0;
  let failed = 0;
  let completed = 0;
  const pendingTargets = new Set(targets);
  const scroller = getFollowerScrollElement();
  let scrollAttempts = 0;

  while (pendingTargets.size > 0) {
    const visibleBots = getVisibleBotCells(pendingTargets);
    if (
      visibleBots.length === 0 &&
      scroller &&
      scrollAttempts < REMOVAL_SCROLL_MAX_ATTEMPTS
    ) {
      scrollFollowersToBottom(scroller);
      scrollAttempts += 1;
      await sleep(REMOVAL_SCROLL_DELAY_MS);
      continue;
    }

    const entry = visibleBots[0];
    const username =
      entry?.username ?? pendingTargets.values().next().value ?? null;
    if (!username) {
      break;
    }

    const cell = entry?.cell;
    pendingTargets.delete(username);

    options?.onProgress?.({
      total: targets.length,
      completed,
      success: removed,
      failed,
      currentUsername: username,
    });

    const result = await attemptRemoval(username, cell);
    reports.push({ username, ...result });
    if (result.status === 'removed') {
      removed += 1;
      botSet.delete(username);
      try {
        await followerClassificationStorage.removeBot(username);
      } catch (error) {
        console.error('[X Bot Cleaner] Failed to update removed bot state', {
          username,
          error,
        });
      }
    } else if (result.status !== 'skipped') {
      failed += 1;
    }

    completed += 1;
    scrollAttempts = 0;
    scheduleMetricsUpdate();
    await sleep(mergedOptions.delayMs);
  }

  await followerClassificationStorage.set((current) => {
    const state = ensureState(current);
    return {
      ...state,
      botFollowers: Array.from(botSet),
    };
  });
  await followerClassificationStorage.updateLastSweep(Date.now());

  options?.onProgress?.({
    total: targets.length,
    completed: targets.length,
    success: removed,
    failed,
    currentUsername: undefined,
  });

  if (mergedOptions.alertOnFinish) {
    alert('All bots have been removed!');
  }

  return {
    attempted: targets.length,
    removed,
    failed,
    startedAt,
    finishedAt: Date.now(),
    reports,
  };
}

function handleRouteChange() {
  // console.log('[X Bot Cleaner - Controller] 🔄 handleRouteChange triggered');
  // console.log('[X Bot Cleaner - Controller] 📍 Current pathname:', window.location.pathname);
  // console.log('[X Bot Cleaner - Controller] 🔍 Is followers page active:', isFollowersPageActive());

  if (!isFollowersPageActive()) {
    // console.log('[X Bot Cleaner - Controller] ⚠️ Not on followers page, tearing down...');
    teardownObserver();
    stopFollowerScrape('error', 'Followers page closed');
    followerMetricsStore.update({
      isFollowersPage: false,
      totalCells: 0,
      processedCells: 0,
      botsOnPage: 0,
      realOnPage: 0,
      realHidden,
      verifiedHidden,
      scrapedFollowers: getScrapedFollowersCount(),
      profileFollowerCount: null,
      scrapeStatus,
    });
    // console.log('[X Bot Cleaner - Controller] ✅ Teardown complete');
    void maybeNavigateToFollowersPage();
    return;
  }

  // console.log('[X Bot Cleaner - Controller] ✅ On followers page, initializing...');
  rememberFollowersUrl();
  ensureButtonStyles();
  processFollowers();
  applyRealVisibilityToCells();
  applyVerifiedVisibilityToCells();
  startObserver();
  scheduleMetricsUpdate();

  // Check automatic action flags when followers page loads
  // console.log('[X Bot Cleaner - Controller] 🔍 Checking auto actions...');
  void checkAndStartAutoCapture();
  void checkAndStartAutoRemoval();
  // console.log('[X Bot Cleaner - Controller] ✅ Route change handling complete');
}

function startObserver() {
  if (mutationObserver || !document.body) return;

  mutationObserver = new MutationObserver(() => {
    scheduleProcessFollowers();
  });
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function teardownObserver() {
  mutationObserver?.disconnect();
  mutationObserver = null;
}

function syncSetsFromState() {
  realSet = new Set((cachedState.realFollowers ?? []).map(normalizeUsername));
  botSet = new Set((cachedState.botFollowers ?? []).map(normalizeUsername));
}

function scheduleProcessFollowers() {
  if (processRaf) return;
  processRaf = requestAnimationFrame(() => {
    processRaf = null;
    processFollowers();
  });
}

function processFollowers() {
  if (!isFollowersPageActive()) return;
  // Only process cells inside the element with "Timeline: Followers" aria-label
  const timelineContainer = document.querySelector<HTMLElement>(
    '[aria-label="Timeline: Followers"]',
  );
  if (!timelineContainer) return;

  const cells =
    timelineContainer.querySelectorAll<HTMLElement>(USER_CELL_SELECTOR);
  const snapshotBuffer: FollowerSnapshotEntry[] = [];
  cells.forEach((cell) => {
    const username = extractUsername(cell);
    if (!username) return;

    if (!cell.hasAttribute(USERNAME_ATTRIBUTE)) {
      cell.setAttribute(USERNAME_ATTRIBUTE, username);
    }

    if (!cell.hasAttribute(PROCESSED_ATTRIBUTE)) {
      ensureButtons(cell, username);
    }

    cell.setAttribute(PROCESSED_ATTRIBUTE, 'true');
    applyStatusToCell(cell, getStatusFor(username));

    const snapshotEntry = buildSnapshotEntry(cell, username);
    enqueueSnapshotEntry(snapshotBuffer, snapshotEntry);
  });

  if (snapshotBuffer.length) {
    followerSnapshotStorage.recordBatch(snapshotBuffer).catch((error) => {
      console.error(
        '[X Bot Cleaner] Failed to persist follower snapshot',
        error,
      );
    });
  }

  scheduleMetricsUpdate();
}

function ensureButtons(cell: HTMLElement, username: string) {
  if (cell.querySelector(`[${BUTTON_CONTAINER_ATTRIBUTE}]`)) return;

  const container = document.createElement('div');
  container.setAttribute(BUTTON_CONTAINER_ATTRIBUTE, 'true');
  container.className = 'xbc-follower-controls';

  // TODO: When we attach actions, also sync them with the global scraped list so
  //       the analytics view can show which scraped accounts are classified.

  const realButton = buildActionButton(
    buildLabeledIcon(realIconSvg, 'Real'),
    'Mark as real',
    'real',
    username,
  );
  const botButton = buildActionButton(
    buildLabeledIcon(botIconSvg, 'Bot'),
    'Mark as bot',
    'bot',
    username,
  );
  container.append(realButton, botButton);

  const followButton = cell.querySelector('button');
  if (followButton?.parentElement) {
    followButton.parentElement.insertBefore(container, followButton);
  } else {
    cell.appendChild(container);
  }

  removeFollowButton(cell);
}

function buildActionButton(
  label: string,
  ariaLabel: string,
  action: Exclude<FollowerStatus, 'unknown'>,
  username: string,
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = label;
  button.setAttribute('aria-label', ariaLabel);
  button.setAttribute(ACTION_BUTTON_ATTRIBUTE, action);
  button.setAttribute(USERNAME_ATTRIBUTE, username);
  button.className = BUTTON_BASE_CLASS;
  return button;
}

const botIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2C13.5 2.44425 13.3069 2.84339 13 3.11805V5H18C19.6569 5 21 6.34315 21 8V18C21 19.6569 19.6569 21 18 21H6C4.34315 21 3 19.6569 3 18V8C3 6.34315 4.34315 5 6 5H11V3.11805C10.6931 2.84339 10.5 2.44425 10.5 2C10.5 1.17157 11.1716 0.5 12 0.5C12.8284 0.5 13.5 1.17157 13.5 2ZM6 7C5.44772 7 5 7.44772 5 8V18C5 18.5523 5.44772 19 6 19H18C18.5523 19 19 18.5523 19 18V8C19 7.44772 18.5523 7 18 7H13H11H6ZM2 10H0V16H2V10ZM22 10H24V16H22V10ZM9 14.5C9.82843 14.5 10.5 13.8284 10.5 13C10.5 12.1716 9.82843 11.5 9 11.5C8.17157 11.5 7.5 12.1716 7.5 13C7.5 13.8284 8.17157 14.5 9 14.5ZM15 14.5C15.8284 14.5 16.5 13.8284 16.5 13C16.5 12.1716 15.8284 11.5 15 11.5C14.1716 11.5 13.5 12.1716 13.5 13C13.5 13.8284 14.1716 14.5 15 14.5Z"></path></svg>';
const realIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M4 12C4 7.582 7.582 4 12 4s8 3.582 8 8-3.582 8-8 8-8-3.582-8-8Zm8-10C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2Zm5.457 7.457-1.414-1.414L11 13.086 8.207 10.293l-1.414 1.414L11 16.914l6.457-6.457Z"></path></svg>';
const clearIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10Zm0-2c4.418 0 8-3.582 8-8s-3.582-8-8-8-8 3.582-8 8 3.582 8 8 8Zm-3.707-5.707L10.586 12 8.293 9.707l1.414-1.414L12 10.586l2.293-2.293 1.414 1.414L13.414 12l2.293 2.293-1.414 1.414L12 13.414l-2.293 2.293-1.414-1.414Z"></path></svg>';

function buildLabeledIcon(svgMarkup: string, label: string) {
  return `
    <span class="xbc-pill-icon" data-variant="default">${svgMarkup}</span>
    <span class="xbc-pill-icon" data-variant="clear">${clearIconSvg}</span>
    <span class="xbc-button-label" data-variant="default">${label}</span>
    <span class="xbc-button-label" data-variant="clear">Clear</span>
  `;
}

function buildSnapshotEntry(
  cell: HTMLElement,
  username: string,
): FollowerSnapshotEntry {
  return {
    username,
    displayName: extractDisplayName(cell),
    avatarUrl: extractAvatarUrl(cell),
    bio: extractBio(cell),
    isVerified: extractVerificationState(cell),
    scrapedAt: Date.now(),
  };
}

function enqueueSnapshotEntry(
  buffer: FollowerSnapshotEntry[],
  entry: FollowerSnapshotEntry,
) {
  const existing = cachedSnapshotState.entries[entry.username];
  const hasChanged =
    !existing ||
    existing.displayName !== entry.displayName ||
    existing.avatarUrl !== entry.avatarUrl ||
    existing.bio !== entry.bio;
  if (!hasChanged) return;

  cachedSnapshotState.entries[entry.username] = entry;
  if (!existing) {
    cachedSnapshotState.totalCaptured += 1;
    lastSnapshotCount = cachedSnapshotState.totalCaptured;
  }
  buffer.push(entry);
}

function extractDisplayName(cell: Element): string | undefined {
  const container = cell.querySelector<HTMLElement>(
    '[data-testid="User-Names"]',
  );
  if (container) {
    const spans = container.querySelectorAll('span span');
    for (const span of spans) {
      const value = span.textContent?.trim();
      if (value && !value.startsWith('@')) {
        return value;
      }
    }
  }

  const fallback = cell.querySelector<HTMLElement>('a[href^="/"] span span');
  const fallbackText = fallback?.textContent?.trim();
  if (fallbackText && !fallbackText.startsWith('@')) {
    return fallbackText;
  }
  return undefined;
}

function extractAvatarUrl(cell: Element): string | undefined {
  const img = cell.querySelector<HTMLImageElement>(
    'img[src][alt][draggable="true"]',
  );
  if (!img?.src) return undefined;
  let url = img.src;
  // Remove _bigger suffix
  if (url.includes('_bigger')) {
    url = url.replace('_bigger', '');
  }
  // Remove size expressions like _mini, _small
  url = url.replace(/_mini|_small/g, '');
  // Remove size expressions like _x96, _x48
  url = url.replace(/_x\d+/g, '');
  return url;
}

function extractBio(cell: Element): string | undefined {
  const primary = cell.querySelector<HTMLElement>(
    '[data-testid="UserDescription"]',
  );
  const primaryText = primary?.textContent?.trim();
  if (primaryText) {
    return primaryText;
  }

  const fallbackBlocks = Array.from(
    cell.querySelectorAll<HTMLElement>(
      '[data-testid="cellInnerDiv"] div[dir="auto"]',
    ),
  ).reverse();

  for (const block of fallbackBlocks) {
    if (block.closest('[data-testid="userFollowIndicator"]')) continue;
    const text = block.textContent?.trim();
    if (!text) continue;
    if (text.startsWith('@')) continue;
    const normalized = text.toLowerCase();
    if (
      normalized === 'follows you' ||
      normalized.includes('follows you') ||
      normalized.includes('click to follow') ||
      normalized.includes('click to unfollow')
    ) {
      continue;
    }
    return text;
  }

  return undefined;
}

function extractVerificationState(cell: Element): boolean {
  return Boolean(cell.querySelector('[data-testid="icon-verified"]'));
}

function removeFollowButton(cell: HTMLElement) {
  const followButton = cell.querySelector<HTMLButtonElement>(
    'button[data-testid$="-follow"], button[data-testid$="-unfollow"], button[data-testid="userFollow"]',
  );
  if (followButton && followButton.parentElement) {
    followButton.parentElement.removeChild(followButton);
  }
}

function applyStatusToCell(cell: HTMLElement, status: FollowerStatus) {
  if (!status || status === 'unknown') {
    cell.removeAttribute(STATUS_ATTRIBUTE);
  } else {
    cell.setAttribute(STATUS_ATTRIBUTE, status);
  }

  const controls = cell.querySelector<HTMLElement>(
    `[${BUTTON_CONTAINER_ATTRIBUTE}]`,
  );
  updateButtonStates(controls, status);

  const isVerified = extractVerificationState(cell);
  const shouldHideReal = status === 'real' && realHidden;
  const shouldHideVerified = isVerified && verifiedHidden;

  if (shouldHideReal || shouldHideVerified) {
    cell.setAttribute(HIDDEN_ATTRIBUTE, 'true');
    cell.style.display = 'none';
    return;
  }

  if (cell.hasAttribute(HIDDEN_ATTRIBUTE)) {
    cell.removeAttribute(HIDDEN_ATTRIBUTE);
  }
  cell.style.display = '';
}

function updateButtonStates(
  container: HTMLElement | null,
  status: FollowerStatus,
) {
  if (!container) return;
  const buttons =
    container.querySelectorAll<HTMLButtonElement>(
      `[${ACTION_BUTTON_ATTRIBUTE}]`,
    ) ?? [];

  buttons.forEach((button) => {
    const action = button.getAttribute(ACTION_BUTTON_ATTRIBUTE);
    if (action === status) {
      button.setAttribute(BUTTON_ACTIVE_ATTR, 'true');
    } else {
      button.removeAttribute(BUTTON_ACTIVE_ATTR);
    }
  });
}

function getStatusFor(username: string): FollowerStatus {
  if (botSet.has(username)) return 'bot';
  if (realSet.has(username)) return 'real';
  return 'unknown';
}

function syncCellsWithState() {
  // Only process cells inside the element with "Timeline: Followers" aria-label
  const timelineContainer = document.querySelector<HTMLElement>(
    '[aria-label="Timeline: Followers"]',
  );
  if (!timelineContainer) return;

  const cells =
    timelineContainer.querySelectorAll<HTMLElement>(
      `[${USERNAME_ATTRIBUTE}]`,
    ) ?? [];
  cells.forEach((cell) => {
    const username = cell.getAttribute(USERNAME_ATTRIBUTE);
    if (!username) return;
    applyStatusToCell(cell, getStatusFor(username));
  });
}

function applyRealVisibilityToCells() {
  // Only process cells inside the element with "Timeline: Followers" aria-label
  const timelineContainer = document.querySelector<HTMLElement>(
    '[aria-label="Timeline: Followers"]',
  );
  if (!timelineContainer) return;

  const cells = timelineContainer.querySelectorAll<HTMLElement>(
    `[${USERNAME_ATTRIBUTE}]`,
  );
  cells.forEach((cell) => {
    const status = cell.getAttribute(STATUS_ATTRIBUTE);
    const isVerified = extractVerificationState(cell);
    const shouldHideReal = status === 'real' && realHidden;
    const shouldHideVerified = isVerified && verifiedHidden;

    if (shouldHideReal || shouldHideVerified) {
      cell.setAttribute(HIDDEN_ATTRIBUTE, 'true');
      cell.style.display = 'none';
      return;
    }

    if (cell.hasAttribute(HIDDEN_ATTRIBUTE)) {
      cell.removeAttribute(HIDDEN_ATTRIBUTE);
    }
    cell.style.display = '';
  });
}

function applyVerifiedVisibilityToCells() {
  // Only process cells inside the element with "Timeline: Followers" aria-label
  const timelineContainer = document.querySelector<HTMLElement>(
    '[aria-label="Timeline: Followers"]',
  );
  if (!timelineContainer) return;

  const cells = timelineContainer.querySelectorAll<HTMLElement>(
    `[${USERNAME_ATTRIBUTE}]`,
  );
  cells.forEach((cell) => {
    const status = cell.getAttribute(STATUS_ATTRIBUTE);
    const isVerified = extractVerificationState(cell);
    const shouldHideReal = status === 'real' && realHidden;
    const shouldHideVerified = isVerified && verifiedHidden;

    if (shouldHideReal || shouldHideVerified) {
      cell.setAttribute(HIDDEN_ATTRIBUTE, 'true');
      cell.style.display = 'none';
      return;
    }

    if (cell.hasAttribute(HIDDEN_ATTRIBUTE)) {
      cell.removeAttribute(HIDDEN_ATTRIBUTE);
    }
    cell.style.display = '';
  });
}

function handleDelegatedAction(event: MouseEvent) {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    `[${ACTION_BUTTON_ATTRIBUTE}]`,
  );
  if (!target || !target.isConnected) return;

  const username = target.getAttribute(USERNAME_ATTRIBUTE);
  if (!username) return;

  event.preventDefault();
  event.stopPropagation();

  const cell = target.closest<HTMLElement>(USER_CELL_SELECTOR);

  const action = target.getAttribute(
    ACTION_BUTTON_ATTRIBUTE,
  ) as FollowerStatus | null;
  if (!action || action === 'unknown') return;

  const currentStatus = getStatusFor(username);
  const nextStatus: FollowerStatus =
    currentStatus === action ? 'unknown' : action;

  followerClassificationStorage
    .classify(username, nextStatus)
    .then(() => {
      if (cell) {
        if (nextStatus === 'real') {
          realSet.add(username);
          botSet.delete(username);
        } else if (nextStatus === 'bot') {
          botSet.add(username);
          realSet.delete(username);
        } else {
          realSet.delete(username);
          botSet.delete(username);
        }
        applyStatusToCell(cell, nextStatus);
      }
      scheduleMetricsUpdate();
    })
    .catch((error) => {
      console.error('[X Bot Cleaner] Classification failed', error);
    });
}

function extractUsername(cell: Element): string | null {
  // First try to find the username link within the User-Names container
  const userNamesContainer = cell.querySelector('[data-testid="User-Names"]');
  if (userNamesContainer) {
    const link = userNamesContainer.querySelector<HTMLAnchorElement>(
      USERNAME_LINK_SELECTOR,
    );
    if (link) {
      const href = link.getAttribute('href');
      if (href && href.length > 1 && !href.includes('/status/')) {
        const match = href.match(/^\/([^/?]+)/);
        if (match) {
          const username = normalizeUsername(match[1]);
          if (username && !username.startsWith('i/')) {
            return username;
          }
        }
      }
    }
  }

  // Fallback to the original method
  const link = cell.querySelector<HTMLAnchorElement>(USERNAME_LINK_SELECTOR);
  if (!link) return null;
  const href = link.getAttribute('href');
  if (!href || href.length < 2 || href.includes('/status/')) return null;
  const match = href.match(/^\/([^/?]+)/);
  if (!match) return null;
  const username = normalizeUsername(match[1]);
  if (!username || username.startsWith('i/')) return null;
  return username;
}

function isFollowersPageActive() {
  if (typeof window === 'undefined') return false;
  const { hostname, pathname } = window.location;
  return SUPPORTED_HOST_REGEX.test(hostname) && FOLLOWERS_PATH.test(pathname);
}

async function triggerFollowersNavigation(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  const targetUrl = await resolveFollowersTargetUrl();
  if (!targetUrl) {
    return false;
  }

  rememberFollowersUrl(targetUrl);
  window.location.assign(targetUrl);
  return true;
}

function findExistingFollowersPageUrl(): string | null {
  if (typeof document === 'undefined') return null;
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/followers"]'),
  );
  for (const link of links) {
    const url = getSafeUrlFromLink(link);
    if (!url) continue;
    if (!FOLLOWERS_PATH.test(url.pathname)) continue;
    if (!SUPPORTED_HOST_REGEX.test(url.hostname)) continue;
    url.hash = '';
    url.search = '';
    return url.toString();
  }
  return null;
}

function buildFollowersPageUrlFromProfile(): string | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  const profileLink =
    document.querySelector<HTMLAnchorElement>(
      'a[data-testid="AppTabBar_Profile_Link"]',
    ) ?? document.querySelector<HTMLAnchorElement>('a[aria-label="Profile"]');

  const profileUrl = profileLink ? getSafeUrlFromLink(profileLink) : null;

  if (profileUrl) {
    const profileUsername = extractUsernameFromPath(profileUrl.pathname);
    if (profileUsername) {
      profileUrl.pathname = `/${profileUsername}/followers`;
      profileUrl.hash = '';
      profileUrl.search = '';
      return profileUrl.toString();
    }
  }

  const activeUsername = extractUsernameFromPath(window.location.pathname);
  if (activeUsername) {
    const origin = window.location.origin || 'https://x.com';
    return `${origin}/${activeUsername}/followers`;
  }

  return null;
}

function getSafeUrlFromLink(link: HTMLAnchorElement): URL | null {
  try {
    const href = link.getAttribute('href') ?? link.href;
    if (!href) return null;
    return new URL(href, window.location.origin);
  } catch {
    return null;
  }
}

function extractUsernameFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const candidate = normalizeUsername(segments[0]);
  if (!candidate || RESERVED_ROOT_ROUTES.has(candidate)) return null;
  return candidate;
}

async function resolveFollowersTargetUrl(): Promise<string | null> {
  const stored = await getStoredFollowersUrl();
  if (stored) {
    return stored;
  }

  const immediate = findFollowersUrlFromDom();
  if (immediate) {
    return immediate;
  }

  return waitForFollowersUrlFromDom();
}

function findFollowersUrlFromDom(): string | null {
  return findExistingFollowersPageUrl() ?? buildFollowersPageUrlFromProfile();
}

async function waitForFollowersUrlFromDom(): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < FOLLOWERS_TARGET_RESOLUTION_TIMEOUT) {
    await sleep(FOLLOWERS_TARGET_RESOLUTION_INTERVAL);
    const candidate = findFollowersUrlFromDom();
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

async function getStoredFollowersUrl(): Promise<string | null> {
  try {
    const state = await followersWorkspaceStorage.get();
    return sanitizeFollowersUrl(state?.followersUrl ?? null);
  } catch {
    return null;
  }
}

function sanitizeFollowersUrl(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!SUPPORTED_HOST_REGEX.test(parsed.hostname)) {
      return null;
    }
    if (!FOLLOWERS_PATH.test(parsed.pathname)) {
      return null;
    }
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function waitForFollowersPage(timeoutMs: number): Promise<boolean> {
  if (typeof window === 'undefined') {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const start = Date.now();
    let intervalId: number | null = null;
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      resolve(result);
    };

    const check = () => {
      if (isFollowersPageActive()) {
        finish(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        finish(false);
      }
    };

    intervalId = window.setInterval(check, FOLLOWERS_NAVIGATION_POLL_INTERVAL);
    check();
  });
}

function scheduleMetricsUpdate() {
  if (metricsRaf) return;
  metricsRaf = requestAnimationFrame(() => {
    metricsRaf = null;
    followerMetricsStore.set({
      isFollowersPage: isFollowersPageActive(),
      totalCells: getCellCount(),
      processedCells: getProcessedCount(),
      botsOnPage: getStatusCount('bot'),
      realOnPage: getStatusCount('real'),
      realHidden,
      verifiedHidden,
      scrapedFollowers: getScrapedFollowersCount(),
      profileFollowerCount: getProfileFollowerCount(),
      scrapeStatus: { ...scrapeStatus },
      lastUpdatedAt: Date.now(),
    });
  });
}

function scheduleScrapeLoop() {
  if (scrapeStatus.phase !== 'running') return;
  if (scrapeTimer) {
    window.clearTimeout(scrapeTimer);
  }
  scrapeTimer = window.setTimeout(() => {
    void runScrapeLoop();
  }, activeScrapeOptions.scrollDelay);
}

async function runScrapeLoop() {
  if (scrapeStatus.phase !== 'running') return;
  if (!isFollowersPageActive()) {
    finalizeScrape('error', 'Followers page is no longer active');
    return;
  }

  const scroller = getFollowerScrollElement();
  if (!scroller) {
    finalizeScrape('error', 'Unable to find the follower timeline');
    return;
  }

  scrollFollowersToBottom(scroller);
  const nextIteration = scrapeStatus.iterations + 1;
  updateScrapeStatus({ iterations: nextIteration });

  await sleep(activeScrapeOptions.scrollDelay);

  if (scrapeStatus.phase !== 'running') return;

  const snapshotCount = getScrapedFollowersCount();
  if (snapshotCount > lastSnapshotCount) {
    lastSnapshotCount = snapshotCount;
    updateScrapeStatus({ captured: snapshotCount, idleStreak: 0 });
  } else {
    updateScrapeStatus({ idleStreak: scrapeStatus.idleStreak + 1 });
  }

  if (
    scrapeStatus.idleStreak >= activeScrapeOptions.idleThreshold &&
    isScrollerNearBottom(scroller)
  ) {
    finalizeScrape('completed');
    return;
  }

  scheduleScrapeLoop();
}

function finalizeScrape(phase: FollowerScrapePhase, message?: string) {
  if (scrapeTimer) {
    window.clearTimeout(scrapeTimer);
    scrapeTimer = null;
  }

  if (scrapeStatus.phase === 'running') {
    void followerSnapshotStorage.markScrapeFinish(Date.now());
  }

  updateScrapeStatus({
    phase,
    finishedAt: Date.now(),
    idleStreak: 0,
    message,
  });
}

function updateScrapeStatus(partial: Partial<FollowerScrapeStatus>) {
  scrapeStatus = {
    ...scrapeStatus,
    ...partial,
  };
  scheduleMetricsUpdate();
}

function getCellCount() {
  // Count cells inside the element with "Timeline: Followers" aria-label
  const timelineContainer = document.querySelector<HTMLElement>(
    '[aria-label="Timeline: Followers"]',
  );
  if (!timelineContainer) return 0;
  return timelineContainer.querySelectorAll(USER_CELL_SELECTOR).length;
}

function getProcessedCount() {
  // Count processed cells inside the element with "Timeline: Followers" aria-label
  const timelineContainer = document.querySelector<HTMLElement>(
    '[aria-label="Timeline: Followers"]',
  );
  if (!timelineContainer) return 0;
  return timelineContainer.querySelectorAll(`[${PROCESSED_ATTRIBUTE}]`).length;
}

function getStatusCount(status: Exclude<FollowerStatus, 'unknown'>) {
  // Count cells inside the element with "Timeline: Followers" aria-label
  const timelineContainer = document.querySelector<HTMLElement>(
    '[aria-label="Timeline: Followers"]',
  );
  if (!timelineContainer) return 0;
  return timelineContainer.querySelectorAll(`[${STATUS_ATTRIBUTE}="${status}"]`)
    .length;
}

function getScrapedFollowersCount() {
  return cachedSnapshotState?.totalCaptured ?? 0;
}

function getProfileFollowerCount(): number | null {
  const followerLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/followers"]'),
  );
  if (!followerLinks.length) return null;

  const directFollowersLink =
    followerLinks.find((link) => {
      const href = link.getAttribute('href') ?? '';
      return /\/followers(?:[/?]|$)/i.test(href);
    }) ??
    followerLinks.find((link) => {
      const text = link.textContent ?? '';
      return /followers/i.test(text);
    }) ??
    followerLinks[0];

  return extractFollowerCountFromLink(directFollowersLink);
}

function extractFollowerCountFromLink(link: HTMLAnchorElement): number | null {
  const candidateNodes = Array.from(
    link.querySelectorAll<HTMLElement>('span span, span'),
  );

  for (const node of candidateNodes) {
    const text = node.textContent?.trim();
    if (!text) continue;
    const parsed = parseFollowerCountLabel(text);
    if (parsed !== null) {
      return parsed;
    }
  }

  const textFallback = link.textContent?.trim() ?? '';
  const ariaFallback = link.getAttribute('aria-label') ?? '';
  const fallbackMatch =
    textFallback.match(/[0-9][0-9.,MKmk]*/) ??
    ariaFallback.match(/[0-9][0-9.,MKmk]*/);
  if (fallbackMatch) {
    return parseFollowerCountLabel(fallbackMatch[0]);
  }

  return null;
}

function parseFollowerCountLabel(label: string): number | null {
  const normalized = label
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9MKmk.]/g, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([MKmk]?)$/);
  if (!match) {
    const fallback = Number(normalized);
    return Number.isFinite(fallback) ? Math.round(fallback) : null;
  }

  const value = parseFloat(match[1]);
  const suffix = match[2].toLowerCase();
  if (!Number.isFinite(value)) return null;

  if (suffix === 'k') return Math.round(value * 1_000);
  if (suffix === 'm') return Math.round(value * 1_000_000);
  return Math.round(value);
}

function getFollowerScrollElement(): HTMLElement | null {
  const timeline = document.querySelector<HTMLElement>(
    '[aria-label="Timeline: Followers"]',
  );
  if (timeline) {
    const parent = findScrollableParent(timeline);
    if (parent) {
      return parent;
    }
  }

  const scrollingElement = document.scrollingElement as HTMLElement | null;
  if (scrollingElement) return scrollingElement;
  if (document.documentElement) return document.documentElement;
  return document.body;
}

function findScrollableParent(element: HTMLElement | null): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY?.toLowerCase() ?? '';
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function scrollFollowersToBottom(scroller: HTMLElement) {
  const target = scroller.scrollHeight;
  if (typeof scroller.scrollTo === 'function') {
    scroller.scrollTo({ top: target, behavior: 'smooth' });
  } else {
    scroller.scrollTop = target;
  }

  if (
    scroller !== document.scrollingElement &&
    document.scrollingElement instanceof HTMLElement
  ) {
    document.scrollingElement.scrollTo({
      top: document.scrollingElement.scrollHeight,
      behavior: 'smooth',
    });
  }

  const globalTarget =
    document.documentElement?.scrollHeight ??
    document.body?.scrollHeight ??
    target;
  window.scrollTo({ top: globalTarget, behavior: 'smooth' });
}

function isScrollerNearBottom(scroller: HTMLElement) {
  const tolerance = 48;

  if (scroller === document.documentElement || scroller === document.body) {
    const maxScroll =
      (document.documentElement?.scrollHeight ??
        document.body?.scrollHeight ??
        0) - window.innerHeight;
    return window.scrollY >= maxScroll - tolerance;
  }

  return (
    scroller.scrollTop + scroller.clientHeight >=
    scroller.scrollHeight - tolerance
  );
}

function ensureButtonStyles() {
  if (document.getElementById(STYLE_TAG_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_TAG_ID;
  style.textContent = `
    [${BUTTON_CONTAINER_ATTRIBUTE}] {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      margin: 8px 0;
      font-family: 'Inter', sans-serif !important;
    }

    .${BUTTON_BASE_CLASS} {
      all: unset;
      border-radius: 999px;
      padding: 6px 16px;
      font-size: 11px;
      letter-spacing: 0.25em;
      text-transform: uppercase;
      font-weight: 600;
      border: 1px solid rgba(15, 23, 42, 0.12);
      background: rgba(255, 255, 255, 0.95);
      color: #0f172a;
      cursor: pointer;
      transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: 100px;
      justify-content: center;
    }

    .${BUTTON_BASE_CLASS}[${ACTION_BUTTON_ATTRIBUTE}="real"] {
      border-color: rgba(16, 185, 129, 0.35);
    }

    .${BUTTON_BASE_CLASS}[${ACTION_BUTTON_ATTRIBUTE}="bot"] {
      border-color: rgba(244, 63, 94, 0.35);
    }

    .${BUTTON_BASE_CLASS}:hover {
      border-color: rgba(15, 23, 42, 0.3);
    }

    .${BUTTON_BASE_CLASS}[${BUTTON_ACTIVE_ATTR}="true"][${ACTION_BUTTON_ATTRIBUTE}="real"] {
      background: #16a34a;
      border-color: #15803d;
      color: #fff;
    }

    .${BUTTON_BASE_CLASS}[${BUTTON_ACTIVE_ATTR}="true"][${ACTION_BUTTON_ATTRIBUTE}="bot"] {
      background: #dc2626;
      border-color: #b91c1c;
      color: #fff;
    }

    .${BUTTON_BASE_CLASS} .xbc-pill-icon {
      display: inline-flex;
      width: 16px;
      height: 16px;
    }

    .${BUTTON_BASE_CLASS} .xbc-button-label {
      display: inline-block;
    }

    .${BUTTON_BASE_CLASS} .xbc-pill-icon[data-variant="clear"],
    .${BUTTON_BASE_CLASS} .xbc-button-label[data-variant="clear"] {
      display: none;
    }

    .${BUTTON_BASE_CLASS}[${BUTTON_ACTIVE_ATTR}="true"]:hover .xbc-pill-icon[data-variant="default"],
    .${BUTTON_BASE_CLASS}[${BUTTON_ACTIVE_ATTR}="true"]:hover .xbc-button-label[data-variant="default"] {
      display: none;
    }

    .${BUTTON_BASE_CLASS}[${BUTTON_ACTIVE_ATTR}="true"]:hover .xbc-pill-icon[data-variant="clear"] {
      display: inline-flex;
    }

    .${BUTTON_BASE_CLASS}[${BUTTON_ACTIVE_ATTR}="true"]:hover .xbc-button-label[data-variant="clear"] {
      display: inline-block;
    }

    [${HIDDEN_ATTRIBUTE}="true"] {
      display: none !important;
    }

    @media (prefers-color-scheme: dark) {
      .${BUTTON_BASE_CLASS} {
        background: rgba(15, 23, 42, 0.55);
        color: #e2e8f0;
        border-color: rgba(226, 232, 240, 0.15);
      }

      .${BUTTON_BASE_CLASS}[${BUTTON_ACTIVE_ATTR}="true"][${ACTION_BUTTON_ATTRIBUTE}="real"] {
        background: rgba(34, 197, 94, 0.35);
        border-color: rgba(16, 185, 129, 0.65);
        color: #d1fae5;
      }

      .${BUTTON_BASE_CLASS}[${BUTTON_ACTIVE_ATTR}="true"][${ACTION_BUTTON_ATTRIBUTE}="bot"] {
        background: rgba(248, 113, 113, 0.35);
        border-color: rgba(239, 68, 68, 0.65);
        color: #fee2e2;
      }
    }
  `;

  document.head.appendChild(style);
}

async function attemptRemoval(
  username: string,
  existingCell?: HTMLElement | null,
): Promise<{ status: FollowerRemovalStatus; reason?: string }> {
  const result: { status: FollowerRemovalStatus; reason?: string } = {
    status: 'skipped',
  };
  let cell = existingCell ?? null;
  if (!cell || !cell.isConnected) {
    cell = await findCellWithAutoScroll(username);
  }
  if (!cell) {
    return { status: 'not-found', reason: 'User cell not found' };
  }

  if (typeof cell.scrollIntoView === 'function') {
    cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(350);
  }

  const moreButton = cell.querySelector<HTMLButtonElement>(
    'button[aria-label="More"]',
  );
  if (!moreButton) {
    return { status: 'action-missing', reason: 'More button not found' };
  }

  moreButton.click();
  await sleep(600);

  const removeItem = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).find((item) => /remove this follower/i.test(item.textContent ?? ''));

  if (!removeItem) {
    return {
      status: 'action-missing',
      reason: '"Remove this follower" action not found',
    };
  }

  removeItem.click();
  await sleep(500);

  const confirmButton = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="button"]'),
  ).find((btn) => btn.textContent?.trim() === 'Remove');

  if (!confirmButton) {
    return {
      status: 'action-missing',
      reason: '"Remove" confirmation not found',
    };
  }

  confirmButton.click();
  await sleep(800);

  result.status = 'removed';
  return result;
}

function findCellByUsername(username: string) {
  // Search inside the element with "Timeline: Followers" aria-label
  const timelineContainer = document.querySelector<HTMLElement>(
    '[aria-label="Timeline: Followers"]',
  );
  if (!timelineContainer) return undefined;

  return Array.from(
    timelineContainer.querySelectorAll<HTMLElement>(`[${USERNAME_ATTRIBUTE}]`),
  ).find(
    (cell) =>
      cell.getAttribute(USERNAME_ATTRIBUTE) === normalizeUsername(username),
  );
}

async function findCellWithAutoScroll(username: string) {
  let cell = findCellByUsername(username);
  if (cell) {
    return cell;
  }

  const scroller = getFollowerScrollElement();
  if (!scroller) {
    return null;
  }

  let previousCount = getCellCount();

  for (let attempt = 0; attempt < REMOVAL_SCROLL_MAX_ATTEMPTS; attempt++) {
    scrollFollowersToBottom(scroller);
    await sleep(REMOVAL_SCROLL_DELAY_MS);

    cell = findCellByUsername(username);
    if (cell) {
      return cell;
    }

    const currentCount = getCellCount();
    const noGrowth = currentCount <= previousCount;
    previousCount = currentCount;

    if (isScrollerNearBottom(scroller) && noGrowth) {
      break;
    }
  }

  return findCellByUsername(username);
}

type VisibleBotEntry = {
  username: string;
  cell: HTMLElement;
};

function getVisibleBotCells(targets?: Set<string>): VisibleBotEntry[] {
  const timelineContainer = document.querySelector<HTMLElement>(
    '[aria-label="Timeline: Followers"]',
  );
  if (!timelineContainer) return [];

  const candidates = Array.from(
    timelineContainer.querySelectorAll<HTMLElement>(
      `${USER_CELL_SELECTOR}[${STATUS_ATTRIBUTE}="bot"]`,
    ),
  );

  return candidates
    .map((cell) => {
      const rawUsername = cell.getAttribute(USERNAME_ATTRIBUTE);
      if (!rawUsername) return null;
      const normalized = normalizeUsername(rawUsername);
      if (!normalized) return null;
      if (targets && !targets.has(normalized)) return null;
      return { username: normalized, cell };
    })
    .filter((entry): entry is VisibleBotEntry => entry !== null);
}

function sleep(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function checkAndStartAutoCapture() {
  // If capture is already running, do nothing
  if (scrapeStatus.phase === 'running') {
    return;
  }

  // Check flag from storage
  const snapshot = await followerSnapshotStorage.get();
  if (!snapshot?.autoStartCapture) {
    return;
  }

  // Clear the flag
  await followerSnapshotStorage.clearAutoStartCapture();

  // Add a short delay so the page loads completely
  await sleep(500);

  // Start capture
  try {
    await startFollowerScrape();
  } catch (error) {
    console.error('[X Bot Cleaner] Failed to start auto capture', error);
  }
}

async function checkAndStartAutoRemoval() {
  if (autoRemovalInFlight) {
    return;
  }

  const state = await followerClassificationStorage.get();
  if (!state?.autoStartRemoval) {
    return;
  }

  await followerClassificationStorage.clearAutoStartRemoval();

  if (!botSet.size) {
    return;
  }

  autoRemovalInFlight = true;
  try {
    await sleep(500);
    await removeAllBotsFromPage({
      requireConfirmation: false,
      alertOnFinish: false,
    });
  } catch (error) {
    console.error('[X Bot Cleaner] Failed to start auto removal', error);
  } finally {
    autoRemovalInFlight = false;
  }
}

async function maybeNavigateToFollowersPage() {
  if (followersNavigationInFlight) {
    return;
  }

  followersNavigationInFlight = true;

  try {
    const [snapshot, classification] = await Promise.all([
      followerSnapshotStorage.get(),
      followerClassificationStorage.get(),
    ]);

    const shouldAutoCapture = Boolean(snapshot?.autoStartCapture);
    const shouldAutoRemoval = Boolean(classification?.autoStartRemoval);

    if (!shouldAutoCapture && !shouldAutoRemoval) {
      return;
    }

    await ensureFollowersPageActive(undefined, {
      autoStartCapture: shouldAutoCapture,
      autoStartRemoval: shouldAutoRemoval,
    });
  } catch (error) {
    console.error(
      '[X Bot Cleaner - Controller] Failed to auto-navigate to the followers page.',
      error,
    );
  } finally {
    followersNavigationInFlight = false;
  }
}

function rememberFollowersUrl(url?: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const sanitized = sanitizeFollowersUrl(url ?? window.location.href);
    if (!sanitized) {
      return;
    }
    void followersWorkspaceStorage.setFollowersUrl(sanitized);
  } catch (error) {
    console.error(
      '[X Bot Cleaner - Controller] Unable to persist followers URL.',
      error,
    );
  }
}
