import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, FileText, Share2, Globe, Video, Mail, Zap } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { CampaignWidget, useCampaign } from '@/components/CampaignWidget'
import { workspace } from '@/lib/workspace'

function Accordion({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <span className="text-sm font-semibold">{title}</span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 py-4 text-sm text-muted-foreground space-y-3 bg-white">
          {children}
        </div>
      )}
    </div>
  )
}

function Tip({ children }) {
  return (
    <div className="bg-primary/5 border border-primary/20 rounded-md px-3 py-2 text-xs text-foreground">
      <span className="font-semibold text-primary">Tip: </span>{children}
    </div>
  )
}

function Steps({ items }) {
  return (
    <ol className="space-y-1.5 list-none">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
            {i + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  )
}

function BulletList({ items }) {
  return (
    <ul className="space-y-1 list-none">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="shrink-0 text-primary mt-0.5">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

const PRIORITY_LIST = [
  { rank: 1, channel: 'Blog Post (Website SEO)', why: 'Drives compounding organic search traffic' },
  { rank: 2, channel: 'Google Business Profile Post', why: 'Boosts local search visibility immediately' },
  { rank: 3, channel: 'Instagram', why: 'Highest organic reach for health & movement content' },
  { rank: 4, channel: 'Facebook', why: 'Reaches local community and older demographics' },
  { rank: 5, channel: 'Email Newsletter', why: 'Direct line to warm leads and existing patients' },
  { rank: 6, channel: 'YouTube (long-form video)', why: 'Second-largest search engine; builds long-term trust' },
  { rank: 7, channel: 'LinkedIn', why: 'Referral network with physicians and allied health providers' },
  { rank: 8, channel: 'Google Ads / LSA', why: 'Captures high-intent searchers ready to book' },
  { rank: 9, channel: 'TikTok', why: 'Broad reach with younger or pain-adjacent audiences' },
  { rank: 10, channel: 'Pinterest', why: 'Long shelf-life visual content for chronic condition searches' },
]

const AUTOMATION_ROWS = [
  { trigger: 'New lead (ad or web form)', action: 'Auto-send intro email + SMS, add to nurture sequence' },
  { trigger: 'Lead opened email', action: 'Send follow-up SMS within 1 hour' },
  { trigger: 'Appointment booked', action: 'Confirmation email + pre-visit prep SMS' },
  { trigger: 'Appointment completed', action: '24-hr follow-up, review request, re-booking offer' },
  { trigger: 'No-show', action: 'Automated re-engagement with 3-touch follow-up' },
  { trigger: 'Seminar registration', action: 'Reminder sequence (7 days, 1 day, 2 hours before)' },
  { trigger: 'Referral submitted', action: 'Thank-you to referrer + intro sequence for new lead' },
  { trigger: 'Inactive patient (90+ days)', action: 'Re-activation campaign with education content' },
]

export default function Strategy() {
  const { campaign, saving, notesSaved, handleModeChange, handleNotesChange } = useCampaign()

  return (
    <div className="max-w-5xl mx-auto space-y-8">

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold tracking-tight">Content Distribution Strategy</h1>
          <Badge variant="secondary">{workspace.name}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          How to take each piece of content NarrateRx generates and deploy it for maximum reach and patient acquisition.
        </p>
      </div>

      {/* Content Focus — campaign mode editor */}
      <CampaignWidget
        campaign={campaign}
        saving={saving}
        notesSaved={notesSaved}
        onModeChange={handleModeChange}
        onNotesChange={handleNotesChange}
      />

      {/* Overview */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="font-semibold text-base">Why This Workflow Exists</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {workspace.name} clinicians have deep expertise that patients are actively searching for — but that expertise lives in a 30-minute conversation, not a Google search result. This tool extracts that knowledge from a structured interview, then formats it for every channel a prospective patient might encounter. One interview session produces 10+ ready-to-publish assets, turning clinician time into a compounding content library.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The strategy below tells you where to post each asset, in what order, and how to connect the pieces into a system that builds trust before a patient ever walks through the door.
        </p>
      </div>

      {/* Priority Order */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-base">Deployment Priority Order</h2>
          <p className="text-xs text-muted-foreground mt-1">Start here every time you publish. Each channel feeds the next.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 text-xs font-semibold text-muted-foreground w-8">#</th>
                <th className="pb-2 pr-4 text-xs font-semibold text-muted-foreground">Channel</th>
                <th className="pb-2 text-xs font-semibold text-muted-foreground">Why it's first</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PRIORITY_LIST.map(({ rank, channel, why }) => (
                <tr key={rank}>
                  <td className="py-2 pr-4 text-muted-foreground text-xs font-mono">{rank}</td>
                  <td className="py-2 pr-4 font-medium">{channel}</td>
                  <td className="py-2 text-muted-foreground text-xs">{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Channel Tabs */}
      <div>
        <h2 className="font-semibold text-base mb-3">Channel Guides</h2>
        <Tabs defaultValue="blog">
          <TabsList className="flex flex-wrap h-auto gap-1 mb-4">
            <TabsTrigger value="blog" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />Blog
            </TabsTrigger>
            <TabsTrigger value="social" className="gap-1.5">
              <Share2 className="h-3.5 w-3.5" />Social
            </TabsTrigger>
            <TabsTrigger value="google" className="gap-1.5">
              <Globe className="h-3.5 w-3.5" />Google
            </TabsTrigger>
            <TabsTrigger value="video" className="gap-1.5">
              <Video className="h-3.5 w-3.5" />Video
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-1.5">
              <Mail className="h-3.5 w-3.5" />Email
            </TabsTrigger>
            <TabsTrigger value="more">
              TDC
            </TabsTrigger>
          </TabsList>

          {/* BLOG */}
          <TabsContent value="blog" className="space-y-3">
            <Accordion title="Blog Post — SEO Foundation" defaultOpen>
              <p>The blog post is always published first. Every other asset links back to it, which builds the page's domain authority over time.</p>
              <Steps items={[
                'Publish the full blog post to your website CMS (WordPress, Squarespace, Webflow, etc.).',
                'Use the suggested SEO title and meta description from the output verbatim — these are written for search intent.',
                `Add at least one relevant internal link to another ${workspace.name} page (services, another blog post, booking page).`,
                'Add 2–3 external authority links (research studies, medical associations) if referenced in the content.',
                'Add a clear call-to-action at the bottom: book a free discovery call, register for a seminar, or contact the clinic.',
                'Submit the new URL to Google Search Console for faster indexing.',
              ]} />
              <Tip>Post on Tuesdays or Thursdays between 9–11am — these consistently have the highest organic traffic entry rates for health content.</Tip>
              <div>
                <p className="font-medium text-foreground mb-1">What makes a good health blog post rank:</p>
                <BulletList items={[
                  'Target one specific condition or symptom per post (not general wellness).',
                  'Use the patient\'s language, not clinical terminology (e.g., "back pain when sitting" not "lumbar radiculopathy").',
                  'Posts 800–1,200 words perform best for local health queries.',
                  'Include an FAQ section — these often appear in Google\'s "People Also Ask" feature.',
                  'Fresh content (updated within 12 months) outranks older posts in local search.',
                ]} />
              </div>
            </Accordion>
          </TabsContent>

          {/* SOCIAL */}
          <TabsContent value="social" className="space-y-3">
            <Accordion title="Instagram" defaultOpen>
              <p>Instagram is the highest-priority social channel for movement and health content. Short educational posts and reels consistently outperform promotional content.</p>
              <Steps items={[
                'Post the Instagram caption within 24 hours of publishing the blog post.',
                'Pair it with a graphic (Canva), a photo from the clinic, or a short video clip.',
                'Use the hashtags suggested in the output — these are a mix of broad (#physicaltherapy) and local (#sandiegopt) tags.',
                'Add your clinic location tag to every post.',
                'Reply to every comment within 2 hours of posting — early engagement signals boost reach.',
              ]} />
              <Tip>Stories (not feed posts) now drive most DM conversations. Reshare your feed post to Stories and add a "Book a call" link sticker.</Tip>
              <div>
                <p className="font-medium text-foreground mb-1">Content formats that perform best:</p>
                <BulletList items={[
                  'Carousel posts (swipe-through education): 2–3× more engagement than single images.',
                  'Reels under 60 seconds with on-screen text: highest organic reach.',
                  'Before/after movement demonstrations (with patient consent).',
                  '"Myth vs. Fact" format for common misconceptions about pain or movement.',
                ]} />
              </div>
            </Accordion>

            <Accordion title="Facebook">
              <p>Facebook reaches a different audience than Instagram — typically 35–60 year olds and local community groups. Use it for community building, not just broadcasting.</p>
              <Steps items={[
                'Post the Facebook version to your clinic page.',
                'Share the post into 2–3 relevant local Facebook Groups (community groups, neighborhood groups, condition-specific groups — check group rules first).',
                'Facebook posts with questions in them get significantly more comments — the output is written with this in mind.',
                'Run the post as a Boosted Post ($5–15/day for 3–5 days) to reach people in your zip code who match the condition audience.',
              ]} />
              <Tip>Facebook Events are underused for seminar marketing. Create a Facebook Event for every public seminar and invite your page followers — Event RSVPs often outperform email sign-ups for local audiences.</Tip>
            </Accordion>

            <Accordion title="LinkedIn">
              <p>LinkedIn is the referral channel. Your audience here is physicians, chiropractors, orthopedic surgeons, and other allied health providers who can send you patients.</p>
              <Steps items={[
                'Post the LinkedIn version on the clinician\'s personal profile, not just the company page — personal profiles have far higher reach.',
                'Write a 1–2 sentence personal intro before the generated content to make it feel authentic.',
                'Tag any physicians or colleagues mentioned in the post.',
                'Include a direct link to the full blog post in the first comment (not the post itself — LinkedIn\'s algorithm suppresses outbound links in the post body).',
                'Send the post as a direct message to 5–10 referral contacts with a note: "Thought this might be useful for your patients."',
              ]} />
              <Tip>LinkedIn content has a 2–3 week shelf life vs. Instagram's 48 hours. Don't post more than 3× per week — quality matters more than frequency here.</Tip>
              <div>
                <p className="font-medium text-foreground mb-1">What referral sources respond to:</p>
                <BulletList items={[
                  'Clinical outcomes and evidence-based approaches.',
                  'Specific patient success stories (anonymized).',
                  'Content that makes them look good for sharing.',
                  `Clear explanations of what ${workspace.name} does differently.`,
                ]} />
              </div>
            </Accordion>

            <Accordion title="Pinterest">
              <p>Pinterest is a long-tail search engine for health and wellness. Pins have an average lifespan of 3–6 months — far longer than other social posts.</p>
              <Steps items={[
                'Create a vertical graphic (1000×1500px) using the Pinterest caption text.',
                'Pin it to a relevant board (e.g., "Back Pain Relief," "Shoulder Rehab," "Movement Tips").',
                'Add the full blog post URL as the destination link.',
                'Include the keyword-rich description from the output in the Pin description field.',
              ]} />
              <Tip>Pinterest users skew heavily toward people researching chronic conditions for themselves or a family member — exactly the patient who is motivated to book and follow through on treatment.</Tip>
            </Accordion>
          </TabsContent>

          {/* GOOGLE */}
          <TabsContent value="google" className="space-y-3">
            <Accordion title="Google Business Profile Post" defaultOpen>
              <p>GBP posts appear directly in Google search results when someone searches for your clinic or a nearby PT clinic. They expire after 7 days, so post consistently.</p>
              <Steps items={[
                'Log in to your Google Business Profile at business.google.com.',
                'Click "Add Update" → "What\'s new" or "Offer" depending on the content.',
                'Paste the GBP post from the output. These are written under 300 words to fit the format.',
                'Add a photo — clinic interior, clinician headshot, or condition-relevant image.',
                'Set the call-to-action button: "Book" → link to your online booking page.',
                'Post every 7 days to keep the profile active (Google rewards consistent posting with higher local pack ranking).',
              ]} />
              <Tip>GBP posts with photos receive 42% more clicks than text-only posts. Keep a small library of clinic photos to rotate through.</Tip>
              <div>
                <p className="font-medium text-foreground mb-1">GBP ranking factors you control:</p>
                <BulletList items={[
                  'Post frequency (weekly minimum).',
                  'Review volume and recency (ask every happy patient).',
                  'Q&A section — add your own questions and answers so competitors can\'t.',
                  'Service menu completeness — list every condition you treat.',
                ]} />
              </div>
            </Accordion>

            <Accordion title="Google Ads (RSA) & Local Services Ads">
              <p>Google Ads capture high-intent patients actively searching for treatment — the highest-converting traffic source for physical therapy practices.</p>
              <div>
                <p className="font-medium text-foreground mb-1">Responsive Search Ads (RSA):</p>
                <Steps items={[
                  'Use the 3 headlines and 2 descriptions from the output in your RSA ad.',
                  'Group ads by condition — one ad group per condition treated.',
                  'Target keywords like "[condition] treatment [city]", "[condition] physical therapist near me".',
                  'Set location targeting to 10–15 mile radius around each clinic location.',
                  'Send clicks to the dedicated landing page (not your homepage).',
                ]} />
              </div>
              <div className="mt-3">
                <p className="font-medium text-foreground mb-1">Local Services Ads (LSA — already active):</p>
                <BulletList items={[
                  'LSAs appear above all regular ads. You only pay when a patient calls or messages directly.',
                  'Respond to every LSA lead within 5 minutes — Google tracks response rate and it affects your rank.',
                  'Mark leads as "Booked" or "Not a fit" in the LSA dashboard — this trains Google\'s algorithm.',
                  'Collect Google reviews from every patient — more reviews directly improve LSA rank.',
                ]} />
              </div>
              <Tip>Condition-specific landing pages (from the app output) convert 2–3× better than sending ad clicks to a generic homepage.</Tip>
            </Accordion>

            <Accordion title="Landing Page (Condition-Specific)">
              <p>Each condition-specific landing page serves as the destination for paid ads and a standalone SEO page for long-tail searches.</p>
              <Steps items={[
                'Create a dedicated page on your website for each major condition (e.g., /knee-pain-treatment).',
                'Use the landing page copy from the output as the page body.',
                'Add the SEO meta title and description to the page\'s HTML head.',
                'Include a prominent booking form or "Schedule a Free Discovery Call" button above the fold.',
                'Link back to the related blog post for patients who want more information.',
                'Add a patient testimonial or outcome statistic specific to that condition.',
              ]} />
              <Tip>Landing pages with a video of the clinician explaining the condition convert significantly better than text-only pages. A 60-second YouTube clip embedded on the page is enough.</Tip>
            </Accordion>
          </TabsContent>

          {/* VIDEO */}
          <TabsContent value="video" className="space-y-3">
            <Accordion title="YouTube (Long-Form)" defaultOpen>
              <p>YouTube is the second-largest search engine and the primary platform for health education. Videos rank in both YouTube search and Google's video results.</p>
              <Steps items={[
                'Record the video using the script from the output — it\'s structured as an intro hook, education section, and CTA.',
                'Keep videos 8–15 minutes for educational content (this maximizes watch time, which YouTube rewards).',
                'Upload with the suggested title, description, and tags from the output.',
                'Add the blog post URL in the first line of the description (visible without expanding).',
                'Create a custom thumbnail — faces and bold text outperform stock images.',
                'Add end cards linking to 2 related videos or a subscribe prompt.',
                'Pin a comment with your booking link immediately after publishing.',
              ]} />
              <Tip>A YouTube channel with 20+ condition-specific videos becomes a powerful referral tool — physicians will share your videos with patients as homework before their appointment.</Tip>
              <div>
                <p className="font-medium text-foreground mb-1">Video content ideas beyond the script:</p>
                <BulletList items={[
                  '"Day in the life" at the clinic — shows the patient experience.',
                  'Exercise demonstrations for home management of common conditions.',
                  'Patient Q&A compilations (with permission).',
                  'Seminar recordings uploaded after each event.',
                ]} />
              </div>
            </Accordion>

            <Accordion title="TikTok">
              <p>TikTok reaches audiences who aren't actively searching but will be — particularly 18–35 year olds and parents. Educational content about movement and pain performs extremely well.</p>
              <Steps items={[
                'Use the TikTok script as your outline — keep the final video under 60 seconds.',
                'Film in vertical format (9:16) in good natural light.',
                'Add on-screen text for the key point (most users watch without sound).',
                'Post at 6–9pm on weekdays for highest reach.',
                'Use the hashtags from the output — mix trending health tags with condition-specific ones.',
                'Reply to every comment in the first hour to boost algorithmic reach.',
              ]} />
              <Tip>TikTok\'s algorithm is the most democratic of all platforms — a brand new account with one great video can reach tens of thousands of people. Don\'t let zero followers stop you from starting.</Tip>
            </Accordion>
          </TabsContent>

          {/* EMAIL */}
          <TabsContent value="email" className="space-y-3">
            <Accordion title="Email Newsletter" defaultOpen>
              <p>Email is your highest-converting channel for turning warm leads and existing patients into scheduled appointments. It's also the one channel you own — no algorithm can cut your reach.</p>
              <Steps items={[
                'Send the email newsletter within 48 hours of publishing the blog post.',
                'Subject line: use the one from the output or test 2 variants (A/B test if your platform supports it).',
                'Keep the email to 300–400 words max — the goal is to get them to click through to the blog post.',
                'Include one clear CTA button: "Read the full article" or "Book a free discovery call."',
                'Segment your list if possible: send condition-specific content to patients with that condition history.',
              ]} />
              <Tip>A monthly newsletter with 4 educational articles (one per week from the app) outperforms a weekly newsletter with one article. Batch your interviews and schedule sends in advance.</Tip>
              <div>
                <p className="font-medium text-foreground mb-1">List-building strategies:</p>
                <BulletList items={[
                  'Add an email capture to every landing page with a lead magnet (e.g., "5 Exercises for Lower Back Pain — Free Guide").',
                  'Collect email at check-in for all new patients.',
                  'Offer seminar registration via email sign-up.',
                  'Use TrustDrivenCare forms embedded on your website to auto-add leads to the newsletter list.',
                ]} />
              </div>
            </Accordion>
          </TabsContent>

          {/* MORE */}
          <TabsContent value="more" className="space-y-3">
            <Accordion title="TrustDrivenCare (CRM) Automation" defaultOpen>
              <p>TrustDrivenCare is your practice's automation layer. Every piece of content generated by this app can be used to trigger, personalize, or feed the follow-up sequences below.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 pr-4 font-semibold text-foreground">Trigger</th>
                      <th className="pb-2 font-semibold text-foreground">Automated Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {AUTOMATION_ROWS.map(({ trigger, action }, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-4 font-medium text-foreground">{trigger}</td>
                        <td className="py-2 text-muted-foreground">{action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Tip>Use blog post content as the body of your email nurture sequences in TrustDrivenCare. Leads who receive 3–5 educational emails before calling book at a higher rate and are better-informed patients.</Tip>
              <div>
                <p className="font-medium text-foreground mb-1">High-priority workflows to build first:</p>
                <Steps items={[
                  'New Lead Nurture: 5-email sequence sent over 14 days, one educational article per email.',
                  'Seminar Reminder: 3 SMS/email reminders before each event (7 days, 1 day, 2 hours).',
                  'Review Request: Sent 24 hours after each appointment via SMS with direct Google Review link.',
                  'Re-activation: 3-touch campaign for patients not seen in 90+ days, referencing their specific condition.',
                ]} />
              </div>
            </Accordion>

            <Accordion title="Public Seminars">
              <p>Free public seminars are one of the highest-trust patient acquisition strategies available — especially for a clinic that differentiates on experience and philosophy. The content this app generates feeds directly into seminar promotion and materials.</p>
              <Steps items={[
                'Choose a seminar topic that matches a high-volume condition (lower back pain, shoulder impingement, etc.).',
                'Run NarrateRx on that topic before planning the seminar — use the content to build the talk outline.',
                'Promote the seminar 3–4 weeks in advance: Facebook Event, Instagram posts (use the generated captions), email blast, GBP post, and local Facebook Groups.',
                'Capture email addresses at registration via a TrustDrivenCare form.',
                'Follow up with attendees: send the related blog post within 24 hours, follow with a 3-email nurture sequence.',
                'Record the seminar and upload to YouTube as a long-form video asset.',
              ]} />
              <Tip>Seminars convert attendees to patients at a very high rate because they demonstrate competence and philosophy before any sales conversation. Price the seminar at $0 — remove all friction to attend.</Tip>
              <div>
                <p className="font-medium text-foreground mb-1">Seminar topic selection:</p>
                <BulletList items={[
                  'Match topics to your highest-converting conditions (not just most common).',
                  'Seasonal topics work well: "Prevent Running Injuries Before Summer" in April.',
                  'Partner with local gyms, yoga studios, or corporate wellness programs for venue and cross-promotion.',
                  'Aim for 1 seminar per month to build a consistent community presence.',
                ]} />
              </div>
            </Accordion>

            <Accordion title="Online Directories & Referral Sources">
              <p>Beyond search and social, there are high-intent directories where patients specifically look for physical therapists. These require one-time setup but generate ongoing referrals.</p>
              <div>
                <p className="font-medium text-foreground mb-1">Priority directories to claim and optimize:</p>
                <BulletList items={[
                  'Healthgrades — complete your profile with all conditions treated and include a bio from your LinkedIn content.',
                  'Psychology Today (if offering chronic pain or movement-based mental health support).',
                  'Zocdoc — enables direct booking for patients with insurance.',
                  'Yelp Business — maintain a response to every review (positive and negative).',
                  'WebPT Directory (if applicable to your practice management system).',
                  'Insurance provider directories — confirm your listing is accurate and up-to-date with each payer.',
                ]} />
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">Physician referral outreach:</p>
                <BulletList items={[
                  'Share LinkedIn posts directly with referring physicians via DM — educational content about conditions they see.',
                  'Send a monthly email to your referral network with the best blog post from that month.',
                  'Offer to present at a physician lunch-and-learn using a seminar format.',
                  'Provide referring physicians with patient outcome reports (de-identified) to demonstrate results.',
                ]} />
              </div>
            </Accordion>
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer CTA */}
      <div className="rounded-xl border bg-muted/30 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Ready to generate content?</p>
          <p className="text-xs text-muted-foreground mt-0.5">Start a new interview to produce all 10 assets from a single session.</p>
        </div>
        <Link
          to="/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <Zap className="h-4 w-4" />
          Start New Interview
        </Link>
      </div>
    </div>
  )
}
