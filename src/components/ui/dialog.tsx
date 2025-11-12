import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

import { extensionId } from '@/lib/config';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const getExtensionAppRoot = (): HTMLElement | null => {
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
  return document.getElementById(`${extensionId}-app`) ?? document.body;
};

const DialogPortal = ({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>) => {
  const [target, setTarget] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setTarget(getExtensionAppRoot());
  }, []);

  if (!target) return null;

  return (
    <DialogPrimitive.Portal container={target} {...props}>
      {children}
    </DialogPrimitive.Portal>
  );
};

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay {...props} asChild>
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className={cn(
        'fixed inset-0 z-[2147483646] bg-black/60 backdrop-blur-2xl transition-opacity',
        className,
      )}
    />
  </DialogPrimitive.Overlay>
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content {...props} asChild>
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 20, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-0 z-[2147483647] flex items-center justify-center p-6"
      >
        <div
          className={cn(
            'relative w-full max-w-[400px] rounded-[32px] border border-white/20 bg-white px-6 py-7 text-neutral-900 shadow-[0px_45px_120px_rgba(15,23,42,0.45)] backdrop-blur-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 dark:border-white/10 dark:bg-neutral-900/70 dark:text-white',
            className,
          )}
        >
          {children}
          <DialogPrimitive.Close
            className="absolute right-5 top-5 inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-100 bg-white text-neutral-700 transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 dark:border-white/20 dark:bg-neutral-800/80 dark:text-white dark:hover:bg-neutral-700/90"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Close dialog</span>
          </DialogPrimitive.Close>
        </div>
      </motion.div>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('space-y-3 text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-[12px] font-semibold uppercase tracking-[0.32em] text-neutral-500 dark:text-neutral-300',
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn(
      'leading-relaxed text-sm text-neutral-600 dark:text-neutral-200',
      className,
    )}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end',
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
};
