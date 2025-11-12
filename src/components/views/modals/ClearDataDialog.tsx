import { motion } from 'framer-motion';
import type { Transition } from 'framer-motion';

import { cn } from '@/lib/utils';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type ClearDataDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isClearing: boolean;
  capturedCount: number;
  classifiedCount: number;
};

const popTransition: Transition = {
  duration: 0.32,
  ease: [0.16, 1, 0.3, 1],
};

export function ClearDataDialog({
  open,
  onOpenChange,
  onConfirm,
  isClearing,
  capturedCount,
  classifiedCount,
}: ClearDataDialogProps) {
  const safeChange = (next: boolean) => {
    if (isClearing) return;
    onOpenChange(next);
  };

  const stats = [
    { label: 'Captured', value: Math.max(0, capturedCount) },
    { label: 'Decisions', value: Math.max(0, classifiedCount) },
  ];

  return (
    <Dialog open={open} onOpenChange={safeChange}>
      <DialogContent className="max-w-[400px] px-6 py-7">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={popTransition}
          className="space-y-5"
        >
          <DialogHeader className="space-y-2">
            <DialogTitle>Clear saved data</DialogTitle>
            <DialogDescription>
              Removes cached captures and labels from this device—nothing
              touches your X account.
            </DialogDescription>
          </DialogHeader>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={popTransition}
            className="rounded-[26px] border border-neutral-100 bg-neutral-50 p-4 text-sm text-neutral-700 backdrop-blur-md dark:border-white/15 dark:bg-neutral-900/50 dark:text-neutral-100"
          >
            <div className="grid grid-cols-2 gap-3">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-[20px] border border-neutral-100 bg-white p-3 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500 dark:border-white/15 dark:bg-neutral-900/60 dark:text-neutral-200"
                >
                  <p>{stat.label}</p>
                  <p className="mt-1 text-xl tracking-tight text-neutral-900 dark:text-white">
                    {stat.value.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>

          <DialogFooter className="gap-3">
            <button
              type="button"
              onClick={() => safeChange(false)}
              disabled={isClearing}
              className="flex-1 whitespace-nowrap rounded-full border border-white/40 bg-white/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-700 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-neutral-900/60 dark:text-white dark:hover:bg-neutral-900/80"
            >
              Keep data
            </button>
            <motion.button
              type="button"
              whileHover={isClearing ? undefined : { scale: 1.01 }}
              whileTap={isClearing ? undefined : { scale: 0.99 }}
              onClick={onConfirm}
              disabled={isClearing}
              className="flex-1 whitespace-nowrap rounded-full border border-rose-300/60 bg-rose-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white shadow-[0_20px_45px_rgba(244,63,94,0.35)] transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-200/50 dark:bg-rose-500/90 dark:hover:bg-rose-500"
            >
              {isClearing ? 'Clearing…' : 'Erase everything'}
            </motion.button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
