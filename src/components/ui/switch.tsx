import * as React from 'react';
import { cn } from '@/lib/utils';

type SwitchProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
};

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked = false, defaultChecked, disabled, onCheckedChange }, ref) => {
    const [internalChecked, setInternalChecked] = React.useState(defaultChecked ?? false);
    const isControlled = typeof checked === 'boolean';
    const currentChecked = isControlled ? checked : internalChecked;

    const toggle = () => {
      if (disabled) return;
      const next = !currentChecked;
      if (!isControlled) {
        setInternalChecked(next);
      }
      onCheckedChange?.(next);
    };

    return (
      <button
        type="button"
        role="switch"
        aria-checked={currentChecked}
        disabled={disabled}
        ref={ref}
        onClick={toggle}
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200',
          'data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500',
          'data-[state=unchecked]:border-neutral-300 data-[state=unchecked]:bg-neutral-200',
          'dark:data-[state=checked]:border-blue-400 dark:data-[state=checked]:bg-blue-500/80',
          'dark:data-[state=unchecked]:border-neutral-600 dark:data-[state=unchecked]:bg-neutral-800',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
        data-state={currentChecked ? 'checked' : 'unchecked'}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-white transition-transform',
            currentChecked ? 'translate-x-5' : 'translate-x-1',
          )}
        />
      </button>
    );
  },
);

Switch.displayName = 'Switch';
