import {
  FileText, Send, CheckCircle2, Sparkles, ListChecks, ShieldAlert,
  BarChart3, Clapperboard, Filter, LayoutGrid, Target, Calendar,
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
      'Home is your starting point. It shows where you left off, what is ready for you to act on, and the fastest way to start something new. Think of it as the front desk: it points you to the right room rather than holding the work itself.',
    steps: [
      {
        icon: Send,
        title: 'Start an interview',
        body: 'The main button up top kicks off a new interview — the conversation that turns what you know into finished posts. Everything downstream begins here.',
      },
      {
        icon: FileText,
        title: 'Pick up drafts that are ready',
        body: 'When the system has turned an interview into draft posts, they surface here so you can review and approve them without hunting through the Stories page.',
      },
      {
        icon: CheckCircle2,
        title: 'Clear your to-do buckets',
        body: 'Cards group the things waiting on you — drafts to review, pieces ready to send out, interviews you started but did not finish. Each card links straight to where you finish that task.',
      },
      {
        icon: Sparkles,
        title: 'Resume or plan what is next',
        body: 'If you left an interview half-finished, a strip lets you jump back in. Suggested topics give you a running start when you are not sure what to talk about next.',
      },
    ],
    notes: [
      {
        title: 'Where the work actually lives',
        body: 'Home links out; it does not store. Drafts and finished posts live on the Stories page, raw clips live in the Media Hub, and account settings live under Settings. Home is just the shortest path to each.',
      },
    ],
  },

  slate: {
    title: 'Story Slate — how it works',
    intro:
      'The Slate is the daily planning board for what your practice could publish. Each morning the system proposes a handful of ready-to-build story packages — a topic, a suggested clinician, and a draft angle — so you decide what to make instead of starting from a blank page.',
    steps: [
      {
        icon: Clapperboard,
        title: "Review today's Slate",
        body: 'The main tab shows the packages proposed for today. Each card is a story idea the system thinks is worth building, with enough detail to judge it at a glance.',
      },
      {
        icon: Sparkles,
        title: 'Generate more when you want them',
        body: 'If the day is light or you want a different angle, generate additional packages on demand. The system aims for about four strong packages a day, but you are never capped.',
      },
      {
        icon: ListChecks,
        title: 'Send strong packages forward',
        body: 'Approve a package and it moves into the content pipeline as a draft on the Stories page. Reject the ones that do not fit — rejecting teaches the system what your practice does and does not publish.',
      },
      {
        icon: ShieldAlert,
        title: 'Handle the Triage and Consent queues',
        body: 'Triage collects packages the system is unsure about or that have gone stale, so nothing falls through the cracks. Consent collects anything featuring a patient that needs a consent decision before it can go public.',
      },
      {
        icon: BarChart3,
        title: 'Check Coverage for gaps',
        body: 'The Coverage tab shows which clinicians and which topics you have been capturing — and where the gaps are — so your published mix reflects the whole practice, not just whoever is most camera-ready.',
      },
    ],
    notes: [
      {
        title: 'New to the Slate?',
        body: 'If you produce content for the practice, use "Take the tour" in the header for a guided walk-through. This Help panel is the quick reference you can come back to any time.',
      },
    ],
  },

  stories: {
    title: 'Stories — how it works',
    intro:
      'Stories is the home for every piece of content in your practice — from a freshly captured interview to a published post. It is the master list. Everything you start eventually shows up here so you can find it, track its stage, and finish it.',
    steps: [
      {
        icon: LayoutGrid,
        title: 'Switch how you view the work',
        body: 'Use the view toggle to see your content as cards, as a pipeline (grouped by stage), on a calendar, or grouped by theme. Same content, different lens — pick whichever matches the question you are asking.',
      },
      {
        icon: Filter,
        title: 'Filter down to what you need',
        body: 'The chip row narrows the list by clinician, platform, stage, and more. "Mine only" limits it to your own stories so you are not wading through the whole practice.',
      },
      {
        icon: Target,
        title: 'Follow a piece through its stages',
        body: 'Every story moves through Capture → Drafting → Review → Scheduled → Published. The badges and pipeline view show you exactly where each one sits and what it is waiting on.',
      },
      {
        icon: Calendar,
        title: 'Open a story to finish it',
        body: 'Click any card to open its detail, where you review the draft, edit the copy, attach media, and approve it for sending. The "awaiting review" badge up top tells you how many need your eyes right now.',
      },
    ],
    notes: [
      {
        title: 'Interviews and posts together',
        body: 'A "story" can be an interview that is still becoming posts, or a finished post ready to publish. They share this page on purpose — the whole arc from raw conversation to published piece lives in one list.',
      },
    ],
  },
}

export const HELP_PAGE_KEYS = Object.keys(HELP_CONTENT)
