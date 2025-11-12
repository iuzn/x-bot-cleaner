export type FollowerStatus = 'real' | 'bot' | 'unknown';

export type FollowerRemovalStatus =
  | 'removed'
  | 'not-found'
  | 'action-missing'
  | 'skipped';

export type FollowerScrapePhase = 'idle' | 'running' | 'completed' | 'error';

export interface FollowerSnapshotEntry {
  username: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  isVerified?: boolean;
  scrapedAt: number;
}

export interface FollowerSnapshotState {
  entries: Record<string, FollowerSnapshotEntry>;
  totalCaptured: number;
  lastScrapeStartedAt: number | null;
  lastScrapeFinishedAt: number | null;
  autoStartCapture?: boolean;
}

export interface FollowerScrapeStatus {
  phase: FollowerScrapePhase;
  startedAt: number | null;
  finishedAt: number | null;
  captured: number;
  iterations: number;
  idleStreak: number;
  message?: string;
}

export interface FollowerPreferences {
  hideRealOnPage: boolean;
  hideVerifiedOnPage: boolean;
}

export interface FollowerClassificationState {
  realFollowers: string[];
  botFollowers: string[];
  preferences: FollowerPreferences;
  lastSweepAt?: number | null;
}

export interface FollowerDomMetrics {
  isFollowersPage: boolean;
  totalCells: number;
  processedCells: number;
  botsOnPage: number;
  realOnPage: number;
  realHidden: boolean;
  verifiedHidden: boolean;
  scrapedFollowers: number;
  profileFollowerCount: number | null;
  scrapeStatus: FollowerScrapeStatus;
  lastUpdatedAt: number | null;
}

export interface RemovalProgress {
  total: number;
  completed: number;
  success: number;
  failed: number;
  currentUsername?: string;
}

export interface BulkRemovalResult {
  attempted: number;
  removed: number;
  failed: number;
  startedAt: number;
  finishedAt: number;
  reports: Array<{
    username: string;
    status: FollowerRemovalStatus;
    reason?: string;
  }>;
}

export const defaultFollowerPreferences: FollowerPreferences = {
  hideRealOnPage: false,
  hideVerifiedOnPage: false,
};

export const defaultFollowerClassificationState: FollowerClassificationState = {
  realFollowers: [],
  botFollowers: [],
  preferences: defaultFollowerPreferences,
  lastSweepAt: null,
};

export const defaultFollowerSnapshotState: FollowerSnapshotState = {
  entries: {},
  totalCaptured: 0,
  lastScrapeStartedAt: null,
  lastScrapeFinishedAt: null,
  autoStartCapture: false,
};

export const defaultFollowerScrapeStatus: FollowerScrapeStatus = {
  phase: 'idle',
  startedAt: null,
  finishedAt: null,
  captured: 0,
  iterations: 0,
  idleStreak: 0,
  message: undefined,
};

export const defaultFollowerDomMetrics: FollowerDomMetrics = {
  isFollowersPage: false,
  totalCells: 0,
  processedCells: 0,
  botsOnPage: 0,
  realOnPage: 0,
  realHidden: false,
  verifiedHidden: false,
  scrapedFollowers: 0,
  profileFollowerCount: null,
  scrapeStatus: defaultFollowerScrapeStatus,
  lastUpdatedAt: null,
};
