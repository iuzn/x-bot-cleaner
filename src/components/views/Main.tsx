import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactElement,
  SVGProps,
  useId,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AnimatePresence,
  animate,
  motion,
  PanInfo,
  useMotionValue,
  useTransform,
  Variants,
} from 'framer-motion';
import { Danger, Radar, ShieldTick } from 'iconsax-react';
import { useVisibility } from '@/context/VisibilityContext';
import { extensionId } from '@/lib/config';
import { cn } from '@/lib/utils';
import useStorage from '@/shared/hooks/useStorage';
import {
  followerClassificationStorage,
  normalizeUsername,
} from '@/shared/storages/followerClassificationStorage';
import { followerSnapshotStorage } from '@/shared/storages/followerSnapshotStorage';
import followersWorkspaceStorage from '@/shared/storages/followersWorkspaceStorage';
import { useFollowerMetrics } from '@/hooks/useFollowerMetrics';
import {
  ensureFollowersPageActive,
  removeAllBotsFromPage,
  startFollowerScrape,
  stopFollowerScrape,
  toggleRealVisibility,
  toggleVerifiedVisibility,
} from '@/pages/content/followers/controller';
import type {
  FollowerClassificationState,
  FollowerSnapshotEntry,
  FollowerSnapshotState,
  FollowerStatus,
  RemovalProgress,
} from '@/types/followers';
import { ClearDataDialog } from '@/components/views/modals/ClearDataDialog';
import { RemoveBotsDialog } from '@/components/views/modals/RemoveBotsDialog';
import { Switch } from '@/components/ui/switch';
import { useClickOutside } from '@/hooks/useClickOutside';
import visibilityStorage from '@/shared/storages/visibilityStorage';
import { Transition } from 'framer-motion';
type RemovalState = 'idle' | 'running' | 'done';
type TabId = 'insights' | 'lists';
type ScrapedFilter = 'all' | 'trusted' | 'bots' | 'unreviewed';
type SwipeDirection = 'left' | 'right' | null;

type SwipeFollowerCard = {
  username: string;
  displayName: string;
  avatarUrl?: string;
  isVerified?: boolean;
  status: FollowerStatus;
  bio?: string;
};

const BOT_SWIPE_BATCH_SIZE = 8;
const FOLLOWERS_ENTRY_URL = 'https://x.com/home';
const POPUP_NAVIGATION_ERROR =
  'Unable to open X in a new tab. Please try again from a browser window.';
type PopupActionIntent = 'capture' | 'removal';

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'insights', label: 'Status' },
  { id: 'lists', label: 'Lists' },
];
// TODO: Replace the placeholder tabs above with an underline-style tab system so
//       it doesn't clash with the rounded primary tabs, and include a third
//       "Scraped" tab that renders the followerSnapshot data once the
//       scraping feature is implemented.

async function launchFollowersWorkspace(
  intent: PopupActionIntent,
): Promise<boolean> {
  if (
    typeof chrome === 'undefined' ||
    !chrome.tabs ||
    typeof chrome.tabs.create !== 'function'
  ) {
    console.error(
      '[X Bot Cleaner] Chrome tabs API is not available in this context.',
    );
    return false;
  }

  try {
    await visibilityStorage.set(true);
    const targetUrl = await resolveFollowersEntryUrl();

    if (intent === 'capture') {
      await Promise.all([
        followerSnapshotStorage.setAutoStartCapture(true),
        followerClassificationStorage.clearAutoStartRemoval(),
      ]);
    } else {
      await Promise.all([
        followerClassificationStorage.setAutoStartRemoval(true),
        followerSnapshotStorage.clearAutoStartCapture(),
      ]);
    }

    await createTab({ url: targetUrl, active: true });
    return true;
  } catch (error) {
    console.error(
      '[X Bot Cleaner] Unable to open a followers tab from the popup.',
      error,
    );
    return false;
  }
}

