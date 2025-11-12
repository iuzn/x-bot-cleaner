import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AnimatePresence,
  animate,
  motion,
  PanInfo,
  useMotionValue,
  useTransform,
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
  FollowerScrapeStatus,
  FollowerSnapshotEntry,
  FollowerSnapshotState,
  FollowerStatus,
  RemovalProgress,
} from '@/types/followers';
import EarTag from '@/components/views/shared/EarTag';
import { Switch } from '@/components/ui/switch';

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

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'insights', label: 'Status' },
  { id: 'lists', label: 'Lists' },
];
// TODO: Replace the placeholder tabs above with an underline-style tab system so
//       it doesn't clash with the rounded primary tabs, and include a third
//       "Scraped" tab that renders the followerSnapshot data once the
//       scraping feature is implemented.

export default function Main() {
  const isPopup =
    typeof window !== 'undefined' && window.location.href.includes('popup');

  const logoUrl = isPopup
    ? '/logo.png'
    : typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('logo.png')
      : '/logo.png';

  const { isRootVisible, toggleRootVisibility } = isPopup
    ? { isRootVisible: true, toggleRootVisibility: () => {} }
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
      label: 'Trusted',
      value: realCount,
      description: 'Accounts marked as real',
      icon: ShieldTick,
      tone: 'emerald' as const,
      span: 1,
    },
    {
      label: 'Bots',
      value: botCount,
      description: 'Ready for cleanup',
      icon: Danger,
      tone: 'rose' as const,
      span: 1,
    },
    {
      label: 'Saved',
      value: scrapedTotal.toLocaleString(),
      description: 'profiles saved',
      icon: Radar,
      tone: 'blue' as const,
      span: 2,
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
    if (
      removalState === 'running' ||
      botCount === 0 ||
      !metrics.isFollowersPage
    ) {
      return;
    }

    const confirmed = window.confirm(
      `${botCount} flagged followers will be removed. Continue?`,
    );
    if (!confirmed) return;

    setRemovalState('running');
    setErrorMessage(null);
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
    const confirmed = window.confirm(
      'This will clear every saved follower and label. Continue?',
    );
    if (!confirmed) return;

    setIsClearingData(true);
    setErrorMessage(null);
    try {
      await Promise.all([
        followerSnapshotStorage.resetSnapshot(),
        followerClassificationStorage.resetAll(),
      ]);
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
      ? 'h-full w-full bg-white dark:bg-neutral-950'
      : [
          'fixed right-5 top-5 z-[2147483647] max-h-[640px] w-[380px]',
          'rounded-[32px] border border-neutral-200/80 bg-white/95',
          'backdrop-blur-3xl transition-all duration-500 ease-out dark:border-white/10 dark:bg-neutral-900/90',
          isRootVisible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-2 opacity-0',
        ],
    'flex h-full flex-col',
  );

  return (
    <div className="relative h-full">
      {!isPopup && (
        <EarTag
          isPanelVisible={isRootVisible}
          onToggle={(next) => toggleRootVisibility(next)}
          logoUrl={logoUrl}
          badgeValue={botCount}
        />
      )}
      <div className={panelClasses}>
        <div className="relative flex h-full flex-col">
          <div className="px-6 pt-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <img src={logoUrl} alt="X Bot Cleaner" className="h-11 w-11" />
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-neutral-600 dark:text-neutral-300">
                  X Bot Cleaner
                </p>
              </div>
              {!isPopup && (
                <button
                  onClick={() => toggleRootVisibility(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/50 bg-white/40 text-neutral-600 transition hover:bg-white/70 dark:border-white/10 dark:bg-neutral-800/70 dark:text-neutral-200"
                >
                  <span className="sr-only">Close panel</span>×
                </button>
              )}
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

          <div className="relative flex-1 overflow-hidden">
            <div className="h-full overflow-y-auto px-6 pb-36 pt-4">
              {errorMessage && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {errorMessage}
                </div>
              )}
              {activeTab === 'insights' ? (
                <InsightsSection
                  stats={stats}
                  onRemoveBots={handleBulkRemoval}
                  removalState={removalState}
                  botCount={botCount}
                  actionDisabled={actionDisabled}
                />
              ) : (
                <ListsSection
                  snapshot={snapshot}
                  classification={classification}
                  followerTarget={metrics.profileFollowerCount}
                  onResetAll={handleResetAllData}
                  isClearingData={isClearingData}
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
              handleAutoScrape={handleAutoScrape}
              onShowBotSwipe={openBotSwipe}
              botSwipeCount={botSwipeEntries.length}
              removalProgress={removalProgress}
              progressPercent={progressPercent}
              activeTab={activeTab}
              scrapeStatus={scrapeStatus}
              isScrapePending={isScrapePending}
              captureCtaLabel={captureCtaLabel}
            />
            <BotSwipeModal
              isOpen={isBotSwipeOpen}
              entries={botSwipeEntries}
              onClose={closeBotSwipe}
              onDecision={handleSwipeDecision}
              onUndo={handleUndoSwipeDecision}
            />
          </div>
        </div>
      </div>
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
}) {
  const toneStyles = {
    emerald: 'text-emerald-500',
    rose: 'text-rose-500',
    blue: 'text-blue-500',
  };
  const savedStat = stats.find((stat) => stat.label === 'Saved');
  const SavedIcon = savedStat?.icon;
  const primaryStats = stats.filter((stat) => stat.label !== 'Saved');

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-4">
        {primaryStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              layout
              className={cn(
                'rounded-[28px] border border-neutral-200/80 bg-white p-4 dark:border-white/10 dark:bg-neutral-900/70',
                stat.span === 2 && 'col-span-2',
              )}
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
                <Icon size="32" className={toneStyles[stat.tone]} />
              </div>
              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-300">
                {stat.description}
              </p>
            </motion.div>
          );
        })}
      </section>
      {savedStat ? (
        <section className="grid grid-cols-2 gap-4">
          <motion.div
            key={savedStat.label}
            layout
            className="rounded-[28px] border border-neutral-200/80 bg-white p-4 dark:border-white/10 dark:bg-neutral-900/70"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-500">
                  {savedStat.label}
                </p>
                <p className="text-3xl font-semibold text-neutral-900 dark:text-white">
                  {savedStat.value}
                </p>
              </div>
              {SavedIcon && (
                <SavedIcon size="32" className={toneStyles[savedStat.tone]} />
              )}
            </div>
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-300">
              {savedStat.description}
            </p>
          </motion.div>
          <RemoveBotsCard
            botCount={botCount}
            removalState={removalState}
            onRemoveBots={onRemoveBots}
            actionDisabled={actionDisabled}
          />
        </section>
      ) : null}
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
  const hasBots = botCount > 0;
  const isRunning = removalState === 'running';
  const disabled = actionDisabled || isRunning || botCount === 0;
  const cardTone =
    hasBots || isRunning
      ? 'border-rose-200/80 bg-rose-50 text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100'
      : 'border-rose-500/80 bg-rose-500 text-white dark:border-rose-500/60 dark:bg-rose-500/80';

  return (
    <motion.button
      type="button"
      layout
      aria-label="Remove bots"
      onClick={onRemoveBots}
      disabled={disabled}
      className={cn(
        'rounded-[28px] border px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 dark:focus-visible:ring-rose-400/40',
        cardTone,
        disabled && 'cursor-not-allowed opacity-80',
        !disabled && 'hover:-translate-y-0.5 hover:shadow-lg',
      )}
    >
      <div className="flex h-full items-start justify-center">
        <p className="text-2xl font-semibold tracking-tight">
          {isRunning ? 'Removing…' : 'Remove Bots'}
        </p>
      </div>
    </motion.button>
  );
}

