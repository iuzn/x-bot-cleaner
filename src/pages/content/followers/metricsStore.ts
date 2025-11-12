import {
  FollowerDomMetrics,
  defaultFollowerDomMetrics,
} from '@/types/followers';

type Listener = () => void;

let metrics: FollowerDomMetrics = { ...defaultFollowerDomMetrics };
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

export const followerMetricsStore = {
  getSnapshot: () => metrics,
  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  set: (value: FollowerDomMetrics) => {
    metrics = value;
    emit();
  },
  update: (partial: Partial<FollowerDomMetrics>) => {
    metrics = {
      ...metrics,
      ...partial,
      lastUpdatedAt: partial.lastUpdatedAt ?? Date.now(),
    };
    emit();
  },
  reset: () => {
    metrics = { ...defaultFollowerDomMetrics };
    emit();
  },
};
