import { APP_NAME } from '@brickledger/shared/web';
import { cn } from '../lib/cn';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 108 108" className={cn('size-8', className)} aria-hidden="true">
      <rect width="108" height="108" rx="26" fill="#ea580c" />
      <path fill="#fff" d="M54 24 L83 49 L77 49 L77 80 Q77 83 74 83 L34 83 Q31 83 31 80 L31 49 L25 49 Z" />
      <path fill="#ea580c" d="M36 54h16v7H36zM56 54h16v7H56zM36 64h7v7h-7zM46 64h16v7H46zM65 64h7v7h-7zM49 73h10v10H49z" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact && <span className="text-[17px] font-bold tracking-tight text-stone-900 dark:text-white">{APP_NAME}</span>}
    </span>
  );
}
