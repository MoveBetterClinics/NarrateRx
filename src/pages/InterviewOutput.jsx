import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useUser, useAuth } from '@clerk/clerk-react'
import {
  ArrowLeft, Copy, Check, Instagram, Facebook, FileText, RefreshCw, Loader2,
  Globe, Video, Mail, Linkedin, Youtube, MapPin, Search, Layout, Smartphone, Pin, Share2, Pencil, Sparkles, Megaphone, Send, ExternalLink, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { fetchClinician, fetchInterview, fetchCampaign, updateInterview } from '@/lib/api'
import { fetchContentItemsByInterview, createContentItems, publishBlogToWebsite } from '@/lib/publish'
import { generateContent } from '@/lib/claude'
import { workspace } from '@/lib/workspace'
import {
  getSocialBatchSystemPrompt,
  getVideoScriptBatchSystemPrompt,
  getMarketingBatchSystemPrompt,
} from '@/lib/prompts'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { getCampaignPromptContext } from '@/lib/campaigns'
import { formatDate } from '@/lib/utils'

function parseSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker)
  if (start === -1) return ''
  const contentStart = start + startMarker.length
  const end = endMarker ? text.indexOf(endMarker, contentStart) : -1
  return (end === -1 ? text.slice(contentStart) : text.slice(contentStart, end)).trim()
}

