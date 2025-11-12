import { motion, useAnimation, useMotionValue } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

type EarTagProps = {
  isPanelVisible: boolean;
  onToggle: (nextState: boolean) => void | Promise<void>;
  logoUrl: string;
  badgeValue?: number;
};

const earVariants = {
  idle: {
    scale: [1, 1.06, 1],
    filter: [
      'brightness(1) saturate(1)',
      'brightness(1.15) saturate(1.35)',
      'brightness(1) saturate(1)',
    ],
    transition: {
      duration: 1.4,
      times: [0, 0.5, 1],
      ease: 'easeInOut',
      repeat: Infinity,
      repeatDelay: 5,
    },
  },
  active: {
    scale: 1,
    filter: 'brightness(1)',
    transition: {
      duration: 0.3,
    },
  },
};

export default function EarTag({
  isPanelVisible,
  onToggle,
  logoUrl,
  badgeValue = 0,
}: EarTagProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [constraints, setConstraints] = useState(() => computeConstraints());
  const x = useMotionValue(0);
  const y = useMotionValue(160);
  const controls = useAnimation();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    x.set(window.innerWidth - 84);
    y.set(Math.max(120, window.innerHeight / 3));
    const updateConstraints = () => setConstraints(computeConstraints());
    window.addEventListener('resize', updateConstraints);
    return () => window.removeEventListener('resize', updateConstraints);
  }, [x, y]);

  useEffect(() => {
    controls.start(isPanelVisible ? 'active' : 'idle');
  }, [controls, isPanelVisible]);

  const badge = useMemo(() => {
    if (!badgeValue || badgeValue <= 0) return null;
    if (badgeValue > 99) return '99+';
    return badgeValue.toString();
  }, [badgeValue]);

  const handleClick = () => {
    if (isDragging) return;
    onToggle(!isPanelVisible);
  };

  return (
    <motion.button
      type="button"
      drag
      dragMomentum
      dragElastic={0.4}
      dragConstraints={constraints}
      style={{ x, y }}
      aria-label="X Bot Cleaner ear tag"
      className={cn(
        'fixed z-[2147483647] flex h-16 w-14 flex-col items-center justify-center gap-1 rounded-full border border-white/40',
        'bg-blue-500/90 text-white backdrop-blur-2xl',
        'transition-colors duration-300 hover:bg-blue-400/90 focus:outline-none',
      )}
      onPointerDown={() => setIsDragging(false)}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      onClick={handleClick}
      whileTap={{ scale: 0.95 }}
      animate={controls}
      initial="active"
    >
      <span className="flex items-center justify-center">
        <img
          src={logoUrl}
          alt="X Bot Cleaner"
          className="h-6 w-6 rounded-full border border-white/40 bg-white/20 object-contain p-0.5"
        />
      </span>
      <span className="text-[9px] uppercase tracking-[0.4em]">XBC</span>
      {badge && (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold text-blue-600">
          {badge}
        </span>
      )}
      <span className="sr-only">
        {isPanelVisible ? 'Hide panel' : 'Show panel'}
      </span>
    </motion.button>
  );
}

function computeConstraints() {
  if (typeof window === 'undefined') {
    return {
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    };
  }
  return {
    top: 16,
    right: 0,
    bottom: Math.max(16, window.innerHeight - 120),
    left: -Math.max(16, window.innerWidth - 84),
  };
}
