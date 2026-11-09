import { useSyncExternalStore } from 'react';

/** Matches Tailwind's `lg` breakpoint, where the layout switches from tabs to side-by-side panels. */
const DESKTOP = '(min-width: 1024px)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP).matches);
}
