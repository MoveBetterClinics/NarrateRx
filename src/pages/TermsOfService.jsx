import { Link } from 'react-router-dom'

const EFFECTIVE = 'May 15, 2026'
const CONTACT   = 'narraterx@gmail.com'

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="mb-10">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to NarrateRx
          </Link>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">Terms of Service</h1>
          <p className="mt-2 text-sm text-muted-foreground">Effective {EFFECTIVE}</p>
        </div>

        {/* Body */}
        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-sm leading-relaxed">

          <section>
            <p>
              These Terms of Service (&ldquo;Terms&rdquo;) govern your use of NarrateRx,
              operated by NarrateRx (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;).
              By accessing or using NarrateRx you agree to these Terms. If you are using
              NarrateRx on behalf of an organization, you represent that you have authority
              to bind that organization.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">1. The service</h2>
            <p>
              NarrateRx is a software-as-a-service platform that helps clinicians capture
              interview recordings, generate AI-assisted content drafts, and publish
              approved content to connected channels. Features and pricing may change with
              reasonable notice.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">2. Accounts &amp; workspaces</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                You are responsible for keeping your login credentials secure. Notify us
                immediately at{' '}
                <a href={`mailto:${CONTACT}`} className="text-primary underline-offset-4 hover:underline">{CONTACT}</a>
                {' '}if you suspect unauthorized access.
              </li>
              <li>
                Workspace administrators are responsible for managing member access,
                inviting or removing users, and ensuring members comply with these Terms.
              </li>
              <li>
                You must be at least 18 years old to use the service.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">3. Your content</h2>
            <p>
              You retain ownership of all content you create in NarrateRx — interview
              transcripts, recordings, uploaded media, and generated drafts. By using the
              service you grant us a limited licence to store, process, and transmit your
              content solely to operate NarrateRx on your behalf (including sending
              transcripts to AI models to produce drafts).
            </p>
            <p className="mt-2">
              We do not use your content to train AI models or share it with other tenants.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">4. AI-generated content</h2>
            <p>
              NarrateRx uses large language models to generate content drafts from your
              interviews. You are responsible for reviewing, editing, and approving all
              AI-generated output before publishing. We make no warranty that AI-generated
              drafts are accurate, complete, or suitable for any particular purpose. The
              clinician or workspace administrator who approves content for publication
              takes responsibility for that content.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">5. Acceptable use</h2>
            <p className="mb-2">You agree not to:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Use the service to generate or distribute unlawful, defamatory, or misleading content.</li>
              <li>
                Store protected health information (PHI) as defined under HIPAA or
                equivalent regulations in any interview, transcript, or media upload.
                NarrateRx is a content creation tool, not an electronic health record
                system, and is not designed or certified for PHI storage.
              </li>
              <li>Attempt to access another tenant&apos;s workspace or data.</li>
              <li>Reverse-engineer, decompile, or resell the service.</li>
              <li>Use automated scripts to overload or abuse the API.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">6. HIPAA notice</h2>
            <p>
              NarrateRx is designed for creating clinical thought-leadership and marketing
              content — not for storing, transmitting, or processing patient records.
              <strong> Do not enter patient-identifying information</strong> (names, dates
              of birth, health record numbers, or any other PHI) into interview transcripts
              or any other field. We are not a HIPAA-covered entity and do not offer a
              Business Associate Agreement. Use de-identified case examples only.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">7. Subscriptions &amp; billing</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                Paid plans are billed through Stripe on a recurring basis (monthly or
                annual, depending on your plan). Prices are shown in USD.
              </li>
              <li>
                You may cancel at any time from your account settings. Cancellation takes
                effect at the end of the current billing period; no prorated refunds are
                issued for unused time except where required by law.
              </li>
              <li>
                We reserve the right to change pricing with 30 days&apos; notice. Continued
                use after a price change constitutes acceptance.
              </li>
              <li>
                If payment fails and is not resolved within 14 days, we may suspend access
                until the account is settled.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">8. Availability &amp; changes</h2>
            <p>
              We aim for high availability but do not guarantee uninterrupted service.
              We may modify or discontinue features with reasonable notice. For material
              changes to a paid plan, we will give at least 30 days&apos; notice or offer
              a prorated refund.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">9. Intellectual property</h2>
            <p>
              The NarrateRx platform, including its design, code, and brand, is owned by
              NarrateRx and protected by copyright and other laws. These Terms do not
              grant you any rights in NarrateRx beyond the limited licence to use the
              service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">10. Disclaimer of warranties</h2>
            <p>
              The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
              warranties of any kind, express or implied, including fitness for a particular
              purpose or non-infringement. We do not warrant that the service will be
              error-free or that AI-generated content will meet any standard of accuracy
              or clinical quality.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">11. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, NarrateRx&apos;s total liability
              for any claim arising from your use of the service is limited to the greater
              of (a) the amount you paid us in the 12 months before the claim arose or
              (b) $100 USD. We are not liable for indirect, consequential, or punitive
              damages, including loss of revenue or data, even if advised of the
              possibility.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">12. Governing law</h2>
            <p>
              These Terms are governed by the laws of the State of Oregon, USA, without
              regard to conflict of law principles. Disputes shall be resolved in the
              courts of Portland, Oregon, unless you and we agree otherwise in writing.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">13. Changes to these Terms</h2>
            <p>
              We may update these Terms. Material changes will be communicated via email
              and an in-app notice at least 14 days before they take effect. Continued use
              after the effective date constitutes acceptance. The current version is
              always at <code className="text-xs bg-muted px-1 py-0.5 rounded">narraterx.ai/terms</code>.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">14. Contact</h2>
            <p>
              NarrateRx<br />
              Portland, OR, USA<br />
              <a href={`mailto:${CONTACT}`} className="text-primary underline-offset-4 hover:underline">{CONTACT}</a>
            </p>
          </section>

        </div>

        {/* Footer links */}
        <div className="mt-12 pt-6 border-t flex gap-4 text-sm text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Link to="/" className="hover:text-foreground transition-colors">Back to app</Link>
        </div>

      </div>
    </div>
  )
}
