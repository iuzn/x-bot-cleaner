import { useSyncExternalStore } from 'react';
import { followerMetricsStore } from '@/pages/content/followers/metricsStore';

export function useFollowerMetrics() {
  return useSyncExternalStore(
    followerMetricsStore.subscribe,
    followerMetricsStore.getSnapshot,
  );
}
