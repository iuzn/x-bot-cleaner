import {
  BaseStorage,
  createStorage,
  StorageType,
} from '@/shared/storages/base';
import {
  FollowerSnapshotEntry,
  FollowerSnapshotState,
  defaultFollowerSnapshotState,
} from '@/types/followers';
import { normalizeUsername } from '@/shared/storages/followerClassificationStorage';

const STORAGE_KEY = 'xbot-follower-snapshot';

const storage = createStorage<FollowerSnapshotState>(
  STORAGE_KEY,
  defaultFollowerSnapshotState,
  {
    storageType: StorageType.Local,
    liveUpdate: true,
  },
);

export function ensureSnapshotState(
  state?: FollowerSnapshotState | null,
): FollowerSnapshotState {
  if (!state) {
    return { ...defaultFollowerSnapshotState };
  }

  const entries = state.entries ?? {};
  return {
    entries: { ...entries },
    totalCaptured:
      typeof state.totalCaptured === 'number'
        ? state.totalCaptured
        : Object.keys(entries).length,
    lastScrapeStartedAt: state.lastScrapeStartedAt ?? null,
    lastScrapeFinishedAt: state.lastScrapeFinishedAt ?? null,
    autoStartCapture: state.autoStartCapture ?? false,
  };
}

function hasEntryChanged(
  previous: FollowerSnapshotEntry,
  next: FollowerSnapshotEntry,
): boolean {
  return (
    previous.displayName !== next.displayName ||
    previous.avatarUrl !== next.avatarUrl ||
    previous.bio !== next.bio ||
    previous.isVerified !== next.isVerified ||
    previous.scrapedAt !== next.scrapedAt
  );
}

async function recordBatch(entries: FollowerSnapshotEntry[]) {
  if (!entries.length) return;

  await storage.set((current) => {
    const snapshot = ensureSnapshotState(current);
    const map = snapshot.entries;
    let updated = false;
    let totalCaptured = snapshot.totalCaptured;

    entries.forEach((entry) => {
      const normalized = normalizeUsername(entry.username);
      if (!normalized) return;

      const merged: FollowerSnapshotEntry = {
        ...map[normalized],
        ...entry,
        username: normalized,
        scrapedAt: entry.scrapedAt ?? Date.now(),
      };

      const existing = map[normalized];
      if (!existing || hasEntryChanged(existing, merged)) {
        map[normalized] = merged;
        updated = true;
        if (!existing) {
          totalCaptured += 1;
        }
      }
    });

    if (!updated) {
      return snapshot;
    }

    return {
      ...snapshot,
      entries: map,
      totalCaptured,
    };
  });
}

async function markScrapeStart(timestamp: number) {
  await storage.set((current) => {
    const snapshot = ensureSnapshotState(current);
    return {
      ...snapshot,
      lastScrapeStartedAt: timestamp,
      lastScrapeFinishedAt: null,
    };
  });
}

async function markScrapeFinish(timestamp: number) {
  await storage.set((current) => {
    const snapshot = ensureSnapshotState(current);
    return {
      ...snapshot,
      lastScrapeFinishedAt: timestamp,
    };
  });
}

async function resetSnapshot() {
  await storage.set({ ...defaultFollowerSnapshotState });
}

async function setAutoStartCapture(value: boolean) {
  await storage.set((current) => {
    const snapshot = ensureSnapshotState(current);
    return {
      ...snapshot,
      autoStartCapture: value,
    };
  });
}

async function clearAutoStartCapture() {
  await setAutoStartCapture(false);
}

export type FollowerSnapshotStorage = BaseStorage<FollowerSnapshotState> & {
  recordBatch: (entries: FollowerSnapshotEntry[]) => Promise<void>;
  markScrapeStart: (timestamp: number) => Promise<void>;
  markScrapeFinish: (timestamp: number) => Promise<void>;
  resetSnapshot: () => Promise<void>;
  setAutoStartCapture: (value: boolean) => Promise<void>;
  clearAutoStartCapture: () => Promise<void>;
};

export const followerSnapshotStorage: FollowerSnapshotStorage = {
  ...storage,
  recordBatch,
  markScrapeStart,
  markScrapeFinish,
  resetSnapshot,
  setAutoStartCapture,
  clearAutoStartCapture,
};

export type { FollowerSnapshotEntry };
