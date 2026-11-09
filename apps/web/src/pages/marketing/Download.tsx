import { APP_NAME } from '@brickledger/shared/web';
import { CircleCheck, Download, Info, ShieldCheck, Smartphone, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { buttonClass } from '../../components/ui/button';

/** Written by `npm run release:android` next to the APK (apps/web/public/apk/android.json). */
interface AndroidRelease {
  versionName: string;
  versionCode: number;
  size: number;
  sha256: string;
  minAndroid: string;
  url: string;
  publishedAt: string;
  notes?: string;
}

type Device = 'android' | 'ios' | 'other';

function detectDevice(): Device {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return 'other';
}

function useAndroidRelease() {
  const [state, setState] = useState<{ release?: AndroidRelease; missing?: boolean }>({});
  useEffect(() => {
    let cancelled = false;
    fetch('/apk/android.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<AndroidRelease>) : Promise.reject(new Error(String(r.status)))))
      .then((release) => !cancelled && setState({ release }))
      .catch(() => !cancelled && setState({ missing: true }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const steps: [string, string][] = [
  ['Download', 'Tap “Download for Android”. If your browser warns that this type of file can be harmful, tap “Download anyway”.'],
  ['Open the file', 'Open it from the download notification, or from Files → Downloads.'],
  ['Allow the install', 'If Android asks, allow your browser (or Files) to “Install unknown apps”, go back and tap Install.'],
  ['Sign in', `Open ${APP_NAME} and sign in with the same account you use on this website - or tap “Use offline on this phone” to start without one.`],
];

export function DownloadPage() {
  const { release, missing } = useAndroidRelease();
  const [device] = useState(detectDevice);

  useEffect(() => {
    const previous = document.title;
    document.title = `Download the Android app - ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <main>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_20%_0%,rgb(253_186_116/0.25),transparent),radial-gradient(40%_40%_at_90%_10%,rgb(147_197_253/0.18),transparent)] dark:bg-[radial-gradient(60%_50%_at_20%_0%,rgb(234_88_12/0.15),transparent)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
              <Smartphone className="size-3.5" /> Android app
            </span>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-stone-900 sm:text-5xl dark:text-white">{APP_NAME} on your phone</h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-stone-600 dark:text-stone-300">
              Record bills, attendance, stock and site photos where the work happens. Everything is saved on the phone and syncs with this website when there’s signal.
            </p>

            {device === 'ios' && (
              <div className="mt-6 flex max-w-xl gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
                <Info className="mt-0.5 size-4 shrink-0" />
                <p>
                  There’s no iPhone app yet. {APP_NAME} works in Safari: open this website, tap <strong>Share</strong> → <strong>Add to Home Screen</strong> to keep it one tap away.
                </p>
              </div>
            )}

            <div className="mt-8">
              {release ? (
                <>
                  <a
                    href={`/api/v1/public/download/android?source=web&v=${encodeURIComponent(release.versionName)}`}
                    download={`${APP_NAME}-${release.versionName}.apk`}
                    className={buttonClass(device === 'ios' ? 'secondary' : 'primary', 'lg')}
                  >
                    <Download className="size-5" />
                    Download for Android
                  </a>
                  <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
                    Version {release.versionName} · {mb(release.size)} · Android {release.minAndroid} or newer
                  </p>
                  {release.notes && <p className="mt-2 max-w-xl text-sm text-stone-600 dark:text-stone-300"><strong>What’s new:</strong> {release.notes}</p>}
                </>
              ) : missing ? (
                <p className="max-w-xl rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
                  The Android app isn’t available for download yet. You can use {APP_NAME} in your phone’s browser in the meantime.
                </p>
              ) : (
                <div className="h-12 w-60 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800" aria-label="Loading" />
              )}
            </div>

            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-500 dark:text-stone-400">
              {[
                [<WifiOff key="i" className="size-4 text-[var(--good)]" />, 'Works without signal'],
                [<CircleCheck key="i" className="size-4 text-[var(--good)]" />, 'Same account as the website'],
                [<ShieldCheck key="i" className="size-4 text-[var(--good)]" />, 'Free to download'],
              ].map(([icon, text]) => (
                <li key={text as string} className="flex items-center gap-1.5">
                  {icon}
                  {text}
                </li>
              ))}
            </ul>
          </div>

          {release && device === 'other' && (
            <div className="mx-auto hidden w-full max-w-xs rounded-3xl border border-stone-200 bg-white p-6 text-center shadow-xl shadow-stone-900/5 lg:block dark:border-stone-800 dark:bg-stone-900">
              <img src="/apk/qr.svg" alt="QR code that opens this download page" width={192} height={192} className="mx-auto size-48 rounded-xl bg-white p-1" />
              <p className="mt-4 text-sm font-semibold text-stone-900 dark:text-white">On your computer?</p>
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Scan with your phone’s camera to open this page there.</p>
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-stone-200/70 bg-stone-50/60 dark:border-stone-800 dark:bg-stone-950/50">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white">How to install</h2>
            <ol className="mt-6 space-y-5">
              {steps.map(([title, body], i) => (
                <li key={title} className="flex gap-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                  <div>
                    <p className="font-semibold text-stone-900 dark:text-white">{title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-stone-600 dark:text-stone-400">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-4 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
            <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
              <p className="font-semibold text-stone-900 dark:text-white">Why does Android ask before installing?</p>
              <p className="mt-2">
                The app comes straight from this website rather than Google Play, so Android asks you to confirm. If Play Protect says it doesn’t recognise the app, tap <strong>More details</strong> → <strong>Install anyway</strong>.
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
              <p className="font-semibold text-stone-900 dark:text-white">Updating</p>
              <p className="mt-2">The app tells you when a new version is ready: tap <strong>Update now</strong>. You can also download the latest version here and install it over the old one. Your projects stay on the phone and in your account.</p>
            </div>
            {release && (
              <details className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
                <summary className="cursor-pointer font-semibold text-stone-900 dark:text-white">File details</summary>
                <dl className="mt-3 space-y-1.5">
                  <div className="flex gap-2"><dt className="text-stone-500">Version</dt><dd>{release.versionName} (build {release.versionCode})</dd></div>
                  <div className="flex gap-2"><dt className="text-stone-500">Published</dt><dd>{new Date(release.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div>
                  <div><dt className="text-stone-500">SHA-256</dt><dd className="mt-0.5 break-all font-mono text-xs">{release.sha256}</dd></div>
                </dl>
              </details>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