export default function InterviewOutput() {
  const { clinicianId, interviewId } = useParams()
  const navigate = useNavigate()
  const { user } = useUser()
  const runtimeWorkspace = useWorkspace()
  const [clinician, setClinician] = useState(null)
  const [interview, setInterview] = useState(null)
  const [outputs, setOutputs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [itemMap, setItemMap] = useState({})
  const [generating, setGenerating] = useState(null) // 'social' | 'video' | 'marketing'
  const [genError, setGenError] = useState('')
  const [campaign, setCampaign] = useState(null)

  useEffect(() => {
    Promise.all([fetchClinician(clinicianId), fetchInterview(interviewId), fetchCampaign()])
      .then(([c, i, camp]) => {
        if (!c || !i || !i.outputs?.blogPost) { navigate('/'); return }
        setClinician(c)
        setInterview(i)
        setOutputs(i.outputs)
        setCampaign(camp)
        fetchContentItemsByInterview(interviewId)
          .then((items) => {
            const map = {}
            items.forEach((item) => { map[item.platform] = item.id })
            setItemMap(map)
          })
          .catch(() => {})
      })
      .catch(() => navigate('/'))
      .finally(() => setLoading(false))
  }, [clinicianId, interviewId, navigate])

  async function generateGroup(group) {
    if (!outputs?.blogPost) return
    setGenerating(group)
    setGenError('')
    try {
      const tone = interview.tone || 'smart'
      const voiceMode = interview.voice_mode || 'practice'
      const blogInput = [{ role: 'user', content: outputs.blogPost }]
      const campaignContext = getCampaignPromptContext(campaign)
      let updates = {}

      if (group === 'social') {
        const result = await generateContent(blogInput, getSocialBatchSystemPrompt(runtimeWorkspace, clinician.name, interview.topic, campaignContext, tone, voiceMode))
        updates = {
          instagram: parseSection(result, '---INSTAGRAM---', '---FACEBOOK---'),
          facebook: parseSection(result, '---FACEBOOK---', '---GBP POST---'),
          gbpPost: parseSection(result, '---GBP POST---', '---LINKEDIN---'),
          linkedin: parseSection(result, '---LINKEDIN---', '---PINTEREST---'),
          pinterest: parseSection(result, '---PINTEREST---', null),
        }
      } else if (group === 'video') {
        const result = await generateContent(blogInput, getVideoScriptBatchSystemPrompt(runtimeWorkspace, clinician.name, interview.topic, campaignContext, tone, voiceMode))
        updates = {
          youtubeScript: parseSection(result, '---YOUTUBE SCRIPT---', '---TIKTOK SCRIPT---'),
          tiktokScript: parseSection(result, '---TIKTOK SCRIPT---', null),
        }
      } else if (group === 'marketing') {
        const result = await generateContent(blogInput, getMarketingBatchSystemPrompt(runtimeWorkspace, clinician.name, interview.topic, campaignContext, tone))
        updates = {
          emailNewsletter: parseSection(result, '---EMAIL NEWSLETTER---', '---LANDING PAGE---'),
          landingPage: parseSection(result, '---LANDING PAGE---', '---GOOGLE ADS---'),
          googleAds: parseSection(result, '---GOOGLE ADS---', '---INSTAGRAM ADS---'),
          instagramAds: parseSection(result, '---INSTAGRAM ADS---', null),
        }
      }

      const newOutputs = { ...outputs, ...updates }
      setOutputs(newOutputs)
      if (user?.id) {
        await updateInterview(interviewId, { outputs: newOutputs }, user.id)
      }

      // Create content items in the database for each generated platform
      const platformsByGroup = {
        social: [
          { platform: 'instagram',    key: 'instagram' },
          { platform: 'facebook',     key: 'facebook' },
          { platform: 'gbp',          key: 'gbpPost' },
          { platform: 'linkedin',     key: 'linkedin' },
          { platform: 'pinterest',    key: 'pinterest' },
        ],
        video: [
          { platform: 'youtube',      key: 'youtubeScript' },
          { platform: 'tiktok',       key: 'tiktokScript' },
        ],
        marketing: [
          { platform: 'email',         key: 'emailNewsletter' },
          { platform: 'landing_page',  key: 'landingPage' },
          { platform: 'google_ads',    key: 'googleAds' },
          { platform: 'instagram_ads', key: 'instagramAds' },
        ],
      }
      const toCreate = (platformsByGroup[group] || [])
        .filter(({ platform, key }) => updates[key] && !itemMap[platform])
        .map(({ platform, key }) => ({
          interview_id: interviewId,
          clinician_id: clinicianId,
          clinician_name: clinician.name,
          topic: interview.topic,
          platform,
          content: updates[key],
          status: 'draft',
        }))
      if (toCreate.length > 0) {
        createContentItems(toCreate)
          .then((created) => {
            setItemMap((prev) => {
              const next = { ...prev }
              created.forEach((item) => { next[item.platform] = item.id })
              return next
            })
          })
          .catch(() => {})
      }
    } catch (err) {
      setGenError(err.message || 'Generation failed')
    } finally {
      setGenerating(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
      </div>
    )
  }

  if (!clinician || !interview || !outputs) return null

  const isPersonal = interview.voice_mode === 'personal'

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Interview Output</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Content generated from this interview, organized by platform. Copy what you need, or open a piece to edit and publish it.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/interview/${clinicianId}/${interviewId}`}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              View Interview
            </Link>
          </Button>
        </div>
        <div className="flex items-center gap-2 -ml-2">
          <Button variant="ghost" size="icon" asChild>
            <Link to={`/clinician/${clinicianId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="text-sm">
            <span className="font-medium">{interview.topic}</span>
            <span className="text-muted-foreground"> · {clinician.name} · Generated {formatDate(outputs.generatedAt)}</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="blog">
        <TabsList className={`grid w-full ${isPersonal ? 'grid-cols-3' : 'grid-cols-6'}`}>
          <TabsTrigger value="blog" className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" />
            Blog
          </TabsTrigger>
          <TabsTrigger value="social" className="gap-1.5 text-xs">
            <Share2 className="h-3.5 w-3.5" />
            Social
          </TabsTrigger>
          {!isPersonal && (
            <TabsTrigger value="instagram_ads" className="gap-1.5 text-xs">
              <Megaphone className="h-3.5 w-3.5" />
              IG Ads
            </TabsTrigger>
          )}
          {!isPersonal && (
            <TabsTrigger value="google" className="gap-1.5 text-xs">
              <Globe className="h-3.5 w-3.5" />
              Google
            </TabsTrigger>
          )}
          <TabsTrigger value="video" className="gap-1.5 text-xs">
            <Video className="h-3.5 w-3.5" />
            Video
          </TabsTrigger>
          {!isPersonal && (
            <TabsTrigger value="email" className="gap-1.5 text-xs">
              <Mail className="h-3.5 w-3.5" />
              Email
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Blog ── */}
        <TabsContent value="blog">
          <OutputCard
            title="Blog Post"
            subtitle="Markdown — paste into your CMS or blog editor"
            content={outputs.blogPost}
            badge="Markdown"
            editId={itemMap['blog']}
          />
          {workspace.capabilities?.websitePublish && outputs.blogPost && (
            <WebsitePublishPanel
              markdown={outputs.blogPost}
              fallbackTitle={interview.topic}
            />
          )}
        </TabsContent>

        {/* ── Social Media ── */}
        <TabsContent value="social">
          {outputs.instagram ? (
            <Tabs defaultValue="instagram">
              <TabsList className="grid w-full grid-cols-4 mt-1">
                <TabsTrigger value="instagram" className="gap-1.5 text-xs">
                  <Instagram className="h-3.5 w-3.5" />
                  Instagram
                </TabsTrigger>
                <TabsTrigger value="facebook" className="gap-1.5 text-xs">
                  <Facebook className="h-3.5 w-3.5" />
                  Facebook
                </TabsTrigger>
                <TabsTrigger value="linkedin" className="gap-1.5 text-xs">
                  <Linkedin className="h-3.5 w-3.5" />
                  LinkedIn
                </TabsTrigger>
                <TabsTrigger value="pinterest" className="gap-1.5 text-xs">
                  <Pin className="h-3.5 w-3.5" />
                  Pinterest
                </TabsTrigger>
              </TabsList>
              <TabsContent value="instagram">
                <OutputCard title="Instagram Caption" subtitle="Copy and paste into your Instagram post — no URLs in body, use bio link" content={outputs.instagram} badge="Instagram" editId={itemMap['instagram']} />
              </TabsContent>
              <TabsContent value="facebook">
                <OutputCard title="Facebook Post" subtitle="Copy and paste into your Facebook page — URL generates a rich link preview" content={outputs.facebook} badge="Facebook" editId={itemMap['facebook']} />
              </TabsContent>
              <TabsContent value="linkedin">
                <OutputCard title="LinkedIn Post" subtitle={`Post from the ${workspace.name} LinkedIn page`} content={outputs.linkedin} badge="LinkedIn" editId={itemMap['linkedin']} />
              </TabsContent>
              <TabsContent value="pinterest">
                <OutputCard title="Pinterest Pins" subtitle="3 pin variations — use with a vertical image linked to the blog post" content={outputs.pinterest} badge="Pinterest" editId={itemMap['pinterest']} />
              </TabsContent>
            </Tabs>
          ) : (
            <GeneratePrompt group="social" generating={generating} error={genError} onGenerate={generateGroup} label="Social Media" description="Instagram, Facebook, LinkedIn, Pinterest, and GBP post" />
          )}
        </TabsContent>

        {/* ── Instagram Ads ── */}
        {!isPersonal && (
          <TabsContent value="instagram_ads">
            {outputs.instagramAds ? (
              <OutputCard
                title="Instagram Ads Copy"
                subtitle="Meta Ads Manager creative — primary text, headline, description, CTA, destination URL"
                content={outputs.instagramAds}
                badge="Instagram Ads"
                editId={itemMap['instagram_ads']}
              />
            ) : (
              <GeneratePrompt group="marketing" generating={generating} error={genError} onGenerate={generateGroup} label="Instagram Ads" description="Meta Ads Manager creative — generated alongside GBP, Google Ads, landing page, and email" />
            )}
          </TabsContent>
        )}

        {/* ── Google ── */}
        {!isPersonal && (
        <TabsContent value="google">
          {outputs.googleAds ? (
            <Tabs defaultValue="gbp">
              <TabsList className="grid w-full grid-cols-3 mt-1">
                <TabsTrigger value="gbp" className="gap-1.5 text-xs">
                  <MapPin className="h-3.5 w-3.5" />
                  GBP Post
                </TabsTrigger>
                <TabsTrigger value="ads" className="gap-1.5 text-xs">
                  <Search className="h-3.5 w-3.5" />
                  Google Ads
                </TabsTrigger>
                <TabsTrigger value="landing" className="gap-1.5 text-xs">
                  <Layout className="h-3.5 w-3.5" />
                  Landing Page
                </TabsTrigger>
              </TabsList>
              <TabsContent value="gbp">
                <OutputCard title="Google Business Profile Post" subtitle="Post directly to your GBP — appears in Maps and Search results" content={outputs.gbpPost} badge="GBP" editId={itemMap['gbp']} />
              </TabsContent>
              <TabsContent value="ads">
                <OutputCard title="Google Search Ad Copy" subtitle="Responsive Search Ad — 15 headlines, 4 descriptions, extensions" content={outputs.googleAds} badge="Google Ads" editId={itemMap['google_ads']} />
              </TabsContent>
              <TabsContent value="landing">
                <OutputCard title="Landing Page Copy" subtitle="Conversion-focused page copy — includes SEO title tag and meta description" content={outputs.landingPage} badge="Landing Page" editId={itemMap['landing_page']} />
              </TabsContent>
            </Tabs>
          ) : (
            <GeneratePrompt group="marketing" generating={generating} error={genError} onGenerate={generateGroup} label="Google & Marketing" description="GBP post, Google Ads, Instagram Ads, and landing page copy" />
          )}
        </TabsContent>
        )}

        {/* ── Video ── */}
        <TabsContent value="video">
          {outputs.youtubeScript ? (
            <Tabs defaultValue="youtube">
              <TabsList className="grid w-full grid-cols-2 mt-1">
                <TabsTrigger value="youtube" className="gap-1.5 text-xs">
                  <Youtube className="h-3.5 w-3.5" />
                  YouTube Script
                </TabsTrigger>
                <TabsTrigger value="tiktok" className="gap-1.5 text-xs">
                  <Smartphone className="h-3.5 w-3.5" />
                  TikTok / Reels
                </TabsTrigger>
              </TabsList>
              <TabsContent value="youtube">
                <OutputCard title="YouTube Video Script" subtitle="5–8 minute script with B-roll cues, patient story, and video description" content={outputs.youtubeScript} badge="YouTube" editId={itemMap['youtube']} />
              </TabsContent>
              <TabsContent value="tiktok">
                <OutputCard title="TikTok / Reels Script" subtitle="45–60 second vertical video script with on-screen text cues and caption" content={outputs.tiktokScript} badge="TikTok / Reels" editId={itemMap['tiktok']} />
              </TabsContent>
            </Tabs>
          ) : (
            <GeneratePrompt group="video" generating={generating} error={genError} onGenerate={generateGroup} label="Video Scripts" description="YouTube (5–8 min) and TikTok/Reels (45–60 sec) scripts" />
          )}
        </TabsContent>

        {/* ── Email ── */}
        {!isPersonal && (
          <TabsContent value="email">
            {outputs.emailNewsletter ? (
              <OutputCard
                title="Email Newsletter"
                subtitle="GoHighLevel-ready — subject lines, preview text, and body copy included"
                content={outputs.emailNewsletter}
                badge="Newsletter"
                editId={itemMap['email']}
              />
            ) : (
              <GeneratePrompt group="marketing" generating={generating} error={genError} onGenerate={generateGroup} label="Email Newsletter" description="Subject lines, preview text, and full newsletter body" />
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

function GeneratePrompt({ group, generating, error, onGenerate, label, description }) {
  const isGenerating = generating === group

  return (
    <div className="rounded-xl border bg-muted/30 p-10 text-center space-y-4 mt-2">
      {isGenerating ? (
        <>
          <Loader2 className="h-6 w-6 text-primary animate-spin mx-auto" />
          <p className="text-sm font-medium">Generating {label}…</p>
          <p className="text-xs text-muted-foreground">This takes about 15–30 seconds.</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-muted-foreground">{label} not generated yet</p>
          <p className="text-xs text-muted-foreground">{description}</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button size="sm" onClick={() => onGenerate(group)}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Generate {label}
          </Button>
        </>
      )}
    </div>
  )
}

function OutputCard({ title, subtitle, content, badge, editId }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(content || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!content) {
    return (
      <div className="rounded-xl border bg-muted/30 p-10 text-center space-y-2 mt-2">
        <p className="text-sm font-medium text-muted-foreground">Not generated yet</p>
        <p className="text-xs text-muted-foreground">
          This format is available on newly generated interviews. Return to the interview and click Generate to create all formats.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden mt-2">
      <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
        <div>
          <p className="font-medium text-sm">{title}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">{badge}</Badge>
          <Button size="sm" variant="outline" onClick={handleCopy}>
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 mr-1.5 text-green-600" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Copy
              </>
            )}
          </Button>
          {editId && (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/review/${editId}`}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Link>
            </Button>
          )}
        </div>
      </div>
      <ScrollArea className="h-[480px]">
        <pre className="p-5 text-sm leading-relaxed font-mono whitespace-pre-wrap text-foreground">
          {content}
        </pre>
      </ScrollArea>
    </div>
  )
}

// Strips an opening H1 from markdown and returns { title, body }. The website
// generates its own <h1> from the frontmatter title — leaving the H1 in the
// body would render twice.
function splitH1(md) {
  const lines = (md || '').split('\n')
  let title = ''
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (i < lines.length && /^#\s+/.test(lines[i])) {
    title = lines[i].replace(/^#\s+/, '').trim()
    lines.splice(0, i + 1)
    while (lines.length && !lines[0].trim()) lines.shift()
  }
  return { title, body: lines.join('\n').trim() }
}

function deriveDescription(body) {
  const para = (body || '').split(/\n\s*\n/).find((b) => b.trim() && !b.trim().startsWith('#'))
  if (!para) return ''
  const flat = para.replace(/\s+/g, ' ').replace(/[*_`[\]()]/g, '').trim()
  return flat.length > 280 ? flat.slice(0, 277).replace(/\s+\S*$/, '') + '…' : flat
}

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '')
}

function todayIso() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function WebsitePublishPanel({ markdown, fallbackTitle }) {
  const ws = useWorkspace()
  const { getToken } = useAuth()
  const { title: h1Title, body: bodyWithoutH1 } = useMemo(() => splitH1(markdown), [markdown])
  const defaultTitle = h1Title || fallbackTitle || ''
  const defaultDescription = useMemo(() => deriveDescription(bodyWithoutH1), [bodyWithoutH1])

  const [title, setTitle]                 = useState(defaultTitle)
  const [slug, setSlug]                   = useState(slugify(defaultTitle))
  const [slugEdited, setSlugEdited]       = useState(false)
  const [description, setDescription]     = useState(defaultDescription)
  const [heroImage, setHeroImage]         = useState('')
  const [heroImageAlt, setHeroImageAlt]   = useState('')
  const [tagsInput, setTagsInput]         = useState('')
  const [draft, setDraft]                 = useState(false)
  const [pubDate, setPubDate]             = useState(todayIso())

  // Per-workspace topic list (kebab-case slugs). When non-empty the
  // panel renders a dropdown + "add new topic" affordance; the picked
  // slug is forwarded as `topic` in the publish payload. Empty list →
  // no UI, receiver falls back to its own default ("general" on
  // movebetter.co; ignored by movebetteranimal).
  const initialTopics = Array.isArray(ws?.publish_topics) ? ws.publish_topics : []
  const [topics, setTopics]               = useState(initialTopics)
  const [topic, setTopic]                 = useState('')
  const [newTopicInput, setNewTopicInput] = useState('')
  const [addingTopic, setAddingTopic]     = useState(false)
  const [topicError, setTopicError]       = useState(null)
  useEffect(() => {
    setTopics(Array.isArray(ws?.publish_topics) ? ws.publish_topics : [])
  }, [ws?.publish_topics])

  async function handleAddTopic() {
    const slug = slugify(newTopicInput)
    setTopicError(null)
    if (!slug) {
      setTopicError('Type a topic name first.')
      return
    }
    if (topics.includes(slug)) {
      setTopic(slug)
      setNewTopicInput('')
      return
    }
    const next = [...topics, slug]
    setAddingTopic(true)
    try {
      const token = await getToken()
      const r = await fetch('/api/workspace/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ publish_topics: next }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setTopicError(j.error === 'forbidden' ? 'Admins only — ask an admin to add new topics.' : `Couldn't save topic (${r.status}).`)
        return
      }
      const updated = await r.json().catch(() => ({}))
      const saved = Array.isArray(updated.publish_topics) ? updated.publish_topics : next
      setTopics(saved)
      setTopic(slug)
      setNewTopicInput('')
    } catch {
      setTopicError('Network error saving topic.')
    } finally {
      setAddingTopic(false)
    }
  }

  const [status, setStatus] = useState('idle') // 'idle' | 'publishing' | 'success' | 'error'
  const [result, setResult] = useState(null)   // { postUrl, commitUrl, slug } on success
  const [error, setError]   = useState(null)   // { code, message } on error

  function handleTitleChange(next) {
    setTitle(next)
    if (!slugEdited) setSlug(slugify(next))
  }

  function handleSlugChange(next) {
    setSlug(slugify(next))
    setSlugEdited(true)
    if (error?.code === 'slug_taken') setError(null)
  }

  async function handlePublish() {
    setStatus('publishing')
    setError(null)
    setResult(null)

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)

    try {
      const res = await publishBlogToWebsite({
        slug,
        title,
        description,
        pubDate,
        markdown: bodyWithoutH1 || markdown,
        tags,
        draft,
        heroImage:    heroImage.trim()    || undefined,
        heroImageAlt: heroImageAlt.trim() || undefined,
        topic:        topic                || undefined,
      })
      setResult(res)
      setStatus('success')
    } catch (e) {
      setError({ code: e.code, message: e.message })
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-5 mt-3 space-y-3">
        <div className="flex items-start gap-3">
          <Check className="h-5 w-5 text-green-700 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium text-sm text-green-900">Published to {workspace.websiteHostname}</p>
            <p className="text-xs text-green-800">
              The post is live (or queued as a draft if you ticked the box). The link below opens it on the website.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pl-8">
          <Button size="sm" variant="outline" asChild>
            <a href={result.postUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              View post
            </a>
          </Button>
          {result.commitUrl && (
            <Button size="sm" variant="outline" asChild>
              <a href={result.commitUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                View commit
              </a>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setStatus('idle')}>
            Publish another
          </Button>
        </div>
      </div>
    )
  }

  const slugTaken = error?.code === 'slug_taken'
  const isPublishing = status === 'publishing'

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden mt-3">
      <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
        <div>
          <p className="font-medium text-sm flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Publish to {workspace.websiteHostname}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sends the post to the marketing site. Live in seconds (or saved as a draft if you tick the box).
          </p>
        </div>
        <Badge variant="outline" className="text-xs capitalize">{workspace.id}</Badge>
      </div>

      <div className="p-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="publish-title" className="text-xs">Title</Label>
          <Input
            id="publish-title"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            disabled={isPublishing}
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="publish-slug" className="text-xs">
            Slug
            <span className="ml-1.5 text-muted-foreground font-normal">/blog/{slug || '…'}</span>
          </Label>
          <Input
            id="publish-slug"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            disabled={isPublishing}
            maxLength={120}
            className={slugTaken ? 'border-destructive focus-visible:ring-destructive' : ''}
          />
          {slugTaken && (
            <p className="text-xs text-destructive flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              That slug is already used on the website. Rename it and try again — the website never overwrites.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="publish-description" className="text-xs">Description</Label>
          <Textarea
            id="publish-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isPublishing}
            rows={2}
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground">{description.length}/500 — used on the blog index, meta description, and social previews.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="publish-hero-image" className="text-xs">
            Featured image URL <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="publish-hero-image"
            type="url"
            value={heroImage}
            onChange={(e) => setHeroImage(e.target.value)}
            disabled={isPublishing}
            placeholder="https://…/photo.jpg"
          />
          {heroImage.trim() && (
            <Input
              id="publish-hero-image-alt"
              value={heroImageAlt}
              onChange={(e) => setHeroImageAlt(e.target.value)}
              disabled={isPublishing}
              placeholder="Alt text — describe the image for screen readers and SEO"
              maxLength={250}
              className="mt-1.5"
            />
          )}
        </div>

        {topics.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="publish-topic" className="text-xs">
              Topic <span className="text-muted-foreground font-normal">(controls the filter chip on the website)</span>
            </Label>
            <div className="flex gap-2">
              <select
                id="publish-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={isPublishing}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Auto-categorize (general)</option>
                {topics.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 items-center pt-1">
              <Input
                value={newTopicInput}
                onChange={(e) => { setNewTopicInput(e.target.value); if (topicError) setTopicError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTopic() } }}
                disabled={isPublishing || addingTopic}
                placeholder="Add a new topic (e.g. running-form)"
                maxLength={60}
                className="text-xs h-8"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleAddTopic}
                disabled={isPublishing || addingTopic || !newTopicInput.trim()}
                className="shrink-0"
              >
                {addingTopic ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
              </Button>
            </div>
            {topicError && (
              <p className="text-xs text-destructive flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {topicError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              New topics become filter chips on the website automatically. Leave blank to file under <code>general</code>.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="publish-pubdate" className="text-xs">Publish date</Label>
            <Input
              id="publish-pubdate"
              type="date"
              value={pubDate}
              onChange={(e) => setPubDate(e.target.value)}
              disabled={isPublishing}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="publish-tags" className="text-xs">Tags <span className="text-muted-foreground font-normal">(optional, comma-separated)</span></Label>
            <Input
              id="publish-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              disabled={isPublishing}
              placeholder="dogs, senior-pets, education"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
          <input
            type="checkbox"
            checked={draft}
            onChange={(e) => setDraft(e.target.checked)}
            disabled={isPublishing}
            className="h-3.5 w-3.5"
          />
          Save as draft (the post is created but hidden from the public site until you publish it from the website's admin)
        </label>

        {error && !slugTaken && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{error.code || 'error'}</p>
              <p className="mt-0.5">{error.message}</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button onClick={handlePublish} disabled={isPublishing || !title.trim() || !slug.trim() || !description.trim()}>
            {isPublishing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Publishing…
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Publish to website
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