function ListsSection({
  snapshot,
  classification,
  followerTarget,
  onResetAll,
  isClearingData,
}: {
  snapshot: FollowerSnapshotState;
  classification: FollowerClassificationState;
  followerTarget: number | null;
  onResetAll: () => void;
  isClearingData: boolean;
}) {
  const [filter, setFilter] = useState<ScrapedFilter>('all');
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

  const counts = useMemo(() => {
    const aggregate = {
      all: entries.length,
      trusted: 0,
      bots: 0,
      unreviewed: 0,
    };
    entries.forEach((entry) => {
      const status = getStatusFromSets(entry.username, realSet, botSet);
      if (status === 'real') {
        aggregate.trusted += 1;
      } else if (status === 'bot') {
        aggregate.bots += 1;
      } else {
        aggregate.unreviewed += 1;
      }
    });
    return aggregate;
  }, [entries, realSet, botSet]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const status = getStatusFromSets(entry.username, realSet, botSet);
      if (filter === 'trusted') return status === 'real';
      if (filter === 'bots') return status === 'bot';
      if (filter === 'unreviewed') return status === 'unknown';
      return true;
    });
  }, [entries, filter, realSet, botSet]);

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
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full border border-neutral-200/80 bg-white/95 px-1 py-1 [-ms-overflow-style:none] [scrollbar-width:none] dark:border-white/10 dark:bg-neutral-900/60 [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={onResetAll}
            disabled={isClearingData || scrapedCount === 0}
            className={cn(
              'rounded-full border border-neutral-300 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-600 transition hover:border-neutral-500 hover:text-neutral-800 dark:border-white/20 dark:text-neutral-300 dark:hover:border-white/40 dark:hover:text-white',
              (isClearingData || scrapedCount === 0) &&
                'cursor-not-allowed opacity-50',
            )}
          >
            {isClearingData ? 'Clearing…' : 'Clear saved data'}
          </button>
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
            const status = getStatusFromSets(entry.username, realSet, botSet);
            return (
              <ScrapedListItem
                key={entry.username}
                entry={entry}
                status={status}
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
}: {
  entry: FollowerSnapshotEntry;
  status: FollowerStatus;
}) {
  // TODO: Wire row-level taps to open the classification sheet or trigger quick
  //       actions so users can mark bots/trusted without going back to X.com.
  return (
    <div className="flex items-center gap-3 rounded-[28px] border border-neutral-200/80 bg-white px-4 py-3 text-sm text-neutral-700 dark:border-white/10 dark:bg-neutral-900/70 dark:text-neutral-200">
      <div className="flex flex-1 items-start gap-3">
        <ScrapedAvatar entry={entry} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
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
          {entry.bio && (
            <p className="mt-1 overflow-hidden text-ellipsis text-xs text-neutral-500 [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box] dark:text-neutral-300">
              {entry.bio}
            </p>
          )}
        </div>
      </div>
      <ScrapedStatusPill status={status} />
    </div>
  );
}

