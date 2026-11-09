import { APP_NAME } from '@brickledger/shared/web';
import type { ReactNode } from 'react';

/**
 * Starter legal pages. These are templates describing how the product handles
 * data - have them reviewed by a lawyer for your jurisdiction before launch.
 */
export function Legal({ kind }: { kind: 'terms' | 'privacy' }) {
  const terms = kind === 'terms';
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-white">{terms ? 'Terms of service' : 'Privacy policy'}</h1>
      <p className="mt-2 text-sm text-stone-500">Last updated: {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-stone-700 dark:text-stone-300">
        {terms ? (
          <>
            <Section title="1. The service">{APP_NAME} provides software to record and analyse costs, materials, labour, schedules and documents for construction projects. Figures in the app are entered by you and your team; {APP_NAME} does not verify them and does not provide financial, legal or engineering advice.</Section>
            <Section title="2. Accounts">You are responsible for activity under your account and for the people you invite to your projects. Keep your password confidential and tell us about any unauthorised use.</Section>
            <Section title="3. Plans and billing">Paid plans renew automatically each month or year until cancelled. You can cancel at any time; the plan stays active until the end of the paid period. If a paid plan ends, your workspace moves to the free Starter plan and your data is kept.</Section>
            <Section title="4. Your data">You own the content you add. You grant us permission to store and process it only to run the service for you. You can export your data as CSV at any time and delete your account from the app.</Section>
            <Section title="5. Acceptable use">Don’t upload unlawful content, try to access other customers’ data, or disrupt the service.</Section>
            <Section title="6. Liability">The service is provided “as is”. To the extent permitted by law, our total liability is limited to the amount you paid us in the 12 months before the claim.</Section>
          </>
        ) : (
          <>
            <Section title="What we collect">Your name, email and phone number; the project data you and your team enter (expenses, vendors, workers, photos and documents); and basic technical logs (IP address, device type) needed to keep the service secure.</Section>
            <Section title="How we use it">Only to provide and improve {APP_NAME}: syncing your data across devices, sending account emails (password resets, invitations, billing) and preventing abuse. We do not sell your data or use it for advertising.</Section>
            <Section title="Who can see your projects">Only people you invite, with the role you choose. Workspace owners and admins can see every project in their workspace.</Section>
            {/* Keep in step with apps/api/src/modules/tracking/routes.ts. */}
            <Section title="Usage statistics">To understand how the product is used, we count pages opened, time spent, the website that referred a visitor, their country and device type, and how often the Android app is downloaded and opened. These are stored as daily totals. We don’t use cookies for this, don’t store IP addresses for it, and don’t link the numbers to your account. To count each visitor once a day we keep a scrambled code that changes daily and is deleted after a few days. The app sends a random install code and its version number, which aren’t connected to your account. Browsers set to Global Privacy Control or Do Not Track aren’t counted.</Section>
            <Section title="Administrators">Our administrators can see account details (name, email, phone, sign-in times and devices), workspace plans, project names and how many records they hold, to give support and stop abuse. They don’t see the contents of your projects through the admin panel, and every action they take is logged.</Section>
            <Section title="Payments">Card and UPI payments are handled by our payment processor (Stripe or Razorpay). We never see or store full card details.</Section>
            <Section title="Retention and deletion">You can delete your account at any time from Account settings. Deleting your account permanently removes the workspaces you own, including their projects and files.</Section>
            <Section title="Security">Passwords are hashed, data is encrypted in transit, refresh tokens rotate, and files are only served through short-lived signed links.</Section>
            <Section title="Contact">Questions about privacy: privacy@brickledger.app</Section>
          </>
        )}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-stone-900 dark:text-white">{title}</h2>
      <p>{children}</p>
    </section>
  );
}
