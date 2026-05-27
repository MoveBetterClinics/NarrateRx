# Video Capture Kit — Buy List (v2)

_Updated 2026-05-27. Restructured around two kits + a universal upload page. v1 over-recommended an iPhone purchase that wasn't needed when the clinic already has a camera + browser. This version reflects the production reality: PWA `/capture` is the universal upload, iOS Shortcut is an optional fast path for solo on-the-road clinicians._

## Which kit do I need?

| Your situation | Kit | Hero device | Upload path |
|---|---|---|---|
| **Fixed clinic location, shared staff, owns a camera** (Move Better People, most chiro/PT/OT clinics) | **Studio Kit** | Existing camera (or buy one) | PWA `/capture` from any clinic browser |
| **Solo, on-the-road, mobile practice** (Move Better Equine, mobile vets, ambulatory therapists) | **Mobile Kit** | Your personal iPhone | iOS Shortcut (one tap) — falls back to PWA `/capture` if Shortcut isn't built yet |
| **Hybrid** (clinic days + house calls) | Both kits | Both | Whichever's at hand |

The two kits are **not exclusive** — a Studio-Kit clinic can also use the PWA from a personal phone in a pinch; a Mobile-Kit clinician can drop SD cards into a clinic Mac and use the PWA when they want to.

## Universal upload page (works for both kits)

Every tenant gets `/capture` on their NarrateRx subdomain (e.g. `movebetter-people.narraterx.ai/capture`). Works on any device with a browser and a camera or file picker — iOS Safari, Android Chrome, Mac browsers, Chromebook, iPad, anything.

Two entry points on the page:
- **Take photo or video** — opens the device's native camera
- **Pick existing files** — opens Photos / SD card / Downloads

Save the URL to the home screen on mobile for app-like access. No app to install. Logged-in NarrateRx user is automatically the uploader; no token to manage.

## Studio Kit — fixed-location clinic

Total: **~$2,548 for Move Better People** (already own ZV-1F). For a new tenant buying a camera: ~$3,048.

### Camera (pick ONE — skip if already owned)

| Option | Cost | When it fits |
|---|---|---|
| **Sony ZV-1F** | ~$500 new / ~$400 used | Vlog-style compact, 1" sensor, 4K, mic input. Fixed 20mm lens. Strong sit-down talking-head + cinematic B-roll. Move Better People already owns one. |
| Sony ZV-E10 II + 16-50mm kit | ~$1,100 | Step up — interchangeable lens, larger sensor. Worth it if you'll do varied subjects. |
| Sony A7C II + 28-60mm | ~$2,400 | Pro full-frame, overkill for most clinics. |
| **Skip a dedicated camera — use clinic-owned iPad or Android tablet** | $329–$649 | iPad mini WiFi 256GB is $649. Decent camera, runs `/capture` PWA, doubles as the upload station. Lower image quality than ZV-1F but **one device** for capture + upload. |

For Move Better People specifically: ZV-1F is already owned, no new camera purchase.

### Required tier 1

| Item | Cost | Vendor |
|---|---|---|
| **DJI Mic 2 — 2 TX + 1 RX combo** | ~$349 | dji.com or B&H |
| **Aputure Amaran 200x S** (bi-color LED key light) | ~$399 | B&H |
| **Aputure Amaran P60c** (RGBWW panel fill) | ~$229 | B&H |
| **Manfrotto Befree Advanced tripod** | ~$199 | B&H |
| **Joby GorillaPod 5K Kit** | ~$159 | B&H |
| **Samsung T7 Shield 4TB SSD** (SD archive shuttle) | ~$249 | B&H |

**Subtotal: $1,584**

### Recommended tier 2

| Item | Cost | Why |
|---|---|---|
| **Insta360 X5** | ~$549 | Passive 360 room capture — mount on wall during sessions (with patient consent). Reframe in post. Solves "I forgot to film that." |
| ZV-1F camera cage + 2 spare NP-BX1 batteries + UHS-II microSD cards + cleaning kit | ~$265 | Camera-specific accessories |
| Misc cables, SD cards, charging, pouch | ~$150 | |

**Subtotal: $964**

### Don't buy (or defer)

- **iPhone 15/16 Pro Max ($1,499)** — DROPPED from v1. If you have a clinic camera + browser, the iPhone isn't needed. Solo on-the-road tenants use their *personal* iPhone with the Shortcut (Mobile Kit). v1 over-bought this.
- **DJI Osmo Pocket 3 ($799)** — gimbal handheld for walking shots. Camera EIS handles ~80% of need at this price tier. Reconsider after 60 days if walking-shot stability is a complaint.
- **SmallRig iPhone cage ($129)** — only if rigging serious mounted accessories.

### Studio Kit total

