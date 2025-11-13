import {
  BaseStorage,
  createStorage,
  StorageType,
} from '@/shared/storages/base';

export type FollowersWorkspaceState = {
  followersUrl: string | null;
  lastUpdatedAt: number | null;
};

const STORAGE_KEY = 'followers-workspace-state';
const defaultState: FollowersWorkspaceState = {
  followersUrl: null,
  lastUpdatedAt: null,
};

const storage = createStorage<FollowersWorkspaceState>(
  STORAGE_KEY,
  defaultState,
  {
    storageType: StorageType.Local,
    liveUpdate: true,
  },
);

async function setFollowersUrl(url: string | null) {
  await storage.set((current) => ({
    ...(current ?? defaultState),
    followersUrl: url,
    lastUpdatedAt: Date.now(),
  }));
}

async function clearFollowersUrl() {
  await setFollowersUrl(null);
}

export type FollowersWorkspaceStorage = BaseStorage<FollowersWorkspaceState> & {
  setFollowersUrl: (url: string | null) => Promise<void>;
  clearFollowersUrl: () => Promise<void>;
};

const followersWorkspaceStorage: FollowersWorkspaceStorage = {
  ...storage,
  setFollowersUrl,
  clearFollowersUrl,
};

export default followersWorkspaceStorage;
