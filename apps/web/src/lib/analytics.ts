/**
 * Anonymous website stats for the admin panel: no cookies and nothing stored in the browser. Sends the
 * path of each page opened, and the seconds the page was actually on screen. Visitors who ask browsers
 * not to track them (Global Privacy Control, Do Not Track) aren't counted.
 */
const ENDPOINT = '/api/v1/public/track';

function optedOut() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}

function send(payload: Record<string, unknown>) {
  const body = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  // sendBeacon survives the page closing; fetch keeps working where it's blocked.
  if (!navigator.sendBeacon?.(ENDPOINT, body)) {
    void fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => undefined);
  }
}

let lastPath: string | null = null;

function trackView(path: string) {
  if (path === lastPath || path === '/admin' || path.startsWith('/admin/')) return;
  // The referrer only means something for the first page of a visit.
  send({ type: 'view', path, referrer: lastPath === null ? document.referrer || null : undefined });
  lastPath = path;
}

/** Starts tracking. `subscribe` reports each client-side navigation. */
export function startAnalytics(initialPath: string, subscribe: (onPath: (path: string) => void) => void) {
  if (optedOut()) return;
  trackView(initialPath);
  subscribe(trackView);

  let visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      visibleSince = Date.now();
    } else if (visibleSince !== null) {
      const seconds = Math.round((Date.now() - visibleSince) / 1000);
      visibleSince = null;
      if (seconds > 0) send({ type: 'engaged', seconds: Math.min(seconds, 1800) });
    }
  });
}
