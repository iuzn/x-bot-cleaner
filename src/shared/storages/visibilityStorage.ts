import {
  BaseStorage,
  createStorage,
  StorageType,
} from '@/shared/storages/base';

type VisibilityStorage = BaseStorage<boolean> & {
  toggle: () => Promise<void>;
};

export const VISIBILITY_STORAGE_KEY = 'visibility-storage-key';

const storage = createStorage<boolean>(VISIBILITY_STORAGE_KEY, true, {
  storageType: StorageType.Local,
  liveUpdate: true,
});

const visibilityStorage: VisibilityStorage = {
  ...storage,
  toggle: async () => {
    await storage.set((current) => !current);
  },
};

export default visibilityStorage;