| Component | Move Better People (owns ZV-1F) | New tenant (buying camera) |
|---|---|---|
| Camera | $0 | $500 |
| Tier 1 required | $1,584 | $1,584 |
| Tier 2 recommended | $964 | $964 |
| **Grand total** | **$2,548** | **$3,048** |

Was $4,970 in v1.

---

## Mobile Kit — solo on-the-road clinician

Total: **~$219 single-purchase** (assuming you own an iPhone). For Move Better Equine: ~$219, Whitney already has the iPhone.

### Hardware

| Item | Cost | Notes |
|---|---|---|
| **Your iPhone** | Already owned | Hero capture + edit + upload device |
| **DJI Mic 2 — 1 TX + 1 RX** (compact) | ~$219 | Pocket-sized lavalier for talking-head. iPhone-compatible via USB-C / Lightning. |
| Optional: Joby GripTight Pro 2 GorillaPod | ~$80 | Solo "talk to camera" tripod on location |
| Optional: Aputure Amaran AL-MX pocket LED | ~$60 | When natural light is poor |

Mobile Kit grand total: **$219 minimum, ~$360 with both extras**.

### Setup (one-time, ~15 minutes)

The iPhone runs the **iOS Capture Companion Shortcut** — Apple Shortcuts app, free, built-in. See `capture-companion-ios-shortcut.md` in this same runbooks directory for the click-by-click guide.

Once built:
- Tap the Shortcut from home screen or Share Sheet
- iPhone camera opens → capture → uploads to your NarrateRx workspace in ~5 seconds
- Or share an existing Photos library item → "Capture for NarrateRx" → uploads

**Falls back to PWA `/capture` if the Shortcut isn't built yet** — works the same, just two more taps.

---

## Capture Upload Tokens

The iOS Shortcut authenticates with a **Capture Upload Token** — a per-clinician 90-day secret prefixed `cct_…`. To generate one:

1. Sign in to NarrateRx as the clinician (or as a workspace owner viewing the clinician's profile)
2. Clinician Profile → **Settings** tab → **Capture Companion** section
3. Tap **Generate Token** — the value is displayed **once**, copy immediately
4. Paste into the iOS Shortcut as the Bearer header value
5. Token can be rotated or revoked from the same panel

The PWA `/capture` page does NOT need a token — it uses your existing Clerk login. Token is only for the Shortcut path.

---

## For all tenants: where to buy

| Vendor | Why | Account needed |
|---|---|---|
| **B&H Photo** (bhphotovideo.com) | Best for pro audio + lighting + tripods; tax-free outside NY; ships fast | Recommended primary vendor — create a business account |
| **DJI direct** (dji.com) | Mic 2; cleaner warranty than third-party | DJI account |
| **Apple** (apple.com) | iPad mini if going that route | Existing Apple ID |
| **Insta360 direct** (insta360.com) | X5; bundles better than resellers | Insta360 account |
| **Samsung + Amazon** | T7 Shield SSD; widely available | Existing |

All vendors ship to commercial / clinic addresses. Use the clinic shipping address; bill to NarrateRx if separate accounting.

### Sensitivity

| Item | Tier |
|---|---|
| Vendor accounts + invoices | Mildly sensitive — store in 1Password under NarrateRx vault |
| Shipping addresses | Mildly sensitive |
| Capture Upload Tokens (`cct_…`) | **Sensitive** — anyone with one can upload to that clinician's identity. Rotate immediately if leaked. |

## Move Better workspace-specific recommendations

| Workspace | Kit | Hero device | Upload path | Setup status |
|---|---|---|---|---|
| **Move Better People** | Studio Kit, no new camera | ZV-1F (already owned) + clinic browser | PWA `/capture` | `video_pipeline_enabled = true` ✓ |
| **Move Better Equine** | Mobile Kit | Whitney's iPhone | iOS Shortcut (1-tap) | `video_pipeline_enabled = true` ✓, Whitney's token generated ✓ |
| **Move Better Animal Chiro** | TBD (likely Studio) | TBD | TBD | Pending Whitney's Equine validation |

## Productizing for external tenants

The two-kit shape becomes a one-question wizard for tenant onboarding (Phase 6):

> *"How will you mostly capture content?"*
> *(a) From a fixed clinic location — Studio Kit*
> *(b) On the road / mobile practice — Mobile Kit*

The wizard then surfaces the right runbook + the right setup steps. Both kits land on the same Media Library + visual practice memory infrastructure — they just have different upload entry points.

## Recent revisions

- **v2 (2026-05-27)**: Restructured around Studio + Mobile kits. Cut the iPhone Pro Max recommendation. Made PWA `/capture` the default universal upload. iOS Shortcut becomes Mobile Kit only. Aligned with Move Better's actual rollout (People = Studio, Equine = Mobile, Animal = TBD).
- **v1 (2026-05-26)**: Single $4,970 kit centered around iPhone 16 Pro Max. Retired — over-bought, under-flexible.