function createTab(properties: chrome.tabs.CreateProperties) {
  return new Promise<chrome.tabs.Tab>((resolve, reject) => {
    chrome.tabs.create(properties, (tab) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

async function resolveFollowersEntryUrl() {
  try {
    const state = await followersWorkspaceStorage.get();
    const persisted = sanitizeFollowersUrl(state.followersUrl);
    return persisted ?? FOLLOWERS_ENTRY_URL;
  } catch {
    return FOLLOWERS_ENTRY_URL;
  }
}

function sanitizeFollowersUrl(url?: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export default function Main() {
  const isPopup =
    typeof window !== 'undefined' && window.location.href.includes('popup');

  const logoUrl = isPopup
    ? '/logo.png'
    : typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('logo.png')
      : '/logo.png';

  const { isRootVisible, toggleRootVisibility } = isPopup
    ? { isRootVisible: true, toggleRootVisibility: async () => {} }
    : useVisibility();

  const classification = useStorage(followerClassificationStorage);
  const snapshot = useStorage(followerSnapshotStorage);
  const metrics = useFollowerMetrics();

  const [removalState, setRemovalState] = useState<RemovalState>('idle');
  const [removalProgress, setRemovalProgress] =
    useState<RemovalProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTogglingVisibility, setIsTogglingVisibility] = useState(false);
  const [isTogglingVerifiedVisibility, setIsTogglingVerifiedVisibility] =
    useState(false);
  const [isScrapePending, setIsScrapePending] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('insights');
  const [hasAutoSwitched, setHasAutoSwitched] = useState(false);
  const [isClearingData, setIsClearingData] = useState(false);
  const [isBotSwipeOpen, setIsBotSwipeOpen] = useState(false);
  const [isClearDataDialogOpen, setIsClearDataDialogOpen] = useState(false);
  const [isRemoveBotsDialogOpen, setIsRemoveBotsDialogOpen] = useState(false);
  const [isPanelMenuOpen, setIsPanelMenuOpen] = useState(false);
  const panelMenuRef = useRef<HTMLDivElement | null>(null);
  const panelContainerRef = useRef<HTMLDivElement | null>(null);
  const panelMenuId = useId();
  const closePanelMenu = useCallback(() => setIsPanelMenuOpen(false), []);
  const togglePanelMenu = useCallback(
    () => setIsPanelMenuOpen((previous) => !previous),
    [],
  );
  // TODO: Persist `activeTab` to storage so we can restore the last selected
  //       view after reloads, matching the requested behavior.

  const realCount = classification.realFollowers.length;
  const botCount = classification.botFollowers.length;
  const hideRealOnPage = classification.preferences.hideRealOnPage;
  const hideVerifiedOnPage = classification.preferences.hideVerifiedOnPage;

  const scrapeStatus = metrics.scrapeStatus;
  const followerTarget = useMemo(() => {
    if (metrics.profileFollowerCount && metrics.profileFollowerCount > 0) {
      return metrics.profileFollowerCount;
    }
    return metrics.totalCells;
  }, [metrics.profileFollowerCount, metrics.totalCells]);

  const scrapedTotal = useMemo(() => {
    if (metrics.scrapedFollowers > 0) {
      return metrics.scrapedFollowers;
    }
    if (snapshot.totalCaptured > 0) {
      return snapshot.totalCaptured;
    }
    return metrics.processedCells;
  }, [
    metrics.scrapedFollowers,
    snapshot.totalCaptured,
    metrics.processedCells,
  ]);

  const stats = [
    {
      label: 'Saved',
      value: scrapedTotal.toLocaleString(),
      description: 'Followers captured',
      icon: Radar,
      tone: 'blue' as const,
      span: 1,
    },
    {
      label: 'Trusted',
      value: realCount,
      description: 'Accounts marked as real',
      icon: ShieldTick,
      tone: 'emerald' as const,
      span: 1,
    },
  ];

  useEffect(() => {
    if (scrapeStatus.phase === 'running') {
      setHasAutoSwitched(false);
      return;
    }
    if (
      scrapeStatus.phase === 'completed' &&
      snapshot.totalCaptured > 0 &&
      !hasAutoSwitched
    ) {
      setActiveTab('lists');
      setHasAutoSwitched(true);
    }
  }, [scrapeStatus.phase, snapshot.totalCaptured, hasAutoSwitched]);

  const realSet = useMemo(
    () => new Set(classification.realFollowers ?? []),
    [classification.realFollowers],
  );
  const botSet = useMemo(
    () => new Set(classification.botFollowers ?? []),
    [classification.botFollowers],
  );

  const botSwipeEntries = useMemo(() => {
    const entryMap = snapshot.entries ?? {};
    const seen = new Set<string>();
    const cards: SwipeFollowerCard[] = [];
    Object.values(entryMap)
      .sort((a, b) => (a.scrapedAt ?? 0) - (b.scrapedAt ?? 0))
      .forEach((entry) => {
        const normalized = normalizeUsername(entry.username);
        if (!normalized || seen.has(normalized)) {
          return;
        }
        const status = getStatusFromSets(entry.username, realSet, botSet);
        if (status !== 'unknown') {
          seen.add(normalized);
          return;
        }
        cards.push({
          username: entry.username,
          displayName: entry.displayName ?? `@${entry.username}`,
          avatarUrl: entry.avatarUrl,
          isVerified: entry.isVerified,
          status,
          bio: entry.bio,
        });
        seen.add(normalized);
      });

    return cards;
  }, [snapshot.entries, realSet, botSet]);

  useEffect(() => {
    if (isBotSwipeOpen && botSwipeEntries.length === 0) {
      setIsBotSwipeOpen(false);
    }
  }, [isBotSwipeOpen, botSwipeEntries.length]);

  const handleClearDialogToggle = (next: boolean) => {
    if (isClearingData) return;
    setIsClearDataDialogOpen(next);
  };

  const promptClearDataDialog = () => {
    if (snapshot.totalCaptured === 0 || isClearingData) return;
    setIsClearDataDialogOpen(true);
  };

  const hasSavedData = (snapshot.totalCaptured ?? 0) > 0;
  const handleRemoveBotsDialogToggle = (next: boolean) => {
    if (removalState === 'running') return;
    setIsRemoveBotsDialogOpen(next);
  };
  const openRemoveBotsDialog = () => {
    if (removalState === 'running' || botCount === 0) return;
    setIsRemoveBotsDialogOpen(true);
  };

  useEffect(() => {
    if (!isPanelMenuOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const targetNode = event.target;
      if (
        targetNode instanceof Node &&
        panelMenuRef.current?.contains(targetNode)
      ) {
        return;
      }
      closePanelMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePanelMenu();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isPanelMenuOpen, closePanelMenu]);

  useEffect(() => {
    if (!isRootVisible) {
      closePanelMenu();
    }
  }, [isRootVisible, closePanelMenu]);

  const confirmRemoveBots = async () => {
    if (removalState === 'running') return;
    setIsRemoveBotsDialogOpen(false);
    await handleBulkRemoval();
  };

  const handleToggleVisibility = async () => {
    if (isTogglingVisibility || !metrics.isFollowersPage) return;
    setIsTogglingVisibility(true);
    setErrorMessage(null);
    try {
      await toggleRealVisibility();
    } catch (error) {
      console.error(error);
      setErrorMessage('Unable to update visibility filter.');
    } finally {
      setIsTogglingVisibility(false);
    }
  };

  const handleToggleVerifiedVisibility = async () => {
    if (isTogglingVerifiedVisibility || !metrics.isFollowersPage) return;
    setIsTogglingVerifiedVisibility(true);
    setErrorMessage(null);
    try {
      await toggleVerifiedVisibility();
    } catch (error) {
      console.error(error);
      setErrorMessage('Unable to update verified visibility filter.');
    } finally {
      setIsTogglingVerifiedVisibility(false);
    }
  };

  const handleBulkRemoval = async () => {
    if (removalState === 'running' || botCount === 0) {
      return;
    }

    setErrorMessage(null);

    if (isPopup) {
      const launched = await launchFollowersWorkspace('removal');
      if (!launched) {
        setErrorMessage(POPUP_NAVIGATION_ERROR);
      }
      return;
    }

    if (!metrics.isFollowersPage) {
      try {
        const ready = await ensureFollowersPageActive(undefined, {
          autoStartRemoval: true,
        });
        if (!ready) {
          setErrorMessage('Unable to open your followers list. Try again.');
          return;
        }
      } catch (error) {
        console.error(error);
        setErrorMessage('Unable to open your followers list. Try again.');
        return;
      }
    }

    setRemovalState('running');
    setRemovalProgress({
      total: botCount,
      completed: 0,
      success: 0,
      failed: 0,
    });

    try {
      await removeAllBotsFromPage({
        requireConfirmation: false,
        alertOnFinish: false,
        onProgress: (progress) => setRemovalProgress(progress),
      });
      setRemovalState('done');
    } catch (error) {
      console.error(error);
      setRemovalState('idle');
      setErrorMessage('Cleanup could not complete.');
    } finally {
      setTimeout(() => {
        setRemovalState('idle');
        setRemovalProgress(null);
      }, 3200);
    }
  };

  const handleAutoScrape = async () => {
    if (isPopup) {
      setErrorMessage(null);
      const launched = await launchFollowersWorkspace('capture');
      if (!launched) {
        setErrorMessage(POPUP_NAVIGATION_ERROR);
      }
      return;
    }

    if (isScrapePending) return;

    if (scrapeStatus.phase === 'running') {
      stopFollowerScrape();
      return;
    }

    setIsScrapePending(true);
    setErrorMessage(null);
    try {
      if (!metrics.isFollowersPage) {
        const ready = await ensureFollowersPageActive();
        if (!ready) {
          setErrorMessage('Unable to open your followers list. Try again.');
          return;
        }
      }

      await startFollowerScrape();
    } catch (error) {
      console.error(error);
      setErrorMessage('Unable to start capture.');
    } finally {
      setIsScrapePending(false);
    }
  };

  const handleResetAllData = async () => {
    if (isClearingData) return;
    setIsClearingData(true);
    setErrorMessage(null);
    try {
      await Promise.all([
        followerSnapshotStorage.resetSnapshot(),
        followerClassificationStorage.resetAll(),
      ]);
      setIsClearDataDialogOpen(false);
    } catch (error) {
      console.error(error);
      setErrorMessage('Unable to clear saved data.');
    } finally {
      setIsClearingData(false);
    }
  };

  const progressPercent = removalProgress?.total
    ? Math.min(
        100,
        Math.round((removalProgress.completed / removalProgress.total) * 100),
      )
    : 0;

  const actionDisabled = !metrics.isFollowersPage;

  const captureCtaLabel =
    scrapeStatus.phase === 'running' ? 'Stop Capture' : 'Capture All';

  const openBotSwipe = () => setIsBotSwipeOpen(true);
  const closeBotSwipe = () => setIsBotSwipeOpen(false);
  const handleSwipeDecision = useCallback(
    async (username: string, decision: 'real' | 'bot') => {
      try {
        await followerClassificationStorage.classify(username, decision);
      } catch (error) {
        console.error('Unable to classify follower from swipe.', error);
      }
    },
    [],
  );
  const handleUndoSwipeDecision = useCallback(async (username: string) => {
    try {
      await followerClassificationStorage.resetUser(username);
    } catch (error) {
      console.error(
        'Unable to reset follower classification from undo.',
        error,
      );
    }
  }, []);

  const panelClasses = cn(
    isPopup
      ? 'w-full bg-white dark:bg-neutral-950'
      : [
          'fixed right-5 top-5 z-[2147483647] h-auto max-h-[640px] w-[380px] rounded-[32px] border border-neutral-200/80 bg-white/95 backdrop-blur-3xl transition-all duration-500 ease-out dark:border-white/10 dark:bg-neutral-900/90 overflow-hidden',
          isRootVisible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-2 opacity-0',
        ],
    'flex flex-col',
  );
  const hidePanel = useCallback(
    () => toggleRootVisibility(false),
    [toggleRootVisibility],
  );

  useClickOutside(
    isPopup,
    isRootVisible,
    hidePanel,
    extensionId,
    panelContainerRef,
    false,
  );

  return (
    <div className="relative h-full">
      <motion.div ref={panelContainerRef} className={panelClasses}>
        <div className="relative flex h-full flex-col overflow-y-auto">
          <div className="px-6 pt-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <img src={logoUrl} alt="X Bot Cleaner" className="h-11 w-11" />
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-neutral-600 dark:text-neutral-300">
                  X Bot Cleaner
                </p>
              </div>
              <div
                className="relative"
                ref={panelMenuRef}
                onMouseDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
              >
                <motion.button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={isPanelMenuOpen}
                  aria-controls={panelMenuId}
                  onClick={togglePanelMenu}
                  whileTap={{ scale: 0.95 }}
                  className={cn(
                    'inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-100 bg-white text-neutral-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 dark:border-white/20 dark:bg-neutral-800/80 dark:text-white',
                    isPanelMenuOpen
                      ? 'shadow-[0_20px_45px_rgba(15,23,42,0.18)]'
                      : 'hover:bg-neutral-50 dark:hover:bg-neutral-700/90',
                  )}
                >
                  <span className="sr-only">Open menu</span>
                  <HamburgerIcon className="h-5 w-5" aria-hidden="true" />
                </motion.button>
                <AnimatePresence>
                  {isPanelMenuOpen && (
                    <motion.div
                      id={panelMenuId}
                      role="menu"
                      onMouseDown={(event) => event.stopPropagation()}
                      onTouchStart={(event) => event.stopPropagation()}
                      initial={{ opacity: 0, y: -6, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.95 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute right-0 top-12 z-[2147483647] w-64 origin-top-right rounded-2xl border border-neutral-200/80 bg-white/95 p-2 shadow-2xl backdrop-blur-2xl dark:border-white/15 dark:bg-neutral-900/95"
                    >
                      <div className="flex flex-col gap-1">
                        <motion.button
                          type="button"
                          role="menuitem"
                          layout
                          disabled={!hasSavedData || isClearingData}
                          onClick={() => {
                            closePanelMenu();
                            promptClearDataDialog();
                          }}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.3em] text-neutral-700 transition hover:bg-rose-50/80 hover:text-rose-600 dark:text-neutral-100 dark:hover:bg-rose-500/10 dark:hover:text-rose-200',
                            (!hasSavedData || isClearingData) &&
                              'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-current',
                          )}
                        >
                          <DeleteIcon className="h-5 w-5" aria-hidden="true" />
                          <span>Clear saved data</span>
                        </motion.button>
                        <motion.button
                          type="button"
                          role="menuitem"
                          layout
                          onClick={() => {
                            toggleRootVisibility(false);
                            closePanelMenu();
                          }}
                          className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.3em] text-neutral-700 transition hover:bg-neutral-100/80 dark:text-neutral-100 dark:hover:bg-neutral-800/70"
                        >
                          <HideIcon className="h-5 w-5" aria-hidden="true" />
                          <span>Hide panel</span>
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-2 rounded-full border border-neutral-200/80 bg-white/95 p-1 text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500 dark:border-white/10 dark:bg-neutral-900/60">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex-1 rounded-full px-3 py-1.5 transition',
                    activeTab === tab.id
                      ? 'bg-blue-50 text-blue-600 dark:bg-neutral-800 dark:text-white'
                      : 'text-neutral-500 hover:bg-neutral-50 hover:text-blue-600 dark:text-neutral-400 dark:hover:bg-neutral-800/80 dark:hover:text-blue-200',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="h-full px-6 pt-4">
              {errorMessage && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {errorMessage}
                </div>
              )}
              {activeTab === 'insights' ? (
                <InsightsSection
                  stats={stats}
                  onRemoveBots={openRemoveBotsDialog}
                  removalState={removalState}
                  botCount={botCount}
                  actionDisabled={actionDisabled}
                  onCapture={handleAutoScrape}
                  captureCtaLabel={captureCtaLabel}
                  isScrapePending={isScrapePending}
                  isCapturing={scrapeStatus.phase === 'running'}
                  onShowBotSwipe={openBotSwipe}
                  botSwipeCount={botSwipeEntries.length}
                />
              ) : (
                <ListsSection
                  snapshot={snapshot}
                  classification={classification}
                  followerTarget={metrics.profileFollowerCount}
                />
              )}
            </div>
            <FloatingActions
              hideRealOnPage={hideRealOnPage}
              hideVerifiedOnPage={hideVerifiedOnPage}
              actionDisabled={actionDisabled}
              isTogglingVisibility={isTogglingVisibility}
              isTogglingVerifiedVisibility={isTogglingVerifiedVisibility}
              handleToggleVisibility={handleToggleVisibility}
              handleToggleVerifiedVisibility={handleToggleVerifiedVisibility}
              removalProgress={removalProgress}
              progressPercent={progressPercent}
              activeTab={activeTab}
            />
            <BotSwipeModal
              isOpen={isBotSwipeOpen}
              entries={botSwipeEntries}
              onClose={closeBotSwipe}
              onDecision={handleSwipeDecision}
              onUndo={handleUndoSwipeDecision}
            />
            <RemoveBotsDialog
              open={isRemoveBotsDialogOpen}
              onOpenChange={handleRemoveBotsDialogToggle}
              onConfirm={confirmRemoveBots}
              botCount={botCount}
              isRemoving={removalState === 'running'}
            />
            <ClearDataDialog
              open={isClearDataDialogOpen}
              onOpenChange={handleClearDialogToggle}
              onConfirm={handleResetAllData}
              isClearing={isClearingData}
              capturedCount={snapshot.totalCaptured ?? 0}
              classifiedCount={realCount + botCount}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

const swipeCardVariants = {
  exit: (direction: SwipeDirection) => ({
    x: direction === 'right' ? 320 : -320,
    rotate: direction === 'right' ? 18 : -18,
    opacity: 0,
    transition: { duration: 0.28 },
  }),
};

function BotSwipeModal({
  isOpen,
  entries,
  onClose,
  onDecision,
  onUndo,
}: {
  isOpen: boolean;
  entries: SwipeFollowerCard[];
  onClose: () => void;
  onDecision: (
    username: string,
    decision: 'real' | 'bot',
  ) => void | Promise<void>;
  onUndo: (username: string) => void | Promise<void>;
}) {
  const portalTarget = getExtensionAppRoot();
  if (!portalTarget) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[2147483647] flex items-center justify-center px-4 py-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close Bot Swipe overlay"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            key="botSwipePanel"
            className="relative z-10 w-full max-w-[420px]"
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 220, damping: 26 }}
          >
            <BotSwipeShowcase
              isOpen={isOpen}
              entries={entries}
              onDecision={onDecision}
              onUndo={onUndo}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    portalTarget,
  );
}

function getExtensionAppRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const host = document.getElementById(`${extensionId}-content-view-root`);
  if (host?.shadowRoot) {
    return (
      (host.shadowRoot.getElementById(
        `${extensionId}-app`,
      ) as HTMLElement | null) ??
      (host.shadowRoot.querySelector(
        `#${extensionId}-app`,
      ) as HTMLElement | null)
    );
  }
  return document.getElementById(`${extensionId}-app`);
}

function BotSwipeShowcase({
  isOpen,
  entries,
  onDecision,
  onUndo,
}: {
  isOpen: boolean;
  entries: SwipeFollowerCard[];
  onDecision: (
    username: string,
    decision: 'real' | 'bot',
  ) => void | Promise<void>;
  onUndo: (username: string) => void | Promise<void>;
}) {
  const [cards, setCards] = useState<SwipeFollowerCard[]>([]);
  const [dragDirections, setDragDirections] = useState<
    Record<string, SwipeDirection>
  >({});
  const [undoDirections, setUndoDirections] = useState<
    Record<string, SwipeDirection>
  >({});
  const cardsRef = useRef<SwipeFollowerCard[]>([]);
  const availableEntriesRef = useRef(entries);
  const dismissedRef = useRef<Set<string>>(new Set());
  const swipeHistoryRef = useRef<
    Array<{
      card: SwipeFollowerCard;
      direction: Exclude<SwipeDirection, null>;
      replacement: SwipeFollowerCard | null;
    }>
  >([]);

  const findNextEntry = useCallback((exclude: Set<string>) => {
    for (const entry of availableEntriesRef.current) {
      const normalized = normalizeUsername(entry.username);
      if (!normalized) continue;
      if (dismissedRef.current.has(normalized) || exclude.has(normalized)) {
        continue;
      }
      return entry;
    }
    return null;
  }, []);

  const seedCards = useCallback(() => {
    const seeded: SwipeFollowerCard[] = [];
    const exclude = new Set<string>();
    while (seeded.length < BOT_SWIPE_BATCH_SIZE) {
      const next = findNextEntry(exclude);
      if (!next) break;
      seeded.push(next);
      const normalized = normalizeUsername(next.username);
      if (normalized) {
        exclude.add(normalized);
      }
    }
    cardsRef.current = seeded;
    setCards(seeded);
    setDragDirections({});
  }, [findNextEntry]);

  useEffect(() => {
    availableEntriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    if (!isOpen) return;
    if (cardsRef.current.length === 0 && entries.length > 0) {
      seedCards();
    }
  }, [entries, isOpen, seedCards]);

  useEffect(() => {
    if (!isOpen) {
      dismissedRef.current = new Set();
      cardsRef.current = [];
      setCards([]);
      setDragDirections({});
      setUndoDirections({});
      swipeHistoryRef.current = [];
      return;
    }
    dismissedRef.current = new Set();
    seedCards();
  }, [isOpen, seedCards]);

  const handleSwipe = useCallback(
    (direction: Exclude<SwipeDirection, null>) => {
      const currentCards = cardsRef.current;
      if (!currentCards.length) return;
      const swipedCard = currentCards[currentCards.length - 1];
      const normalized = normalizeUsername(swipedCard.username);
      if (normalized) {
        dismissedRef.current.add(normalized);
      }

      const nextCards = currentCards.slice(0, currentCards.length - 1);
      const exclude = new Set(
        nextCards
          .map((card) => normalizeUsername(card.username))
          .filter(Boolean) as string[],
      );
      const nextEntry = findNextEntry(exclude);
      const replacement = nextEntry ?? null;
      if (nextEntry) {
        nextCards.unshift(nextEntry);
      }

      cardsRef.current = nextCards;
      setCards(nextCards);
      setDragDirections((prev) => {
        const clone = { ...prev };
        delete clone[swipedCard.username];
        return clone;
      });
      setUndoDirections((prev) => {
        const clone = { ...prev };
        delete clone[swipedCard.username];
        return clone;
      });

      swipeHistoryRef.current.push({
        card: swipedCard,
        direction,
        replacement,
      });

      const status = direction === 'right' ? 'real' : 'bot';
      void onDecision(swipedCard.username, status);
    },
    [findNextEntry, onDecision],
  );

  const handleDragUpdate = (username: string, direction: SwipeDirection) => {
    setDragDirections((prev) => ({ ...prev, [username]: direction }));
  };

  const handleUndo = useCallback(() => {
    if (!swipeHistoryRef.current.length) return;
    const last = swipeHistoryRef.current.pop();
    if (!last) return;

    const normalized = normalizeUsername(last.card.username);
    if (normalized) {
      dismissedRef.current.delete(normalized);
    }

    const nextCards = [...cardsRef.current];

    if (last.replacement) {
      const replacementNormalized = normalizeUsername(
        last.replacement.username,
      );
      const replacementIndex = nextCards.findIndex((card) => {
        const normalizedCard = normalizeUsername(card.username);
        return !!normalizedCard && normalizedCard === replacementNormalized;
      });
      if (replacementIndex !== -1) {
        nextCards.splice(replacementIndex, 1);
      }
    }

    nextCards.push(last.card);
    cardsRef.current = nextCards;
    setCards(nextCards);
    setUndoDirections((prev) => ({
      ...prev,
      [last.card.username]: last.direction,
    }));
    setDragDirections((prev) => {
      const clone = { ...prev };
      delete clone[last.card.username];
      return clone;
    });
    void onUndo(last.card.username);
  }, [onUndo]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'z'
      ) {
        event.preventDefault();
        handleUndo();
        return;
      }
      if (event.key === 'ArrowRight' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        // Simulate right swipe animation
        const topCard = cardsRef.current[cardsRef.current.length - 1];
        if (topCard) {
          setDragDirections((prev) => ({
            ...prev,
            [topCard.username]: 'right',
          }));
          // Small delay to show the animation
          setTimeout(() => {
            handleSwipe('right');
          }, 150);
        }
        return;
      }
      if (event.key === 'ArrowLeft' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        // Simulate left swipe animation
        const topCard = cardsRef.current[cardsRef.current.length - 1];
        if (topCard) {
          setDragDirections((prev) => ({
            ...prev,
            [topCard.username]: 'left',
          }));
          // Small delay to show the animation
          setTimeout(() => {
            handleSwipe('left');
          }, 150);
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleSwipe, isOpen]);

  const handleUndoAnimationComplete = useCallback((username: string) => {
    setUndoDirections((prev) => {
      if (!prev[username]) return prev;
      const clone = { ...prev };
      delete clone[username];
      return clone;
    });
  }, []);

  if (!cards.length) {
    return (
      <div className="flex h-[360px] w-full items-center justify-center rounded-[36px] border border-dashed border-white/30 bg-white/5 text-[11px] uppercase tracking-[0.35em] text-white/70">
        All caught up
      </div>
    );
  }

  return (
    <div className="relative mx-auto h-[520px] w-full max-w-[400px]">
      <AnimatePresence>
        {cards.map((card, index) => {
          const isTopCard = index === cards.length - 1;
          return (
            <BotSwipeCard
              key={card.username}
              card={card}
              isTopCard={isTopCard}
              index={index}
              total={cards.length}
              onSwipe={handleSwipe}
              direction={dragDirections[card.username] ?? null}
              returnDirection={undoDirections[card.username] ?? null}
              onUndoAnimationComplete={handleUndoAnimationComplete}
              onDragUpdate={(direction) =>
                handleDragUpdate(card.username, direction)
              }
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function BotSwipeCard({
  card,
  isTopCard,
  index,
  total,
  onSwipe,
  direction,
  returnDirection,
  onUndoAnimationComplete,
  onDragUpdate,
}: {
  card: SwipeFollowerCard;
  isTopCard: boolean;
  index: number;
  total: number;
  onSwipe: (direction: Exclude<SwipeDirection, null>) => void;
  direction: SwipeDirection;
  returnDirection: SwipeDirection;
  onUndoAnimationComplete: (username: string) => void;
  onDragUpdate: (direction: SwipeDirection) => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-20, 20]);
  const rightSwipeOpacity = useTransform(x, [20, 100], [0, 1]);
  const leftSwipeOpacity = useTransform(x, [-100, -20], [1, 0]);
  const avatarSrc = getHighResAvatarUrl(card.avatarUrl);

  useEffect(() => {
    if (!returnDirection || typeof window === 'undefined') return;
    const startingX = returnDirection === 'right' ? 220 : -220;
    x.set(startingX);
    const animation = animate(x, 0, {
      type: 'spring',
      stiffness: 260,
      damping: 30,
    });
    const timer = window.setTimeout(
      () => onUndoAnimationComplete(card.username),
      320,
    );
    return () => {
      animation.stop();
      window.clearTimeout(timer);
    };
  }, [card.username, onUndoAnimationComplete, returnDirection, x]);

  const handleDrag = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    if (!isTopCard) return;
    const dir = info.offset.x > 0 ? 'right' : 'left';
    onDragUpdate(dir);
  };

  const handleDragEnd = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    if (!isTopCard) return;
    if (Math.abs(info.offset.x) > 110) {
      const dir = info.offset.x > 0 ? 'right' : 'left';
      onSwipe(dir);
    } else {
      onDragUpdate(null);
    }
  };

  const isSecondCard = index === total - 2;
  const fallbackInitial =
    card.displayName?.charAt(0) ?? card.username.charAt(0) ?? '?';
  const statusLabel =
    card.status === 'bot' ? 'Bot' : card.status === 'real' ? 'Trusted' : null;
  const shouldFadeBio = (card.bio?.length ?? 0) > 140;
  const stackDepth = total - 1 - index;
  const stackScale = 1 - stackDepth * 0.04;
  const stackTranslateY = stackDepth * 10;
  const stackOpacity = index < total - 3 ? 0 : 1;

  return (
    <motion.div
      drag={isTopCard ? 'x' : false}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.5}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      style={{
        x,
        rotate,
        zIndex: index,
        touchAction: isTopCard ? 'pan-y' : 'auto',
        userSelect: 'none',
      }}
      className={cn(
        'absolute inset-0 overflow-hidden rounded-[44px] bg-neutral-950 shadow-[0_40px_70px_rgba(2,6,23,0.65)]',
        !avatarSrc &&
          'bg-gradient-to-br from-neutral-800 via-neutral-900 to-neutral-950',
      )}
      initial={{
        scale: stackScale,
        y: stackTranslateY,
        opacity: stackOpacity,
      }}
      animate={{
        scale: stackScale,
        y: stackTranslateY,
        opacity: stackOpacity,
        cursor: isTopCard ? 'grab' : 'default',
        boxShadow: isTopCard
          ? '0 45px 70px rgba(2,6,23,0.65)'
          : '0 25px 35px rgba(2,6,23,0.35)',
      }}
      whileDrag={{ cursor: 'grabbing' }}
      custom={direction}
      variants={swipeCardVariants}
      exit="exit"
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
    >
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt={card.displayName ?? card.username}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-neutral-900 text-6xl font-semibold uppercase text-white/40">
          {fallbackInitial}
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
      <div className="absolute inset-x-5 bottom-5 text-white">
        <div className="relative overflow-hidden rounded-[40px] bg-gradient-to-br from-white/60 via-white/15 to-white/5 p-[1.5px] shadow-[0_28px_70px_rgba(2,6,23,0.65)]">
          <div
            className="absolute inset-0 rounded-[40px] bg-white/40 opacity-20 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative rounded-[38px] bg-neutral-950/55 px-6 py-6 backdrop-blur-3xl">
            <div
              className="pointer-events-none absolute inset-x-6 top-0 h-10 rounded-b-full bg-white/15 opacity-70 blur-lg"
              aria-hidden="true"
            />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="leading-tight text-2xl font-semibold">
                    {card.displayName}
                  </p>
                  <p className="text-[11px] uppercase tracking-[0.45em] text-white/70">
                    @{card.username}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {statusLabel && (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.35em]',
                        card.status === 'bot'
                          ? 'bg-rose-500/25 text-rose-50'
                          : 'bg-emerald-500/25 text-emerald-50',
                      )}
                    >
                      {card.status === 'bot' ? (
                        <Danger className="h-4 w-4" />
                      ) : (
                        <ShieldTick className="h-4 w-4" />
                      )}
                      {statusLabel}
                    </span>
                  )}
                  {card.isVerified && (
                    <span className="inline-flex rounded-full bg-white/10 p-1.5 text-sky-300">
                      <VerifiedBadgeIcon className="h-4 w-4" />
                    </span>
                  )}
                </div>
              </div>
              {card.bio && (
                <div className="relative mt-3">
                  <p className="leading-relaxed max-h-24 overflow-hidden pr-3 text-sm text-white/90 [-webkit-box-orient:vertical] [-webkit-line-clamp:4] [display:-webkit-box]">
                    {card.bio}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {isTopCard && (
        <>
          <motion.div
            style={{ opacity: leftSwipeOpacity }}
            className="pointer-events-none absolute inset-0 rounded-[44px]"
          >
            <div
              className="absolute inset-0 rounded-[44px]"
              style={{
                boxShadow: 'inset 0px -90px 70px rgba(224,83,83,0.8)',
              }}
            />
            <div className="absolute inset-0 mb-32 flex items-center justify-center px-6 text-white">
              <div className="flex flex-col items-center gap-3 rounded-[40px] bg-rose-900/40 px-6 py-6 text-base font-semibold shadow-[0_35px_65px_rgba(15,23,42,0.45)]">
                <BotSwipeIcon className="h-40 w-40 text-rose-400 dark:text-rose-500" />
                <span className="text-lg tracking-[0.35em] text-rose-400 dark:text-rose-500">
                  Bot
                </span>
              </div>
            </div>
          </motion.div>
          <motion.div
            style={{ opacity: rightSwipeOpacity }}
            className="pointer-events-none absolute inset-0 rounded-[44px]"
          >
            <div
              className="absolute inset-0 rounded-[44px]"
              style={{
                boxShadow: 'inset 0px -90px 70px rgba(16,185,129,0.75)',
              }}
            />
            <div className="absolute inset-0 mb-32 flex items-center justify-center px-6 text-white">
              <div className="flex flex-col items-center gap-3 rounded-[40px] bg-emerald-900/40 px-6 py-6 text-base font-semibold shadow-[0_35px_65px_rgba(15,23,42,0.45)]">
                <RealSwipeIcon className="h-40 w-40 text-emerald-400 dark:text-emerald-500" />
                <span className="text-lg tracking-[0.35em] text-emerald-400 dark:text-emerald-500">
                  Real
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
      {isSecondCard && (
        <div className="pointer-events-none absolute inset-0 rounded-[44px] bg-black/20 backdrop-blur-[1px]" />
      )}
    </motion.div>
  );
}

function InsightsSection({
  stats,
  onRemoveBots,
  removalState,
  botCount,
  actionDisabled,
  onCapture,
  captureCtaLabel,
  isScrapePending,
  isCapturing,
  onShowBotSwipe,
  botSwipeCount,
}: {
  stats: Array<{
    label: string;
    value: string | number;
    description: string;
    icon: typeof ShieldTick;
    tone: 'emerald' | 'rose' | 'blue';
    span: number;
  }>;
  onRemoveBots: () => void;
  removalState: RemovalState;
  botCount: number;
  actionDisabled: boolean;
  onCapture: () => void;
  captureCtaLabel: string;
  isScrapePending: boolean;
  isCapturing: boolean;
  onShowBotSwipe: () => void;
  botSwipeCount: number;
}) {
  const toneStyles = {
    emerald: 'text-emerald-500',
    rose: 'text-rose-500',
    blue: 'text-blue-500',
  };
  const savedStat = stats.find((stat) => stat.label === 'Saved');
  const trustedStat = stats.find((stat) => stat.label === 'Trusted');
  const TrustedIcon = trustedStat?.icon;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-4">
        {savedStat && (
          <SavedCaptureCard
            stat={savedStat}
            onCapture={onCapture}
            ctaLabel={captureCtaLabel}
            isScrapePending={isScrapePending}
            isCapturing={isCapturing}
          />
        )}
        {trustedStat && (
          <motion.div
            key={trustedStat.label}
            layout
            className="rounded-[28px] border border-neutral-200/80 bg-white p-4 dark:border-white/10 dark:bg-neutral-900/70"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-500">
                  {trustedStat.label}
                </p>
                <p className="text-3xl font-semibold text-neutral-900 dark:text-white">
                  {trustedStat.value}
                </p>
              </div>
              {TrustedIcon && (
                <TrustedIcon
                  size="32"
                  className={toneStyles[trustedStat.tone]}
                />
              )}
            </div>
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-300">
              {trustedStat.description}
            </p>
          </motion.div>
        )}
      </section>
      <section className="grid grid-cols-2 gap-4">
        <SwipeCatchCard
          onShowBotSwipe={onShowBotSwipe}
          botSwipeCount={botSwipeCount}
        />
        <RemoveBotsCard
          botCount={botCount}
          removalState={removalState}
          onRemoveBots={onRemoveBots}
          actionDisabled={actionDisabled}
        />
      </section>
    </div>
  );
}
function SavedCaptureCard({
  stat,
  onCapture,
  ctaLabel,
  isScrapePending,
  isCapturing,
}: {
  stat: {
    label: string;
    value: string | number;
    description: string;
    icon: typeof ShieldTick;
  };
  onCapture: () => void;
  ctaLabel: string;
  isScrapePending: boolean;
  isCapturing: boolean;
}) {
  const Icon = stat.icon;

  return (
    <motion.div
      layout
      className="rounded-[28px] border border-neutral-200/80 bg-white p-4 dark:border-white/10 dark:bg-neutral-900/70"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-500">
            {stat.label}
          </p>
          <p className="text-3xl font-semibold text-neutral-900 dark:text-white">
            {stat.value}
          </p>
        </div>
        <Icon size="32" className="text-blue-500" />
      </div>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-300">
        {stat.description}
      </p>
      {isCapturing && (
        <span className="mt-3 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-600 dark:bg-blue-500/10 dark:text-blue-200">
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500 dark:bg-blue-300" />
          Running
        </span>
      )}
    </motion.div>
  );
}

function SwipeCatchCard({
  onShowBotSwipe,
  botSwipeCount: _botSwipeCount,
}: {
  onShowBotSwipe: () => void;
  botSwipeCount: number;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.button
      type="button"
      layout
      onClick={onShowBotSwipe}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      className="group relative overflow-hidden rounded-[28px] border border-neutral-200 bg-white px-4 pb-4 pt-3 text-left text-neutral-700 transition-all duration-200 hover:bg-neutral-50 hover:text-neutral-800"
    >
      <div className="flex flex-col items-start justify-between gap-3">
        <p className="text-2xl font-semibold leading-[32px] tracking-tight">
          Swipe&apos;n Catch
        </p>
        <div className="mb-2 flex w-full items-end justify-end pr-4">
          <SwipeCatchCardStack isHovered={isHovered} />
        </div>
      </div>
    </motion.button>
  );
}

const swipeCatchCardTransition: Transition<any> = {
  type: 'spring',
  duration: 0.5,
  stiffness: 180,
  damping: 16,
};

const swipeCatchBaseCardVariants = {
  rest: { rotate: 0, x: 0, y: 0, scale: 1, opacity: 1 },
  hover: { opacity: 1, rotate: -15, x: -19, y: 0 },
};

const swipeCatchBotCardVariants = {
  rest: { opacity: 0, rotate: 0, x: 0, y: 0 },
  hover: { opacity: 1, rotate: -15, x: -19, y: 0 },
};

const swipeCatchIncomingCardVariants = {
  rest: { opacity: 0, rotate: 0, x: 0, y: 0, scale: 0.9 },
  hover: { opacity: 1, rotate: 0, x: 0, y: 0, scale: 1 },
};

const swipeCatchRealCardVariants = {
  rest: { x: 19, y: 0, rotate: 15, opacity: 1, filter: 'blur(0px)' },
  hover: { x: 64, y: 5, rotate: 24, opacity: 0, filter: 'blur(4px)' },
};

function SwipeCatchCardStack({ isHovered }: { isHovered: boolean }) {
  const animationState = isHovered ? 'hover' : 'rest';

  return (
    <div className="pointer-events-none relative mr-1 mt-1 h-10 w-10">
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        variants={swipeCatchIncomingCardVariants}
        initial="rest"
        animate={animationState}
        transition={swipeCatchCardTransition}
      >
        <SwipeStackEmptyCard className="h-20 w-auto" />
      </motion.div>
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        variants={swipeCatchBaseCardVariants}
        initial="rest"
        animate={animationState}
        transition={swipeCatchCardTransition}
      >
        <SwipeStackEmptyCard className="h-20 w-auto" />
      </motion.div>
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        variants={swipeCatchBotCardVariants}
        initial="rest"
        animate={animationState}
        transition={swipeCatchCardTransition}
      >
        <SwipeStackBotCard className="h-20 w-auto" />
      </motion.div>
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        variants={swipeCatchRealCardVariants}
        initial="rest"
        animate={animationState}
        transition={{ ...swipeCatchCardTransition, stiffness: 180 }}
      >
        <SwipeStackRealCard className="h-20 w-auto" />
      </motion.div>
    </div>
  );
}

function RemoveBotsCard({
  botCount,
  removalState,
  onRemoveBots,
  actionDisabled,
}: {
  botCount: number;
  removalState: RemovalState;
  onRemoveBots: () => void;
  actionDisabled: boolean;
}) {
  const [isTrashHovering, setIsTrashHovering] = useState(false);
  const hasBots = botCount > 0;
  const isRunning = removalState === 'running';
  const disabled = isRunning || botCount === 0;
  const navigationOnly = !disabled && actionDisabled;
  const cardTone =
    hasBots || isRunning
      ? 'border-rose-200/80 bg-rose-50 text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100 hover:bg-white dark:hover:bg-rose-600/20 '
      : 'border-rose-500/80 bg-rose-500 text-white dark:border-rose-500/60 dark:bg-rose-500/80';
  const iconColor =
    hasBots || isRunning
      ? 'text-rose-600/50 dark:text-rose-100/50'
      : 'text-white/50';
  const cardStatus = isRunning
    ? 'Cleaning in progress'
    : hasBots
      ? `${botCount}`
      : 'All caught up';
  useEffect(() => {
    if (disabled && isTrashHovering) {
      setIsTrashHovering(false);
    }
  }, [disabled, isTrashHovering]);
  const handleHoverStart = () => {
    if (disabled) return;
    setIsTrashHovering(true);
  };
  const handleHoverEnd = () => {
    setIsTrashHovering(false);
  };

  return (
    <motion.button
      type="button"
      layout
      aria-label="Remove bots"
      onClick={onRemoveBots}
      disabled={disabled}
      onHoverStart={handleHoverStart}
      onHoverEnd={handleHoverEnd}
      onFocus={handleHoverStart}
      onBlur={handleHoverEnd}
      className={cn(
        'relative overflow-hidden rounded-[28px] border px-4 pb-4 pt-2.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 dark:focus-visible:ring-rose-400/40',
        cardTone,
        disabled && 'cursor-not-allowed opacity-80',
        navigationOnly && 'opacity-90',
      )}
    >
      <div className="flex h-full flex-col items-start justify-between">
        <p className="text-2xl font-semibold tracking-tight">
          {isRunning ? 'Removing…' : 'Remove Bots'}
        </p>
        <p className="mt-2 rounded-full border border-rose-200/80 bg-white bg-opacity-70 px-2 py-0.5 text-sm font-medium tracking-wide text-rose-700 opacity-80 dark:border-rose-500/40 dark:bg-neutral-900 dark:text-rose-100">
          {cardStatus}
        </p>
      </div>
      <RemoveBotsTrashIcon
        isHovering={isTrashHovering}
        className={cn(
          'w-142 absolute bottom-2 right-2 h-16',
          iconColor,
          disabled && 'opacity-80',
        )}
      />
    </motion.button>
  );
}

const removeBotsTrashBinVariants: Variants = {
  rest: {
    opacity: 0,
    y: 28,
    scale: 0.6,
    transition: { duration: 0.4, ease: 'easeInOut' },
  },
  hover: {
    opacity: [0, 1, 1, 1],
    y: [32, 0, 0, 0],
    scale: [0, 1, 1, 1],
    transition: {
      duration: 1,
      damping: 16,
      stiffness: 280,
      times: [0, 0.6, 0.8, 1],
      ease: ['easeOut', 'easeInOut', 'easeOut', 'easeOut'] as const,
    },
  },
};

const removeBotsTrashLidVariants: Variants = {
  rest: {
    rotate: 0,
    y: 0,
    transition: { duration: 0.4, ease: 'easeInOut' },
    transformOrigin: '4px 5px',
  },
  hover: {
    rotate: [0, -100, -90, -45, 0],
    y: [0, -8, -8, -8, 0],
    x: [0, -2, -2, 0, 0],
    transition: {
      duration: 1.05,
      times: [0, 0.4, 0.6, 0.8, 1],
      ease: ['easeOut', 'easeInOut', 'easeIn', 'easeInOut', 'easeOut'] as const,
    },
  },
};

const removeBotsTrashBotVariants: Variants = {
  rest: {
    y: 0,
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.45, ease: 'easeInOut' },
  },
  hover: {
    y: [0, -22, -10, 10, 20],
    opacity: [1, 1, 1, 0.2, 0],
    scale: [1, 0.6, 0.5, 0, 0],
    filter: [
      'blur(0px)',
      'blur(0px)',
      'blur(0px)',
      'blur(0px)',
      'blur(8px)',
      'blur(10px)',
    ],
    transition: {
      duration: 1.05,
      damping: 16,
      stiffness: 280,
      times: [0, 0.3, 0.6, 0.9, 1],
      ease: ['easeOut', 'easeOut', 'easeOut', 'easeIn', 'easeIn'] as const,
    },
  },
};

function RemoveBotsTrashIcon({
  className = '',
  isHovering,
}: {
  className?: string;
  isHovering: boolean;
}) {
  const animationState = isHovering ? 'hover' : 'rest';

  return (
    <motion.svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      style={{ overflow: 'visible', transform: 'scaleX(-1)' }}
      aria-hidden="true"
    >
      <motion.g
        variants={removeBotsTrashBinVariants}
        initial="rest"
        animate={animationState}
        style={{ transformOrigin: '12px 20px' }}
      >
        <path d="M4 10C4 8.89543 4.89543 8 6 8H18C19.1046 8 20 8.89543 20 10V20C20 21.1046 19.1046 22 18 22H6.00002C4.89546 22 4.00003 21.1046 4.00002 20L4 10ZM7 10C6.44771 10 6 10.4477 6 11V19C6 19.5523 6.44771 20 7 20H17C17.5523 20 18 19.5523 18 19V11C18 10.4477 17.5523 10 17 10H7ZM9 13C9 12.4477 9.44771 12 10 12C10.5523 12 11 12.4477 11 13V17C11 17.5523 10.5523 18 10 18C9.44771 18 9 17.5523 9 17V13ZM13 13C13 12.4477 13.4477 12 14 12C14.5523 12 15 12.4477 15 13V17C15 17.5523 14.5523 18 14 18C13.4477 18 13 17.5523 13 17V13Z" />
        <motion.path
          d="M15 2C16.1046 2 17 2.89543 17 4V5.00002H21C21.5523 5.00002 22 5.44774 22 6.00002C22 6.55231 21.5523 7.00002 21 7.00002H3C2.44772 7.00002 2 6.55231 2 6.00002C2 5.44774 2.44772 5.00002 3 5.00002H7V4C7 2.89543 7.89543 2 9 2H15ZM9.75 3.50002C9.33579 3.50002 9 3.83581 9 4.25002C9 4.66424 9.33579 5.00002 9.75 5.00002H14.25C14.6642 5.00002 15 4.66424 15 4.25002C15 3.83581 14.6642 3.50002 14.25 3.50002H9.75Z"
          variants={removeBotsTrashLidVariants}
          initial="rest"
          animate={animationState}
          style={{ transformOrigin: '4px 5px' }}
          fill="currentColor"
        />
      </motion.g>
      <motion.g
        variants={removeBotsTrashBotVariants}
        initial="rest"
        animate={animationState}
        style={{ transformOrigin: '12px 12px' }}
      >
        <BotGlyphPath fill="currentColor" />
      </motion.g>
    </motion.svg>
  );
}

function ListsSection({
  snapshot,
  classification,
  followerTarget,
}: {
  snapshot: FollowerSnapshotState;
  classification: FollowerClassificationState;
  followerTarget: number | null;
}) {
  const [filter, setFilter] = useState<ScrapedFilter>('all');
  const [activeReviewUsername, setActiveReviewUsername] = useState<
    string | null
  >(null);
  const [transientStatuses, setTransientStatuses] = useState<
    Partial<Record<string, FollowerStatus>>
  >({});
  const realSet = useMemo(
    () => new Set(classification.realFollowers),
    [classification.realFollowers],
  );
  const botSet = useMemo(
    () => new Set(classification.botFollowers),
    [classification.botFollowers],
  );
  const entries = useMemo(() => {
    return Object.values(snapshot.entries ?? {}).sort(
      (a, b) => (b.scrapedAt ?? 0) - (a.scrapedAt ?? 0),
    );
  }, [snapshot.entries]);

  const resolveStatus = useCallback(
    (username: string): FollowerStatus => {
      const normalized = normalizeUsername(username);
      if (!normalized) return 'unknown';
      const override = transientStatuses[normalized];
      if (override === 'real' || override === 'bot') {
        return override;
      }
      return getStatusFromSets(normalized, realSet, botSet);
    },
    [transientStatuses, realSet, botSet],
  );

  const counts = useMemo(() => {
    const aggregate = {
      all: entries.length,
      trusted: 0,
      bots: 0,
      unreviewed: 0,
    };
    entries.forEach((entry) => {
      const status = resolveStatus(entry.username);
      if (status === 'real') {
        aggregate.trusted += 1;
      } else if (status === 'bot') {
        aggregate.bots += 1;
      } else {
        aggregate.unreviewed += 1;
      }
    });
    return aggregate;
  }, [entries, resolveStatus]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const status = resolveStatus(entry.username);
      if (filter === 'trusted') return status === 'real';
      if (filter === 'bots') return status === 'bot';
      if (filter === 'unreviewed') return status === 'unknown';
      return true;
    });
  }, [entries, filter, resolveStatus]);

  const scrapedCount = snapshot.totalCaptured;

  const filterOptions: Array<{
    id: ScrapedFilter;
    label: string;
    count: number;
  }> = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'trusted', label: 'Trusted', count: counts.trusted },
    { id: 'bots', label: 'Bots', count: counts.bots },
    { id: 'unreviewed', label: 'Unreviewed', count: counts.unreviewed },
  ];

  useEffect(() => {
    setTransientStatuses((current) => {
      const next = { ...current };
      let changed = false;
      Object.keys(next).forEach((username) => {
        if (realSet.has(username) || botSet.has(username)) {
          delete next[username];
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [realSet, botSet]);

  const toggleReview = useCallback((username: string) => {
    const normalized = normalizeUsername(username);
    if (!normalized) return;
    setActiveReviewUsername((current) =>
      current === normalized ? null : normalized,
    );
  }, []);

  const closeReview = useCallback(() => {
    setActiveReviewUsername(null);
  }, []);

  const classifyFromList = useCallback(
    async (username: string, decision: 'real' | 'bot') => {
      try {
        const normalized = normalizeUsername(username);
        if (!normalized) return;
        await followerClassificationStorage.classify(normalized, decision);
        setTransientStatuses((current) => ({
          ...current,
          [normalized]: decision,
        }));
        setActiveReviewUsername(null);
      } catch (error) {
        console.error('Unable to classify follower from list view.', error);
        throw error;
      }
    },
    [],
  );

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div
            className="flex flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full border border-neutral-200/80 bg-white/95 px-1 py-1 [-ms-overflow-style:none] [scrollbar-width:none] dark:border-white/10 dark:bg-neutral-900/60 [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {filterOptions.map((option) => (
              <ScrapeFilterButton
                key={option.id}
                label={option.label}
                count={option.count}
                active={filter === option.id}
                onClick={() => setFilter(option.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {filteredEntries.length === 0 ? (
          <div className="rounded-[26px] border border-dashed border-neutral-200 bg-white px-4 py-6 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-300">
            {scrapedCount === 0
              ? 'Capture all followers to build your list.'
              : 'No accounts match this filter yet.'}
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const normalizedUsername = normalizeUsername(entry.username);
            const reviewIdentifier =
              normalizedUsername || entry.username || `${entry.scrapedAt}`;
            const status = resolveStatus(entry.username);
            return (
              <ScrapedListItem
                key={reviewIdentifier}
                entry={entry}
                status={status}
                isReviewing={activeReviewUsername === reviewIdentifier}
                onReviewToggle={() => toggleReview(entry.username)}
                onReviewClose={closeReview}
                onClassify={(decision) =>
                  classifyFromList(entry.username, decision)
                }
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function ScrapeFilterButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold transition',
        active
          ? 'border-blue-200 bg-blue-50/80 text-blue-700 dark:border-blue-400/60 dark:bg-blue-500/10 dark:text-white'
          : 'border-neutral-200/80 bg-white text-neutral-600 hover:border-blue-200 hover:bg-blue-50/60 hover:text-blue-600 dark:border-white/10 dark:bg-neutral-800/50 dark:text-neutral-400 dark:hover:border-blue-300/60 dark:hover:bg-neutral-800/80 dark:hover:text-blue-100',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[10px] font-medium',
          active
            ? 'bg-white text-neutral-700 dark:bg-white/10 dark:text-neutral-100'
            : 'bg-neutral-100 text-neutral-500 dark:bg-white/10 dark:text-neutral-400',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function ScrapedListItem({
  entry,
  status,
  isReviewing,
  onReviewToggle,
  onReviewClose,
  onClassify,
}: {
  entry: FollowerSnapshotEntry;
  status: FollowerStatus;
  isReviewing: boolean;
  onReviewToggle: () => void;
  onReviewClose: () => void;
  onClassify: (decision: 'real' | 'bot') => Promise<void>;
}) {
  // TODO: Wire row-level taps to open the classification sheet or trigger quick
  //       actions so users can mark bots/trusted without going back to X.com.
  return (
    <div className="relative flex items-center gap-3 rounded-[28px] border border-neutral-200/80 bg-white px-4 py-3 text-sm text-neutral-700 dark:border-white/10 dark:bg-neutral-900/70 dark:text-neutral-200">
      <div className="flex w-full items-start gap-3">
        <ScrapedAvatar entry={entry} />
        <div className="w-full">
          <div className="flex w-full items-start justify-between gap-2">
            <div className="flex flex-col items-start gap-2">
              <div className="flex flex-row items-center gap-2">
                <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                  {entry.displayName ?? `@${entry.username}`}
                </p>
                {entry.isVerified && (
                  <span className="inline-flex items-center justify-center rounded-full bg-blue-50 p-0.5 text-blue-500 dark:bg-white/10">
                    <VerifiedBadgeIcon className="h-3 w-3" />
                  </span>
                )}
              </div>
              <p className="text-[10px] uppercase tracking-[0.35em] text-neutral-500">
                @{entry.username}
              </p>
            </div>

            <ScrapedStatusBadge
              status={status}
              isReviewing={isReviewing}
              onReviewToggle={onReviewToggle}
              onReviewClose={onReviewClose}
              onClassify={onClassify}
            />
          </div>
          {entry.bio && (
            <p className="mt-1 overflow-hidden text-ellipsis text-xs text-neutral-500 [-webkit-box-orient:vertical] [-webkit-line-clamp:3] [display:-webkit-box] dark:text-neutral-300">
              {entry.bio}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ScrapedStatusBadge({
  status,
  isReviewing,
  onReviewToggle,
  onReviewClose,
  onClassify,
}: {
  status: FollowerStatus;
  isReviewing: boolean;
  onReviewToggle: () => void;
  onReviewClose: () => void;
  onClassify: (decision: 'real' | 'bot') => Promise<void>;
}) {
  return (
    <ScrapedReviewActions
      status={status}
      isOpen={isReviewing}
      onToggle={onReviewToggle}
      onClose={onReviewClose}
      onClassify={onClassify}
    />
  );
}

function ScrapedReviewActions({
  status,
  isOpen,
  onToggle,
  onClose,
  onClassify,
}: {
  status: FollowerStatus;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onClassify: (decision: 'real' | 'bot') => Promise<void>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      // Shadow DOM retargeting hides the real target from document listeners,
      // so we rely on the composed path + contains fallback.
      const target = (event.target as Node) ?? null;
      const path =
        typeof event.composedPath === 'function'
          ? (event.composedPath() as EventTarget[])
          : null;

      const containsTarget = (element: HTMLElement | null) => {
        if (!element) return false;
        if (path?.includes(element)) return true;
        if (target) return element.contains(target);
        return false;
      };

      if (
        containsTarget(menuRef.current) ||
        containsTarget(buttonRef.current)
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleDecision = async (decision: 'real' | 'bot') => {
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await onClassify(decision);
    } catch (err) {
      console.error('Unable to classify follower from inline review.', err);
      setError('Unable to update status. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isKnownStatus = status === 'real' || status === 'bot';

  const triggerContent = () => {
    if (!isKnownStatus) {
      return 'Review';
    }
    const label = status === 'real' ? 'Real' : 'Bot';
    return (
      <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em]">
        <span className="inline-flex items-center gap-2 text-neutral-700 group-hover:hidden dark:text-neutral-200">
          {status === 'real' ? (
            <RealSwipeIcon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
          ) : (
            <BotSwipeIcon className="h-3.5 w-3.5 text-rose-600 dark:text-rose-300" />
          )}
          <span>{label}</span>
        </span>
        <span className="hidden text-neutral-700 group-hover:inline-flex dark:text-neutral-200">
          Review
        </span>
      </span>
    );
  };

  return (
    <div className="absolute right-2.5 top-2.5 flex flex-col items-end gap-2">
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        disabled={isSubmitting}
        className={cn(
          'group flex min-w-[96px] items-center justify-center rounded-full border border-neutral-200/80 bg-white px-3 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.35em] text-neutral-600 backdrop-blur-lg transition hover:border-neutral-400 hover:text-neutral-900 dark:border-white/20 dark:bg-neutral-900/70 dark:text-neutral-200 dark:hover:text-white',
          isOpen && 'border-neutral-400 dark:border-white/40',
          isSubmitting && 'cursor-not-allowed opacity-50',
        )}
      >
        {triggerContent()}
      </button>
      {isOpen && (
        <div
          ref={menuRef}
          className="z-10 inline-flex min-w-[150px] flex-col gap-1 rounded-[22px] border border-neutral-200/80 bg-white/95 p-3 shadow-2xl backdrop-blur-lg dark:border-white/15 dark:bg-neutral-900/95"
        >
          <ReviewActionButton
            label="Mark real"
            tone="real"
            icon={<RealSwipeIcon className="h-4 w-4" />}
            onClick={() => handleDecision('real')}
            disabled={isSubmitting}
          />
          <ReviewActionButton
            label="Mark bot"
            tone="bot"
            icon={<BotSwipeIcon className="h-4 w-4" />}
            onClick={() => handleDecision('bot')}
            disabled={isSubmitting}
          />
          {error && (
            <p className="px-1 pt-1 text-[9px] font-medium uppercase tracking-[0.25em] text-rose-500">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewActionButton({
  label,
  tone,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  tone: 'real' | 'bot';
  icon: ReactElement;
  onClick: () => void;
  disabled: boolean;
}) {
  const toneClasses = {
    real: 'border-emerald-200/70 bg-emerald-50/90 text-emerald-700 hover:border-emerald-400 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100',
    bot: 'border-rose-200/70 bg-rose-50/90 text-rose-700 hover:border-rose-400 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100',
  } as const;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-2 rounded-[16px] border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.25em] transition hover:shadow-sm',
        toneClasses[tone],
        disabled && 'cursor-not-allowed opacity-60 hover:shadow-none',
      )}
    >
      <span className="flex items-center gap-2 text-[10px] tracking-[0.08em]">
        {icon}
        {label}
      </span>
    </button>
  );
}

function ScrapedAvatar({ entry }: { entry: FollowerSnapshotEntry }) {
  const avatarSrc = getHighResAvatarUrl(entry.avatarUrl);
  if (avatarSrc) {
    return (
      <img
        src={avatarSrc}
        alt={entry.displayName ?? entry.username}
        className="h-11 w-11 rounded-2xl border border-neutral-200/80 object-cover dark:border-white/10"
      />
    );
  }

  const fallbackLetter =
    entry.displayName?.charAt(0) ?? entry.username.charAt(0) ?? '?';

  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white text-sm font-semibold uppercase text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-500">
      {fallbackLetter}
    </div>
  );
}

function getStatusFromSets(
  username: string,
  realSet: Set<string>,
  botSet: Set<string>,
): FollowerStatus {
  if (botSet.has(username)) return 'bot';
  if (realSet.has(username)) return 'real';
  return 'unknown';
}

function getHighResAvatarUrl(url?: string) {
  if (!url) return undefined;
  // Remove _bigger suffix
  if (url.includes('_bigger')) {
    url = url.replace('_bigger', '');
  }
  // Remove size expressions like _mini, _small
  url = url.replace(/_mini|_small/g, '');
  // Remove size expressions like _x96, _x48
  url = url.replace(/_x\d+/g, '');
  if (url.includes('_normal')) {
    return url.replace('_normal', '_400x400');
  }
  try {
    const parsed = new URL(url);
    const quality = parsed.searchParams.get('name');
    if (quality && ['normal', 'small', 'mini'].includes(quality)) {
      parsed.searchParams.set('name', '400x400');
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

function VerifiedBadgeIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 19 19"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
    >
      <path d="M18.792 9.396C18.774 8.75 18.577 8.121 18.222 7.58C17.868 7.04 17.37 6.608 16.784 6.334C17.007 5.727 17.054 5.07 16.924 4.437C16.793 3.803 16.487 3.219 16.042 2.75C15.572 2.305 14.989 2 14.355 1.868C13.722 1.738 13.065 1.785 12.458 2.008C12.185 1.421 11.754 0.922 11.213 0.568C10.672 0.214 10.043 0.016 9.396 0C8.75 0.017 8.123 0.213 7.583 0.568C7.043 0.923 6.614 1.422 6.343 2.008C5.735 1.785 5.076 1.736 4.441 1.868C3.806 1.998 3.221 2.304 2.751 2.75C2.306 3.22 2.002 3.805 1.873 4.438C1.743 5.071 1.793 5.728 2.017 6.334C1.43 6.608 0.93 7.039 0.574 7.579C0.218 8.119 0.019 8.749 0 9.396C0.02 10.043 0.218 10.672 0.574 11.213C0.93 11.753 1.43 12.185 2.017 12.458C1.793 13.064 1.743 13.721 1.873 14.354C2.003 14.988 2.306 15.572 2.75 16.042C3.22 16.485 3.804 16.789 4.437 16.92C5.07 17.052 5.727 17.004 6.334 16.784C6.608 17.37 7.039 17.868 7.58 18.223C8.12 18.577 8.75 18.774 9.396 18.792C10.043 18.776 10.672 18.579 11.213 18.225C11.754 17.871 12.185 17.371 12.458 16.785C13.062 17.024 13.724 17.081 14.361 16.949C14.997 16.817 15.581 16.502 16.041 16.042C16.501 15.582 16.817 14.998 16.949 14.361C17.081 13.724 17.024 13.062 16.784 12.458C17.37 12.184 17.868 11.753 18.223 11.212C18.577 10.672 18.774 10.042 18.792 9.396ZM8.058 13.246L4.629 9.818L5.922 8.516L7.994 10.588L12.394 5.794L13.741 7.04L8.058 13.246Z" />
    </svg>
  );
}

function FloatingActions({
  activeTab,
  hideRealOnPage,
  hideVerifiedOnPage,
  actionDisabled,
  isTogglingVisibility,
  isTogglingVerifiedVisibility,
  handleToggleVisibility,
  handleToggleVerifiedVisibility,
  removalProgress,
  progressPercent,
}: {
  activeTab: TabId;
  hideRealOnPage: boolean;
  hideVerifiedOnPage: boolean;
  actionDisabled: boolean;
  isTogglingVisibility: boolean;
  isTogglingVerifiedVisibility: boolean;
  handleToggleVisibility: () => void;
  handleToggleVerifiedVisibility: () => void;
  removalProgress: RemovalProgress | null;
  progressPercent: number;
}) {
  const showActions = activeTab !== 'lists';

  if (!showActions && !removalProgress) {
    return null;
  }

  return (
    <div className="pointer-events-none flex justify-center px-6 pb-6">
      {showActions && (
        <div className="pointer-events-auto w-full space-y-3">
          <div className="flex items-center justify-between rounded-[26px] border border-neutral-200/80 bg-white px-5 py-3 text-neutral-700 dark:border-white/10 dark:bg-white/10 dark:text-white">
            <div>
              <p className="text-xs font-semibold tracking-wide text-neutral-800 dark:text-neutral-100">
                Hide verified accounts on page
              </p>
            </div>
            <Switch
              checked={hideVerifiedOnPage}
              onCheckedChange={() => handleToggleVerifiedVisibility()}
              disabled={actionDisabled || isTogglingVerifiedVisibility}
            />
          </div>
          <div className="flex items-center justify-between rounded-[26px] border border-neutral-200/80 bg-white px-5 py-3 text-neutral-700 dark:border-white/10 dark:bg-white/10 dark:text-white">
            <div>
              <p className="text-xs font-semibold tracking-wide text-neutral-800 dark:text-neutral-100">
                Hide trusted accounts on page
              </p>
            </div>
            <Switch
              checked={hideRealOnPage}
              onCheckedChange={() => handleToggleVisibility()}
              disabled={actionDisabled || isTogglingVisibility}
            />
          </div>
        </div>
      )}
      {removalProgress && (
        <div className="pointer-events-none absolute inset-x-12 -top-16 rounded-[20px] border border-neutral-200/80 bg-white p-3 text-xs uppercase tracking-[0.3em] text-neutral-500 dark:border-white/10 dark:bg-neutral-900/90">
          <div className="flex items-center justify-between">
            <span>Progress</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200/60 dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {removalProgress.currentUsername && (
            <p className="mt-1 text-[10px] capitalize tracking-[0.2em] text-neutral-500 dark:text-neutral-300">
              @{removalProgress.currentUsername}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function HamburgerIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      {...props}
    >
      <path d="M3 4H21V6H3V4ZM3 11H21V13H3V11ZM3 18H21V20H3V18Z" />
    </svg>
  );
}

function DeleteIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      {...props}
    >
      <path d="M17 6H22V8H20V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V8H2V6H7V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6ZM18 8H6V20H18V8ZM9 11H11V17H9V11ZM13 11H15V17H13V11ZM9 4V6H15V4H9Z" />
    </svg>
  );
}

function HideIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      {...props}
    >
      <path d="M17.8827 19.2968C16.1814 20.3755 14.1638 21.0002 12.0003 21.0002C6.60812 21.0002 2.12215 17.1204 1.18164 12.0002C1.61832 9.62282 2.81932 7.5129 4.52047 5.93457L1.39366 2.80777L2.80788 1.39355L22.6069 21.1925L21.1927 22.6068L17.8827 19.2968ZM5.9356 7.3497C4.60673 8.56015 3.6378 10.1672 3.22278 12.0002C4.14022 16.0521 7.7646 19.0002 12.0003 19.0002C13.5997 19.0002 15.112 18.5798 16.4243 17.8384L14.396 15.8101C13.7023 16.2472 12.8808 16.5002 12.0003 16.5002C9.51498 16.5002 7.50026 14.4854 7.50026 12.0002C7.50026 11.1196 7.75317 10.2981 8.19031 9.60442L5.9356 7.3497ZM12.9139 14.328L9.67246 11.0866C9.5613 11.3696 9.50026 11.6777 9.50026 12.0002C9.50026 13.3809 10.6196 14.5002 12.0003 14.5002C12.3227 14.5002 12.6309 14.4391 12.9139 14.328ZM20.8068 16.5925L19.376 15.1617C20.0319 14.2268 20.5154 13.1586 20.7777 12.0002C19.8603 7.94818 16.2359 5.00016 12.0003 5.00016C11.1544 5.00016 10.3329 5.11773 9.55249 5.33818L7.97446 3.76015C9.22127 3.26959 10.5793 3.00016 12.0003 3.00016C17.3924 3.00016 21.8784 6.87992 22.8189 12.0002C22.5067 13.6998 21.8038 15.2628 20.8068 16.5925ZM11.7229 7.50857C11.8146 7.50299 11.9071 7.50016 12.0003 7.50016C14.4855 7.50016 16.5003 9.51488 16.5003 12.0002C16.5003 12.0933 16.4974 12.1858 16.4919 12.2775L11.7229 7.50857Z" />
    </svg>
  );
}

function RealSwipeIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M14 14.252V16.3414C13.3744 16.1203 12.7013 16 12 16C8.68629 16 6 18.6863 6 22H4C4 17.5817 7.58172 14 12 14C12.6906 14 13.3608 14.0875 14 14.252ZM12 13C8.685 13 6 10.315 6 7C6 3.685 8.685 1 12 1C15.315 1 18 3.685 18 7C18 10.315 15.315 13 12 13ZM12 11C14.21 11 16 9.21 16 7C16 4.79 14.21 3 12 3C9.79 3 8 4.79 8 7C8 9.21 9.79 11 12 11ZM17.7929 19.9142L21.3284 16.3787L22.7426 17.7929L17.7929 22.7426L14.2574 19.2071L15.6716 17.7929L17.7929 19.9142Z" />
    </svg>
  );
}

function BotSwipeIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <BotGlyphPath fill="currentColor" />
    </svg>
  );
}

function BotGlyphPath(props: SVGProps<SVGPathElement>) {
  return (
    <path
      d="M13.5 2C13.5 2.44425 13.3069 2.84339 13 3.11805V5H18C19.6569 5 21 6.34315 21 8V18C21 19.6569 19.6569 21 18 21H6C4.34315 21 3 19.6569 3 18V8C3 6.34315 4.34315 5 6 5H11V3.11805C10.6931 2.84339 10.5 2.44425 10.5 2C10.5 1.17157 11.1716 0.5 12 0.5C12.8284 0.5 13.5 1.17157 13.5 2ZM6 7C5.44772 7 5 7.44772 5 8V18C5 18.5523 5.44772 19 6 19H18C18.5523 19 19 18.5523 19 18V8C19 7.44772 18.5523 7 18 7H6ZM2 11C2 10.4477 1.55228 10 1 10C0.447715 10 0 10.4477 0 11V15C0 15.5523 0.447715 16 1 16C1.55228 16 2 15.5523 2 15V11ZM22 11C22 10.4477 22.4477 10 23 10C23.5523 10 24 10.4477 24 11V15C24 15.5523 23.5523 16 23 16C22.4477 16 22 15.5523 22 15V11ZM9 14.5C9.82843 14.5 10.5 13.8284 10.5 13C10.5 12.1716 9.82843 11.5 9 11.5C8.17157 11.5 7.5 12.1716 7.5 13C7.5 13.8284 8.17157 14.5 9 14.5ZM15 14.5C15.8284 14.5 16.5 13.8284 16.5 13C16.5 12.1716 15.8284 11.5 15 11.5C14.1716 11.5 13.5 12.1716 13.5 13C13.5 13.8284 14.1716 14.5 15 14.5Z"
      {...props}
    />
  );
}

function SwipeStackBotCard({
  className = '',
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      width="32"
      height="44"
      viewBox="0 0 32 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M25.1123 0C28.9163 2.49329e-05 31.9999 3.08373 32 6.8877V37.1123C31.9999 40.9162 28.9162 43.9999 25.1123 44H6.8877C3.08375 43.9999 5.98071e-05 40.9162 0 37.1123V6.8877C0.000125277 3.08386 3.08386 0.000146913 6.8877 0H25.1123Z"
        fill="#FF2056"
      />
      <path
        d="M14.625 12.4634C14.625 11.6552 15.2406 11 16 11C16.7594 11 17.375 11.6552 17.375 12.4634C17.375 12.8968 17.1984 13.2865 16.9171 13.5544V15.3903H21.5C23.0188 15.3903 24.25 16.7008 24.25 18.3172V28.0731C24.25 29.6896 23.0188 31 21.5 31H10.5C8.98122 31 7.75 29.6896 7.75 28.0731V18.3172C7.75 16.7008 8.98122 15.3903 10.5 15.3903H15.0829V13.5544C14.8017 13.2865 14.625 12.8968 14.625 12.4634Z"
        fill="white"
      />
      <path
        d="M5 21.2204C5.00013 20.6946 5.41093 20.269 5.91711 20.269C6.42309 20.2692 6.83276 20.6947 6.83289 21.2204V25.1699C6.8327 25.6956 6.42306 26.1211 5.91711 26.1214C5.41097 26.1214 5.00018 25.6957 5 25.1699V21.2204Z"
        fill="white"
      />
      <path
        d="M25.1671 21.2204C25.1672 20.6947 25.5769 20.2692 26.0829 20.269C26.5891 20.269 26.9999 20.6946 27 21.2204V25.1699C26.9998 25.6957 26.589 26.1214 26.0829 26.1214C25.5769 26.1211 25.1673 25.6956 25.1671 25.1699V21.2204Z"
        fill="white"
      />
      <path
        d="M14.625 23.1945C14.6247 22.3866 14.0092 21.731 13.25 21.731C12.4908 21.731 11.8753 22.3866 11.875 23.1945C11.875 24.0027 12.4906 24.6579 13.25 24.6579C14.0094 24.6579 14.625 24.0027 14.625 23.1945Z"
        fill="#FF2056"
      />
      <path
        d="M20.125 23.1945C20.1247 22.3866 19.5092 21.731 18.75 21.731C17.9908 21.731 17.3753 22.3866 17.375 23.1945C17.375 24.0027 17.9906 24.6579 18.75 24.6579C19.5094 24.6579 20.125 24.0027 20.125 23.1945Z"
        fill="#FF2056"
      />
    </svg>
  );
}

function SwipeStackEmptyCard({
  className = '',
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      width="32"
      height="44"
      viewBox="0 0 32 44"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M25.1123 0C28.9163 2.49329e-05 31.9999 3.08373 32 6.8877V37.1123C31.9999 40.9162 28.9162 43.9999 25.1123 44H6.8877C3.08375 43.9999 5.98071e-05 40.9162 0 37.1123V6.8877C0.000125277 3.08386 3.08386 0.000146913 6.8877 0H25.1123Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SwipeStackRealCard({
  className = '',
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      width="32"
      height="44"
      viewBox="0 0 32 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M25.1123 0C28.9163 2.49329e-05 31.9999 3.08373 32 6.8877V37.1123C31.9999 40.9162 28.9162 43.9999 25.1123 44H6.8877C3.08375 43.9999 5.98071e-05 40.9162 0 37.1123V6.8877C0.000125277 3.08386 3.08386 0.000146913 6.8877 0H25.1123Z"
        fill="#00D492"
      />
      <path
        d="M20.7637 15.7521C21.7327 14.7492 23.304 14.7495 24.2732 15.7521C25.2423 16.7551 25.2423 18.382 24.2732 19.385L15.8588 28.094C14.6915 29.302 12.799 29.302 11.6318 28.094L6.72684 23.0168C5.75772 22.0138 5.75772 20.3881 6.72684 19.385C7.69597 18.3821 9.26727 18.3821 10.2364 19.385L13.7459 23.0168L20.7637 15.7521Z"
        fill="white"
      />
    </svg>
  );
}
