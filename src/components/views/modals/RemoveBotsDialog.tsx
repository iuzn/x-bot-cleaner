import { motion } from 'framer-motion';
import type { Transition } from 'framer-motion';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type RemoveBotsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  botCount: number;
  isRemoving: boolean;
};

const popTransition: Transition = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1],
};

export function RemoveBotsDialog({
  open,
  onOpenChange,
  onConfirm,
  botCount,
  isRemoving,
}: RemoveBotsDialogProps) {
  const safeChange = (next: boolean) => {
    if (isRemoving) return;
    onOpenChange(next);
  };

  const statusLabel =
    botCount === 1 ? 'bot account will be removed' : 'bot accounts will be removed';

  return (
    <Dialog open={open} onOpenChange={safeChange}>
      <DialogContent className="max-w-[360px] px-6 py-7">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={popTransition}
          className="space-y-5"
        >
          <DialogHeader className="space-y-2">
            <DialogTitle>Remove bots</DialogTitle>
            <DialogDescription>
              {botCount.toLocaleString()} {statusLabel} from this page.
            </DialogDescription>
          </DialogHeader>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={popTransition}
            className="rounded-[24px] border border-neutral-100 bg-neutral-50 px-4 py-3 text-center text-sm text-neutral-600 dark:border-white/15 dark:bg-neutral-900/50 dark:text-neutral-200"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-500 dark:text-neutral-400">
              Ready to process
            </p>
            <p className="mt-1 text-3xl font-semibold text-neutral-900 dark:text-white">
              {botCount.toLocaleString()}
            </p>
          </motion.div>

          <DialogFooter className="gap-3">
            <button
              type="button"
              onClick={() => safeChange(false)}
              disabled={isRemoving}
              className="flex-1 whitespace-nowrap rounded-full border border-neutral-200 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900/60 dark:text-white dark:hover:bg-neutral-900/80"
            >
              Keep bots
            </button>
              <motion.button
                type="button"
                whileHover={isRemoving ? undefined : { scale: 1.01 }}
                whileTap={isRemoving ? undefined : { scale: 0.99 }}
                onClick={onConfirm}
                disabled={isRemoving}
                className="flex-1 whitespace-nowrap rounded-full border border-rose-300/60 bg-rose-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-white shadow-[0_20px_45px_rgba(244,63,94,0.35)] transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-200/50 dark:bg-rose-500/90 dark:hover:bg-rose-500"
              >
                {isRemoving ? 'Removing…' : 'Remove bots'}
              </motion.button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