function ScrapedStatusPill({ status }: { status: FollowerStatus }) {
  const tone = {
    real: 'border-emerald-300/60 bg-emerald-50/70 text-emerald-600 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200',
    bot: 'border-rose-300/60 bg-rose-50/80 text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200',
    unknown:
      'border-neutral-200/80 bg-neutral-50 text-neutral-600 dark:border-white/10 dark:bg-neutral-800/70 dark:text-neutral-200',
  } as const;
  const label =
    status === 'real' ? 'Trusted' : status === 'bot' ? 'Bot' : 'Review';
  return (
    <span
      className={cn(
        'rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.35em]',
        tone[status],
      )}
    >
      {label}
    </span>
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
  // _bigger ifadesini kaldır
  if (url.includes('_bigger')) {
    url = url.replace('_bigger', '');
  }
  // _mini, _small gibi boyut ifadelerini kaldır
  url = url.replace(/_mini|_small/g, '');
  // _x96, _x48 gibi boyut ifadelerini kaldır
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
  handleAutoScrape,
  onShowBotSwipe,
  botSwipeCount,
  removalProgress,
  progressPercent,
  scrapeStatus,
  isScrapePending,
  captureCtaLabel,
}: {
  activeTab: TabId;
  hideRealOnPage: boolean;
  hideVerifiedOnPage: boolean;
  actionDisabled: boolean;
  isTogglingVisibility: boolean;
  isTogglingVerifiedVisibility: boolean;
  handleToggleVisibility: () => void;
  handleToggleVerifiedVisibility: () => void;
  handleAutoScrape: () => void;
  onShowBotSwipe: () => void;
  botSwipeCount: number;
  removalProgress: RemovalProgress | null;
  progressPercent: number;
  scrapeStatus: FollowerScrapeStatus;
  isScrapePending: boolean;
  captureCtaLabel: string;
}) {
  const showActions = activeTab !== 'lists';

  if (!showActions && !removalProgress) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-6 pb-6">
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
          <div className="flex items-center gap-3">
            <button
              onClick={handleAutoScrape}
              disabled={isScrapePending}
              className={cn(
                'flex-1 rounded-full border border-blue-500/70 bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors',
                'hover:bg-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200',
                'dark:border-blue-500/50 dark:bg-blue-500 dark:text-white dark:hover:bg-blue-400',
                isScrapePending && 'cursor-not-allowed opacity-50',
                scrapeStatus.phase === 'running' &&
                  'border-emerald-500/70 bg-emerald-500 hover:bg-emerald-500 dark:border-emerald-400/80 dark:bg-emerald-500',
              )}
            >
              <span className="flex items-center justify-center gap-2">
                {scrapeStatus.phase === 'running' && (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                )}
                {captureCtaLabel}
              </span>
            </button>
            <button
              type="button"
              onClick={onShowBotSwipe}
              className={cn(
                'flex-1 rounded-full border border-rose-500/60 bg-rose-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200',
                'dark:border-rose-500/40 dark:bg-rose-500/80 dark:hover:bg-rose-400',
              )}
            >
              <span className="flex items-center justify-center gap-2">
                Bot Swipe
                {botSwipeCount > 0 && (
                  <span className="text-[10px] uppercase tracking-[0.35em] text-white/80">
                    {botSwipeCount}
                  </span>
                )}
              </span>
            </button>
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
      <path d="M13.5 2C13.5 2.44425 13.3069 2.84339 13 3.11805V5H18C19.6569 5 21 6.34315 21 8V18C21 19.6569 19.6569 21 18 21H6C4.34315 21 3 19.6569 3 18V8C3 6.34315 4.34315 5 6 5H11V3.11805C10.6931 2.84339 10.5 2.44425 10.5 2C10.5 1.17157 11.1716 0.5 12 0.5C12.8284 0.5 13.5 1.17157 13.5 2ZM6 7C5.44772 7 5 7.44772 5 8V18C5 18.5523 5.44772 19 6 19H18C18.5523 19 19 18.5523 19 18V8C19 7.44772 18.5523 7 18 7H13H11H6ZM2 10H0V16H2V10ZM22 10H24V16H22V10ZM9 14.5C9.82843 14.5 10.5 13.8284 10.5 13C10.5 12.1716 9.82843 11.5 9 11.5C8.17157 11.5 7.5 12.1716 7.5 13C7.5 13.8284 8.17157 14.5 9 14.5ZM15 14.5C15.8284 14.5 16.5 13.8284 16.5 13C16.5 12.1716 15.8284 11.5 15 11.5C14.1716 11.5 13.5 12.1716 13.5 13C13.5 13.8284 14.1716 14.5 15 14.5Z" />
    </svg>
  );
}
