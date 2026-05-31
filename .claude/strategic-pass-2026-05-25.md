# NarrateRx — Outside-in strategic pass, 2026-05-25

_Re-run of the 2026-05-22 outside-bias review against current state. The 2026-05-24 doc settled near-term direction (C→E); this is the broader landscape refresh: JTBD, verticals, tech, competitors, product shapes. Use as the reference for the next strategic conversation, not for next-week priorities._

---

## 1. State delta since 2026-05-22 (what ground has actually moved)

The original review imagined Phase 5 as 8 weeks of work. It shipped in ~12 days. The product is materially different from what the May 22 doc was reviewing:

**Now in `main` and used:**
- Live Interview (real-time duplex, OpenAI Realtime) — F#1 done; polish chip parked
- Practice memory — hot tier (#789/#794/#796) + RAG layer (#803/#804/#806)
- Voice clone — schema + ElevenLabs IVC + read-aloud preview on content pieces
- URL import lane — Jina-Reader-backed `text_import` (#770/#787/#791)
- Onboarding interview — voice-based wizard writes brand_voice / patient_context / topic_suggestions / voice phrases
- Stripe billing — wired in product, internal workspaces exempt (PRs #839/#851/#853, test-mode keys)
- Workspace Book — auto-synthesized long-form manuscript per workspace, daily cron regen
- Per-tenant onboarding wizard at `/onboard`, three live workspaces, multi-tenant infra hardened

**Still shelved by principle:**
- Patient handouts (`patient_handouts_enabled=false`) — closed as a category
- Outcome case studies — closed as a category
- General-mode interview — deferred (clinical-only v1)

**Implication:** the moat the May 22 doc *projected* (voice fidelity + workflow lock-in + practice memory) is now *in users' hands*. The strategic question is no longer "should we build this" — it's "given this is built, what's the next mountain?"

---

## 2. JTBD reframe — does it still hold?

The original framing:

> "I have valuable expertise stuck in my head. Writing it down is slow and the result doesn't sound like me. I need to be present digitally without spending evenings becoming a content marketer."

**Holds, but the bottleneck has shifted.** Three months ago the bottleneck was *production* — clinician's voice didn't make it into text. Now production is solved (15 days > 10 prior years of output, per [[narraterx-already-paying]]). The remaining bottlenecks, in user-felt order:

1. **Distribution** — content exists but the right people don't see it. Buffer push works mechanically; reach is what's missing.
2. **Trust signal** — readers/patients need to feel "this is really her" not "this is AI." Voice clone helps. Authentic moments help more.
3. **Compounding** — each new piece should make the next one easier, the practice memory richer, the discovery footprint denser. Book + RAG move this needle but the user-felt loop isn't visible yet.
4. **Conversion** — content → consult → patient. NarrateRx today doesn't touch this; it stops at "published."

The new JTBD-shaped sentence:

> "I have a voice now. I need it to find the right people, prove it's mine, and convert curiosity into a first visit — without me doing the marketing work."

That's a meaningful reframe. It maps to **distribution + trust + funnel completion**, not more content production.

---

## 3. Adjacent vertical map — refreshed

The original list still applies; what changed is the **fit math** now that the product is real:

| Vertical | Job match | Tech-fit blockers in 2026-05 | Notes |
|---|---|---|---|
| Hands-on + integrative clinical (chiro/PT/OT/ND/massage/acu) | Native | None — current core | The committed v1 audience |
| Dentists / orthodontists / optometrists / audiologists | High | None — current prompt mode flag covers it | Closest 1-step adjacency; would still need clinical-mode prompt tuning |
| Veterinary | High | Animals workspace already exists as paradigm | Lowest-friction expansion if Move Better Animal proves it |
| Mental health (LCSW, psychologists) | High | Consent dynamics + ad rules sharper | Need a compliance pass before pitching |
| Solo lawyers (immigration, family, estate) | High | Bar ethics ad rules vary by state; no clinical-mode equivalent today | Biggest single broadening lift; would need a "legal mode" parallel to clinical |
| Financial advisors / RIAs | Medium | FINRA/SEC content review = killer | Disclosure workflow + supervisor approval is a hard add |
| Coaches (exec/health/niche) | Medium | None regulatory; lots of competition | Biggest TAM, lowest defensibility |
| Trades / artisans | Low-medium | Capture mode mismatch — they don't sit for interviews | Voice memo lane fits better than interview |
| Faith / yoga / Pilates | Low-medium | Buyer = self, low willingness-to-pay | TAM exists but unit economics weak |

**The vertical landscape itself didn't change. What changed is that "adjacent clinical" is now a 1-PR pivot (flip a prompt mode flag, swap a few defaults) rather than a 6-week build.** Vet was already proven as a paradigm via Move Better Animal. Dental / optometry / audiology would behave the same.

The argument *for* staying narrow is unchanged: regulatory pack + referral pipeline + tacit-reasoning style. The argument *against* is now weaker — broadening costs much less than it did in March.

---

## 4. Tech landscape sweep — refreshed for 2026-05

What's available now, what NarrateRx already uses, what's worth a second look.

### Voice & speech

| Capability | State of the art (2026-05) | NarrateRx position |
|---|---|---|
| Real-time duplex voice | OpenAI Realtime (gpt-realtime), Claude Voice, Hume EVI 2 | **Shipped** (Live Interview) |
| Voice cloning | ElevenLabs v3 IVC, Cartesia Sonic-2, Suno Bark v2 | **Shipped** (ElevenLabs IVC, read-aloud preview) |
| Emotion-aware TTS | Hume Octave 2, ElevenLabs v3 with emotion tokens | Not used — could enrich read-aloud preview |
| Whisper-level STT | Whisper Large v3 turbo, Deepgram Nova-3, AssemblyAI Universal-2 | Whisper via Realtime; turn-based path uses Web Speech |
| NotebookLM-style auto-podcast | Google NotebookLM, ElevenLabs Studio | **Not used** — book + practice memory is the substrate; a "weekly digest podcast in your voice" is plausible and cheap |

### Long-context & memory

| Capability | State of the art | NarrateRx position |
|---|---|---|
| 2M+ token context | Gemini 2.5 Pro, Claude batch context | Not needed — practice memory + RAG covers it more cheaply |
| Persistent agent memory | Claude memory tool, OpenAI assistants v2 | **Shipped equivalent** (practice memory hot tier + pgvector RAG) |
| Workspace-scoped knowledge graph | Cole Medin's mem0, Letta, Zep | Not used; current architecture is purpose-built |

### Multimodal in/out

| Capability | State of the art | NarrateRx position |
|---|---|---|
| Image generation, on-brand | Ideogram 3, GPT-Image-1, FLUX 1.1 Pro, Recraft v3 | Canvas overlay only — [[image-overlay-strategy]] says defer until engagement complaints surface |
| Text-to-video | Sora 2, Veo 3, Runway Gen-4, Kling 2 | Not used |
| Lip-synced talking-head | HeyGen, Synthesia, D-ID, Hedra | Not used; voice clone covers the "feels like me" job without a face video |
| Video understanding | Gemini 2.5, GPT-4o vision, Claude vision | Used for thumbnails/tagging; not for content generation |

### Agents & automation

| Capability | State of the art | NarrateRx position |
|---|---|---|
| Computer-use agents | Claude Computer Use, OpenAI Operator | Not used; first-party API integrations preferred |
| MCP servers in clinical | Still sparse — Jane App / SimplePractice not published as MCP | Strategic watch item; EHR MCP would unlock outcome data |
| Durable workflows | Vercel AI SDK v6 workflows (GA), Inngest, Trigger.dev | Not used; current `waitUntil` pattern is sufficient |
| AI Gateway / model routing | **Vercel AI Gateway (GA Aug 2025)** | Not used — direct Anthropic + OpenAI keys. Worth migrating for fallback + observability if multi-provider matters |

### Distribution / discovery

| Capability | State of the art | NarrateRx position |
|---|---|---|
| AI-SEO content optimization | Surfer SEO, Frase, Rankability, NeuronWriter | Not used — voice fidelity prioritized over SEO discipline |
| Long-tail intro variants per query (AI-SEO at edge) | Vercel Edge Config + AI SDK | Not used; plausible Phase 6+ |
| Per-reader personalization (referrer/geo) | Mutiny, Intellimize, native Vercel | Not used |
| Schema markup / structured data | Schema App, AI-friendly LLM.txt files | Partial — not deliberate; worth a one-day pass |
| Local SEO / GBP for clinicians | Birdeye, Podium, Whitespark | Not used; GBP push is one-way (we publish, they don't ingest) |

### New output formats worth considering

- **Slide decks from interview** (Gamma, Beautiful.ai, Tome have APIs) — clinician already has the substrate; a "talk deck" output is cheap
- **Audio drive-time briefs** — voice clone + book = weekly "what I'm thinking this week" podcast in clinician's voice
- **Email newsletter** (already shipped) but with per-subscriber personalization (which topic seeds resonate)
- **Conversational Q&A on the practice website** — voice clone + RAG = "ask Michael" widget that answers in his voice from his real prior thinking

### Privacy / on-device

| Capability | State of the art | NarrateRx position |
|---|---|---|
| Apple Intelligence + MLX on-device | iOS 18.4+, MacBook M-series | Not relevant — clinical content isn't PHI in NarrateRx's flow |
| Whisper.cpp on iPhone | Mature | Not relevant |
| FHE primitives | ZAMA early; not production | Watch only |

**Verdict on tech sweep:** the gap between SOTA and NarrateRx narrowed sharply. The remaining unused capabilities cluster in three buckets: (a) distribution/discovery, (b) face-video, (c) on-device privacy. Bucket (a) maps to the new JTBD bottleneck.

---

## 5. Competitor scan (new — original review didn't do this explicitly)

Five layers, ranked by directness of overlap.

### Layer 1 — direct "interview-to-content for experts" (closest)

| Competitor | What they do | Overlap with NarrateRx | Threat level |
|---|---|---|---|
| **Castmagic** | Upload podcast/interview → atoms (blog, social, show notes) | Atom batch lane | **Real but bounded** — they don't capture voice fidelity, no practice memory, no clinical context. Generic. |
| **Riverside Magic Clips / Opus Clip / Submagic** | Long-form video → short clips with captions | Video atom lane (not yet shipped on NarrateRx) | Adjacent — solves a job NarrateRx doesn't yet |
| **Descript Underlord** | Transcript edit + AI rewrite + voice clone | Voice clone + content polish | Real — but workflow-heavy, podcast-shaped, not clinician-shaped |
| **Otter Take Notes** | Meeting → summary + action items | None directly | Different job (notes, not publishing) |

### Layer 2 — AI writing tools, vertical-agnostic

| Competitor | What they do | Overlap | Threat |
|---|---|---|---|
| Jasper, Copy.ai, Writer.com, Rytr | "AI writes marketing copy" | Generic content generation | **Low for committed users, high for not-yet-users** — the on-ramp competition. Clinicians evaluating NarrateRx will have tried one of these and found the voice generic. |
| Claude/ChatGPT custom projects | DIY "my voice" project with uploaded samples | The entire product, basically, with manual setup | **Real DIY threat** — a motivated clinician with 2 hours and Claude Pro can approximate a worse version of NarrateRx. Defensibility = workflow + memory + automation, not the model |

### Layer 3 — clinical marketing services (different shape, same buyer)

| Competitor | What they do | Overlap | Threat |
|---|---|---|---|
| **PatientPop (Tebra)** | Agency-style website + reputation + content + paid ads | "Content for clinicians" surface only | **Low product overlap, high mindshare** — the default thing a clinician searches when they decide "I need marketing help." Different category (services + bundle); NarrateRx is voice-first software |
| **Doctor Multimedia / MD Connect / PracticeBeat** | Agency content production for clinics | Content surface | Same as above — agency model, monthly retainer, generic copy |
| **PatientGain / RepuGen** | Reputation + reviews | None | Adjacent (review request flow could integrate) |
| **Curogram / Solutionreach** | Patient communications | None | Different category |

### Layer 4 — practice management with content extensions

| Competitor | What they do | Overlap | Threat |
|---|---|---|---|
| **Jane App** | Practice management (booking, charting, billing) | None today, but if they ship an AI content add-on with EHR data, they have the chart-note moat NarrateRx lacks | **Watch closely** — biggest strategic threat over 12+ months |
| **SimplePractice, Heno, Practice Fusion** | Same | Same | Same |
| **DrChrono, Athena** | EHR | Same | Same |

### Layer 5 — creator tooling (different buyer, similar workflow)

| Competitor | What they do | Overlap | Threat |
|---|---|---|---|
| **Substack, Beehiiv, ConvertKit** | Newsletter publishing | Distribution layer NarrateRx pushes to (or could) | Not competitive — they're rails; NarrateRx could integrate |
| **Buffer, Hootsuite, Later, ContentStudio** | Social scheduling | Distribution layer NarrateRx already uses (Buffer) | Not competitive — they're rails |
| **HeyGen, Synthesia** | Talking-head video | Video output not yet built | Adjacent |

### Competitive verdict

- **No one is doing "voice-first content automation for the integrative-clinical vertical."** The vertical-specific niche remains uncontested. That's the defensible position.
- **The closest direct functional overlap (Castmagic, Descript) is podcast-shaped, not interview-shaped, and not vertical-tuned.** Their atoms are generic.
- **The biggest real threats are not other products — they're (a) clinicians DIY-ing in Claude/ChatGPT projects, and (b) Jane App or a peer shipping an AI content extension that's "good enough + already in my workflow."**
- **The biggest perception threat is PatientPop / agencies** — they own the "I need marketing help" search intent for clinicians. NarrateRx has to convert that intent, not capture it from a cold start.

The 2026-05-22 review concluded the moat was workflow lock-in + voice fidelity + practice memory. **Updated:** the moat is workflow lock-in + voice fidelity + practice memory **+ vertical-specific compliance/tone fluency**. The fourth term matters because that's what blocks Jane App's hypothetical move (their content would be EHR-flavored, not relationship-flavored).

---

## 6. Three coherent product shapes — recast

The May 22 shapes were "what to build." With the moat stack now built, the question is "what to do with it."

**A. Vertical-deepen (refined Shape B).** Stay narrow-clinical. Spend the next 2 quarters on (i) clinical compliance polish per modality (chiro vs PT vs naturopath), (ii) EHR MCP integration if/when Jane publishes, (iii) the "ask Michael" embedded widget that turns content into a referral conversation. Ship trust + conversion features, not more production features.

**B. Distribution-layer (new — not in May 22).** Accept that production is solved and the next mountain is reach. Build (i) AI-SEO discipline into the content engine, (ii) per-subscriber newsletter personalization, (iii) clinician-discovery features (a directory or syndication network for hands-on/integrative providers), (iv) measurable funnel tracking back to first visit. This is the "marketing operating system" pivot — same vertical, different layer.

**C. Engine-out white-label (unchanged from May 22).** Clinical brand-facing externally; expose engine to one adjacent vertical (dental, vet, mental health) under a separate brand. Test broadening without abandoning narrow.

**D. Productize the dogfood story.** Move Better itself is now a case study of "what NarrateRx output looks like in 12 months of practice." Package the case study, the methodology, the Move Better Book + content history into a structured sales asset. This is mostly a marketing/positioning project, not a build.

### How these stack with the 2026-05-24 direction

The May 24 doc committed to **C (promote + harden) → E (first paying chiro friend)** through ~June 21. That's compatible with **any of A/B/C/D** as the next-mountain choice afterward.

The real strategic fork is **A vs. B** — vertical-deepen vs. distribution-layer. A is the bet that workflow + voice + compliance is enough moat to defend; B is the bet that without distribution, the moat doesn't matter because users never see the output. Both are defensible. Picking is the next strategic question after the chiro-friend test lands.

**My read:** B (distribution) is the underbuilt half of the value chain right now. The product produces; nothing in NarrateRx amplifies. That's a real gap. But B is also the half where the user has the least energy (per May 24 ranking: "Building > clinic > users"). Tension to resolve at the June 21 re-decide.

---

## 7. Pressure-tests worth revisiting

1. **"The interview is increasingly redundant" (May 22 #1)** — *partially confirmed.* URL import lane proved you can keystone an existing post without a fresh interview. But Live Interview also showed the conversational texture is what most clinicians actually enjoy doing. The interview isn't redundant; it's a *modality choice* among 3 (live voice / turn-based / URL import / soon: ambient capture).
2. **"2026 moat isn't AI content — it's voice fidelity + workflow lock-in + data/outcomes"** — *confirmed.* The data/outcomes leg is still empty (no EHR integration, no engagement attribution back to content). That's the open moat surface.
3. **"Honor the clinician as individual" prevents broadening** — *still true, but cheaper to bend.* Onboarding wizard + paradigm-default JSONB means a new vertical is days of work, not weeks. The principle still holds; the cost of relaxing it dropped.
4. **"Move Better is a clinic, not a clinician — workspace-shaped"** — *less true than it was.* Per-clinician identity + per-clinician voice phrases + per-clinician practice memory all shipped. Move Better-the-clinic is more clinician-aggregated than clinic-monolithic now.
5. **"Buy before build — moat must live in workflow"** — *confirmed.* The unused-but-available tech (AI-SEO, lip-sync video, MCP) shows there's still plenty to "buy" before building. The remaining build surface is integration + workflow polish, not model-layer.
6. **NEW: "Distribution is the next bottleneck, not production"** — likely true. Worth a 1-week probe (Layer 5 analytics: what % of Move Better's published content gets > X views, by channel) before committing to Shape B.
7. **NEW: "DIY-in-Claude is the real competitive floor"** — partially true. A solo motivated clinician can approximate it. NarrateRx's defense is amortization (the 11 features they'd have to re-invent + the ongoing maintenance). Worth being explicit about that in marketing copy.

---

## 8. What this doc is NOT

- Not a replacement for the 2026-05-24 direction-setting doc. C→E through June 21 stands.
- Not a Phase 6 build plan. It's an outside-in landscape refresh; the next mountain after C→E is a separate decision.
- Not a green light to broaden verticals. Vertical-deepen (Shape A) vs. distribution-layer (Shape B) is the live fork; broadening (Shape C) is still gated on at least one paying tenant.

-- Sonnet, Medium (landscape refresh; no code changes)
