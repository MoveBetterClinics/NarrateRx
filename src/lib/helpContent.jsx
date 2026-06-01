import {
  FileText, Send, CheckCircle2, Sparkles,
  BarChart3, Film, Scissors, Filter, LayoutGrid, Target, Calendar,
} from 'lucide-react'

// Per-page Help content registry.
//
// Each entry feeds <PageHelp pageKey="..."/>. Keep copy in plain language:
// lead with what the page DOES, define any jargon inline, no acronyms.
//
// Shape:
//   title  — modal heading
//   intro  — one-paragraph "what this page is for"
//   steps  — ordered list, each { icon, title, body }
//   notes  — optional callout boxes at the bottom, each { title, body }
//
// To add a page: add an entry here, then drop <PageHelp pageKey="yourKey" />
// next to that page's title.
export const HELP_CONTENT = {
  home: {
    title: 'Home — how it works',
    intro:
      'Home is your personal starting point. It shows what is waiting on you right now and the fastest path to start something new. Think of it as the front desk: it points you to the right room rather than holding the work itself.',
    steps: [
      {
        icon: Send,
        title: 'Start an interview',
        body: 'The main button kicks off a new interview — the conversation that turns what you know into finished posts. Everything in the pipeline begins here.',
      },
      {
        icon: FileText,
        title: 'See what needs your attention',
        body: 'Buckets surface work that is ready for the next step: stories waiting for posts to be written, pieces ready to send out, and clinicians who are due for their next interview.',
      },
      {
        icon: CheckCircle2,
        title: 'Pick up in-progress interviews',
        body: 'If you left an interview half-finished, a strip at the top lets you jump back in. Each strip shows the clinician, the date, and a direct link back to where you left off.',
      },
      {
        icon: Sparkles,
        title: 'Get a running start on topics',
        body: 'Suggested topics give you a starting point when you are not sure what to talk about next. The system looks at what has already been captured and surfaces areas that would round out the content mix.',
      },
    ],
    notes: [
      {
        title: 'Where the work actually lives',
        body: 'Home links out; it does not store. Drafts and finished posts live on Stories, raw video clips are cut on the Slate, and the clinic-wide board lives on Overview. Home is just the shortest path to each.',
      },
    ],
  },

  slate: {
    title: 'Clip Workshop — how it works',
    intro:
      'The Clip Workshop is where you turn raw source videos into short, polished clips. Pick a video from your library, trim the best moment, add a caption, and send it forward — either as a post draft ready for Words, or as b-roll saved back to the Library.',
    steps: [
      {
        icon: Film,
        title: 'Browse your source videos',
        body: 'The grid shows every video in your Library. A badge on each card shows how many clips have already been cut from it, so you know what is already worked and what still has potential.',
      },
      {
        icon: Scissors,
        title: 'Cut a clip',
        body: 'Click "Cut a clip" on any video to open the Clip Editor. Drag the trim handles to isolate the best moment — a technique demonstration, a key insight, a memorable moment.',
      },
      {
        icon: FileText,
        title: 'Caption your clip',
        body: 'Add or edit the caption for the clip. The editor pre-populates one from the surrounding transcript when it is available; refine it before sending.',
      },
      {
        icon: Send,
        title: 'Send it somewhere',
        body: 'When the clip is ready, send it to a post draft — it lands on the Storyboard in the Words step — or save it to the Library as b-roll for future use. One clip, two destinations.',
      },
      {
        icon: BarChart3,
        title: 'Check Coverage for gaps',
        body: 'The Coverage tab shows per-staff capture activity and topic gaps — which clinicians have been on camera recently and which subjects are underrepresented in what you have captured.',
      },
    ],
    notes: [
      {
        title: 'Consent first',
        body: 'Videos with a pending or revoked patient consent show a warning badge and cannot be clipped until the consent status is resolved. Resolve consent from the staff profile or the Media Library.',
      },
    ],
  },

  stories: {
    title: 'Stories — how it works',
    intro:
      'Stories is your working list of every piece of content in the practice — from a freshly captured interview to a published post. Filter it down to what you need, then open any card to push it to the next stage.',
    steps: [
      {
        icon: Filter,
        title: 'Filter down to what you need',
        body: 'The chip row narrows the list by staff, platform, stage, location, campaign, and more. "Mine only" limits the view to your own stories; "Real moments" filters to voice memos and seminar captures.',
      },
      {
        icon: Target,
        title: 'Follow a piece through its stages',
        body: 'Every story moves through Capture → Drafting → Review → Scheduled → Published. Use the Stage filter to focus on one step at a time, or watch the badge counts to see where work is piling up.',
      },
      {
        icon: CheckCircle2,
        title: 'Act on what is awaiting review',
        body: 'When stories are waiting on your approval, a chip at the top shows the count and links straight to the review queue — the fastest way to clear the bottleneck without paging through the full list.',
      },
      {
        icon: FileText,
        title: 'Open a story to work on it',
        body: 'Click any card to open the Storyboard, where you write posts, attach media, approve drafts, and schedule or publish. All the editing happens there, not on this list.',
      },
    ],
    notes: [
      {
        title: 'Need the clinic-wide pipeline view?',
        body: 'Stories is your personal working list. The clinic-wide Pipeline, Calendar, and Themes views — showing every story across all staff — live on the Overview page, which is accessible to owners and producers.',
      },
    ],
  },

  overview: {
    title: 'Overview — how it works',
    intro:
      'Overview is the clinic-wide content board for owners and producers. It shows every story in the practice — every staff member, every stage — across three lenses so you can spot bottlenecks, plan the publishing calendar, and find coverage gaps.',
    steps: [
      {
        icon: LayoutGrid,
        title: 'Pipeline view',
        body: 'Stories are grouped by stage: Capture, Drafting, Review, Scheduled, Published. This is the diagnostic lens — if Review has a dozen cards and Drafting has two, something is backed up at the approval step.',
      },
      {
        icon: Calendar,
        title: 'Calendar view',
        body: 'Stories are laid out by scheduled or published date. Use this to see the publication cadence, spot gaps in the week, and make sure the clinic is publishing consistently.',
      },
      {
        icon: Target,
        title: 'Themes view',
        body: 'Content is grouped by topic area, showing which subjects the practice covers regularly and which are underrepresented — useful for briefing the next round of interviews.',
      },
    ],
    notes: [
      {
        title: 'Owner and producer only',
        body: 'Overview is only accessible to owners, producers, and directors. Individual clinicians use Home and Stories to track their own work — Overview is the top-down management surface.',
      },
    ],
  },
}

export const HELP_PAGE_KEYS = Object.keys(HELP_CONTENT)
