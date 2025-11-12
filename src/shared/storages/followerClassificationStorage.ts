import {
  BaseStorage,
  createStorage,
  StorageType,
} from '@/shared/storages/base';
import {
  FollowerClassificationState,
  FollowerStatus,
  defaultFollowerClassificationState,
} from '@/types/followers';

const STORAGE_KEY = 'xbot-classification-state';

const storage = createStorage<FollowerClassificationState>(
  STORAGE_KEY,
  defaultFollowerClassificationState,
  {
    storageType: StorageType.Local,
    liveUpdate: true,
  },
);

function normalizeUsername(username: string): string {
  return username.replace(/^@+/, '').replace(/\/+$/, '').trim().toLowerCase();
}

function ensureState(
  state?: FollowerClassificationState | null,
): FollowerClassificationState {
  const fallback: FollowerClassificationState = {
    ...defaultFollowerClassificationState,
    preferences: { ...defaultFollowerClassificationState.preferences },
  };

  if (!state) {
    return fallback;
  }

  const mergedPreferences = {
    ...fallback.preferences,
    ...(state.preferences ?? {}),
  };

  // Legacy migration: hideBotsOnPage -> hideRealOnPage
  const legacyPreferences = state.preferences as
    | {
        hideBotsOnPage?: boolean;
      }
    | undefined;

  if (
    mergedPreferences.hideRealOnPage === undefined &&
    legacyPreferences?.hideBotsOnPage !== undefined
  ) {
    mergedPreferences.hideRealOnPage = Boolean(legacyPreferences.hideBotsOnPage);
  }

  return {
    realFollowers: Array.isArray(state.realFollowers)
      ? [...state.realFollowers]
      : [],
    botFollowers: Array.isArray(state.botFollowers)
      ? [...state.botFollowers]
      : [],
    preferences: mergedPreferences,
    lastSweepAt: state.lastSweepAt ?? null,
    autoStartRemoval: state.autoStartRemoval ?? false,
  };
}

async function updateClassification(username: string, status: FollowerStatus) {
  const normalized = normalizeUsername(username);
  if (!normalized) return;

  await storage.set((current) => {
    const state = ensureState(current);
    const realSet = new Set(state.realFollowers.map(normalizeUsername));
    const botSet = new Set(state.botFollowers.map(normalizeUsername));

    realSet.delete(normalized);
    botSet.delete(normalized);

    if (status === 'real') {
      realSet.add(normalized);
    } else if (status === 'bot') {
      botSet.add(normalized);
    }

    return {
      ...state,
      realFollowers: Array.from(realSet),
      botFollowers: Array.from(botSet),
    };
  });
}

async function updatePreferences(
  partial: Partial<FollowerClassificationState['preferences']>,
) {
  await storage.set((current) => {
    const state = ensureState(current);
    return {
      ...state,
      preferences: {
        ...state.preferences,
        ...partial,
      },
    };
  });
}

function resolveStatus(
  state: FollowerClassificationState | null,
  username: string,
): FollowerStatus {
  const normalized = normalizeUsername(username);
  if (!normalized) return 'unknown';
  const botList = state?.botFollowers ?? [];
  const realList = state?.realFollowers ?? [];

  if (botList.includes(normalized)) {
    return 'bot';
  }
  if (realList.includes(normalized)) {
    return 'real';
  }
  return 'unknown';
}

export type FollowerClassificationStorage = BaseStorage<FollowerClassificationState> & {
  classify: (username: string, status: FollowerStatus) => Promise<void>;
  resetUser: (username: string) => Promise<void>;
  clearBots: () => Promise<void>;
  removeBot: (username: string) => Promise<void>;
  resetAll: () => Promise<void>;
  updateLastSweep: (timestamp: number | null) => Promise<void>;
  setHideReal: (isHidden: boolean) => Promise<void>;
  setHideVerified: (isHidden: boolean) => Promise<void>;
  toggleHideReal: () => Promise<boolean>;
  getStatusFor: (username: string) => FollowerStatus;
  setAutoStartRemoval: (value: boolean) => Promise<void>;
  clearAutoStartRemoval: () => Promise<void>;
};

const followerClassificationStorage: FollowerClassificationStorage = {
  ...storage,
  classify: (username, status) => updateClassification(username, status),
  resetUser: (username) => updateClassification(username, 'unknown'),
  clearBots: async () => {
    await storage.set((current) => {
      const state = ensureState(current);
      return {
        ...state,
        botFollowers: [],
      };
    });
  },
  removeBot: async (username) => {
    const normalized = normalizeUsername(username);
    if (!normalized) {
      return;
    }
    await storage.set((current) => {
      const state = ensureState(current);
      if (!state.botFollowers.includes(normalized)) {
        return state;
      }
      return {
        ...state,
        botFollowers: state.botFollowers.filter((entry) => entry !== normalized),
      };
    });
  },
  updateLastSweep: async (timestamp) => {
    await storage.set((current) => {
      const state = ensureState(current);
      return {
        ...state,
        lastSweepAt: timestamp,
      };
    });
  },
  setHideReal: async (isHidden) => {
    await updatePreferences({ hideRealOnPage: isHidden });
  },
  setHideVerified: async (isHidden) => {
    await updatePreferences({ hideVerifiedOnPage: isHidden });
  },
  resetAll: async () => {
    await storage.set(() => ensureState());
  },
  toggleHideReal: async () => {
    const snapshot = storage.getSnapshot() ?? defaultFollowerClassificationState;
    const nextValue = !ensureState(snapshot).preferences.hideRealOnPage;
    await updatePreferences({ hideRealOnPage: nextValue });
    return nextValue;
  },
  getStatusFor: (username) => resolveStatus(storage.getSnapshot(), username),
  setAutoStartRemoval: async (value: boolean) => {
    await storage.set((current) => {
      const state = ensureState(current);
      return {
        ...state,
        autoStartRemoval: value,
      };
    });
  },
  clearAutoStartRemoval: async () => {
    await storage.set((current) => {
      const state = ensureState(current);
      return {
        ...state,
        autoStartRemoval: false,
      };
    });
  },
};

export { followerClassificationStorage, normalizeUsername, ensureState };
