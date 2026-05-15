import { Link } from 'react-router-dom'

const EFFECTIVE = 'May 15, 2026'
const CONTACT   = 'narraterx@gmail.com'

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="mb-10">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to NarrateRx
          </Link>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="mt-2 text-sm text-muted-foreground">Effective {EFFECTIVE}</p>
        </div>

        {/* Body */}
        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-sm leading-relaxed">

          <section>
            <p>
              NarrateRx is operated by NarrateRx (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or
              &ldquo;us&rdquo;). This policy explains what information we collect when you use
              NarrateRx, how we use it, and the choices you have.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">1. What we collect</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Account information.</strong> Your name, email address, and workspace
                details when you sign up or are invited to a workspace. Authentication is
                managed by Clerk; we do not store passwords.
              </li>
              <li>
                <strong>Interview content.</strong> Transcripts and recordings you create
                within NarrateRx, including the AI-generated drafts produced from them.
                This content lives in your workspace and is not shared with other tenants.
              </li>
              <li>
                <strong>Media assets.</strong> Images and videos you upload to the Media Hub.
                Files are stored in Vercel Blob storage associated with your workspace.
              </li>
              <li>
                <strong>Usage data.</strong> Actions you take in the product (pages visited,
                features used, content approved or rejected) to help us improve the service.
                We do not sell this data.
              </li>
              <li>
                <strong>Billing information.</strong> Payment details are processed directly
                by Stripe and never stored on our servers. We receive a billing reference
                (customer ID and subscription status) from Stripe.
              </li>
              <li>
                <strong>Cookies &amp; local storage.</strong> We use session cookies set by
                Clerk for authentication and browser local storage for UI preferences
                (e.g., which panel is open). We do not use advertising trackers.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">2. How we use your information</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>To provide and operate the NarrateRx service.</li>
              <li>
                To process interview transcripts through AI models in order to generate
                content drafts. Transcripts are sent to the AI provider (Anthropic) solely
                for this purpose and under their data-processing terms.
              </li>
              <li>
                To send transactional emails (invites, password resets, billing receipts).
                We do not send marketing email unless you opt in.
              </li>
              <li>To diagnose errors and improve reliability.</li>
              <li>To comply with legal obligations.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">3. Third-party processors</h2>
            <p className="mb-3">
              We rely on the following sub-processors to deliver the service. Each is
              contractually bound to protect your data:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium">Provider</th>
                    <th className="text-left py-2 pr-4 font-medium">Purpose</th>
                    <th className="text-left py-2 font-medium">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr><td className="py-2 pr-4">Vercel</td><td className="py-2 pr-4">Hosting &amp; serverless compute</td><td className="py-2">USA</td></tr>
                  <tr><td className="py-2 pr-4">Supabase</td><td className="py-2 pr-4">Database</td><td className="py-2">USA</td></tr>
                  <tr><td className="py-2 pr-4">Clerk</td><td className="py-2 pr-4">Authentication</td><td className="py-2">USA</td></tr>
                  <tr><td className="py-2 pr-4">Anthropic</td><td className="py-2 pr-4">AI content generation</td><td className="py-2">USA</td></tr>
                  <tr><td className="py-2 pr-4">Stripe</td><td className="py-2 pr-4">Payment processing</td><td className="py-2">USA</td></tr>
                  <tr><td className="py-2 pr-4">Buffer</td><td className="py-2 pr-4">Social media scheduling (optional)</td><td className="py-2">USA</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">4. Data retention</h2>
            <p>
              Your workspace data is retained for the duration of your subscription plus
              90 days after cancellation, giving you time to export your content. After
              that period, workspace data is permanently deleted. You may request earlier
              deletion by contacting us at{' '}
              <a href={`mailto:${CONTACT}`} className="text-primary underline-offset-4 hover:underline">{CONTACT}</a>.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">5. Your rights</h2>
            <p>
              Depending on where you are located, you may have rights to access, correct,
              export, or delete your personal data. To exercise any of these rights, email
              us at{' '}
              <a href={`mailto:${CONTACT}`} className="text-primary underline-offset-4 hover:underline">{CONTACT}</a>.
              We will respond within 30 days.
            </p>
            <p className="mt-2">
              If you are in the European Economic Area or the United Kingdom, the legal
              basis for processing your data is contract performance (to deliver the service
              you signed up for) and, where applicable, our legitimate interest in improving
              reliability and security. You may lodge a complaint with your local data
              protection authority.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">6. Security</h2>
            <p>
              All data is encrypted in transit (TLS) and at rest. Publish credentials
              (social media tokens, CMS passwords) are encrypted at the column level before
              storage. We follow industry-standard practices and review them periodically.
              No system is perfectly secure; if you suspect unauthorized access, contact us
              immediately.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">7. Changes to this policy</h2>
            <p>
              We may update this policy. Material changes will be communicated via email
              and an in-app notice at least 14 days before they take effect. The current
              version is always at <code className="text-xs bg-muted px-1 py-0.5 rounded">narraterx.ai/privacy</code>.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">8. Contact</h2>
            <p>
              NarrateRx<br />
              Portland, OR, USA<br />
              <a href={`mailto:${CONTACT}`} className="text-primary underline-offset-4 hover:underline">{CONTACT}</a>
            </p>
          </section>

        </div>

        {/* Footer links */}
        <div className="mt-12 pt-6 border-t flex gap-4 text-sm text-muted-foreground">
          <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Link to="/" className="hover:text-foreground transition-colors">Back to app</Link>
        </div>

      </div>
    </div>
  )
}
