# Capture Companion — iOS Shortcut Build Guide

_Drafted 2026-05-27 for Move Better team. Each team member builds this once on their iPhone, pastes their personal upload token in once, then uses the Shortcut anywhere via Share Sheet or home-screen icon._

## What this Shortcut does

1. Triggered from Share Sheet (when you long-press a photo or video and tap Share) OR from a home-screen icon (to take a new photo/video right now).
2. Adds the file as binary body to a POST request to NarrateRx's capture endpoint.
3. Includes your personal Bearer token (set once during setup).
4. Sends a notification on success.

Total round trip: 5–15 seconds depending on file size and network.

## Prerequisites

- iPhone 12 or newer running iOS 17+ (older works but the Shortcuts UI varies)
- Your personal Capture Upload Token. Get it from NarrateRx:
  - Sign in at your workspace subdomain (e.g., `movebetter-people.narraterx.ai`)
  - Navigate to **Profile → Capture Companion → Generate Token**
  - Copy the token (starts with `cct_…`) — it's shown ONCE, never again
  - If you lose it: rotate and re-paste in the Shortcut

## Build steps

### 1. Open the Shortcuts app

iPhone → **Shortcuts** (built-in, blue icon with two interlocking shapes) → **+** in top-right.

### 2. Set up the Shortcut metadata

- Tap the small **(i)** at the bottom → **Settings**.
- **Name**: `Capture for NarrateRx`
- **Icon**: pick a camera or "N" — your call
- **Show in Share Sheet**: **ON**
- **Share Sheet Types**: tap → uncheck everything except **Images**, **Media**, **Movies**, **PDFs (optional)**, **Files**
- **Add to Home Screen**: do this too — it lets you trigger capture even when not sharing

Tap **Done**.

### 3. Add actions (in order)

The actions execute top-to-bottom when the Shortcut runs. Add each one by tapping the **+** at the bottom and searching for the action name.

#### Action 1 — Decide the input

Search **If**, add **If** action:
- Condition: `Shortcut Input` `has any value`

(This branches between "user shared a file" vs. "user tapped home-screen icon to capture new.")

#### Action 2 — Inside the "If" branch (user shared a file)

Inside the **If** branch (the indented part), add **Get File Type from Shortcut Input**.

#### Action 3 — Inside the "Otherwise" branch (no shared file)

In the **Otherwise** branch, add **Take Photo** OR **Take Video** — your choice. (You can duplicate the Shortcut into two separate ones if you want both a Photo Shortcut and a Video Shortcut on your home screen.)

#### Action 4 — After the If/Otherwise/End If block

Search **Get Current Date**, add it. This stamps `capturedAt`.

#### Action 5 — Format the date

Search **Format Date**, add it.
- Format: **ISO 8601**
- Include time: **ON**

#### Action 6 — Get current location (optional but recommended)

Search **Get Current Location**, add it.

Then add **Get Details of Locations**:
- Get: **Name** (or **Street** if you prefer street-level)

#### Action 7 — Set token variable

Search **Text**, add a **Text** action. In the text body, paste your **personal Capture Upload Token** (the `cct_…` value).

Then add **Set Variable**:
- Variable name: `Token`
- Value: the Text from previous step

⚠️ Treat this Shortcut like a password — anyone with your iPhone unlocked can use it. iOS Shortcuts back up to iCloud Keychain (encrypted) so you don't lose it on phone swap, but they're not as protected as Keychain entries.

#### Action 8 — Build the upload request

Search **Get Contents of URL**, add it. Configure:

- **URL**: `https://movebetter-people.narraterx.ai/api/capture/upload?filename=capture.jpg&capturedAt=` then tap → **Variables** → insert the Formatted Date, then `&locationHint=` then insert the Location Name variable
  - (Adjust the workspace subdomain to your own if not Move Better People)
  - (filename: change `.jpg` to `.mov` if you're using a Video Shortcut)
- **Method**: **POST**
- **Headers** — add two:
  - `Authorization` → value: `Bearer ` then insert your `Token` variable (note the space after Bearer)
  - `Content-Type` → value: `image/jpeg` for photos, `video/quicktime` for videos (or `application/octet-stream` if mixed)
- **Request Body**: choose **File**, then set the file to the **Shortcut Input** variable (if Share Sheet) or to the **Photo / Video** captured by Take Photo / Take Video

#### Action 9 — Parse the response

The API returns JSON like `{"assetId":"…","blobUrl":"…","status":"uploaded","kind":"photo"}`. Add **Get Dictionary from Input** to parse it. Then add **Get Dictionary Value** for the `status` key.

#### Action 10 — Show notification

Search **Show Notification**, add it:
- **Title**: `Captured ✓`
- **Body**: `Status: ` then insert the `status` value from Action 9

If the API errors, the response body will be a JSON error. The notification will show "Status: " followed by something other than `uploaded`, which is your cue that something failed.

### 4. Save

Tap **Done** in the top-right.

## Test it

1. Take a quick photo of a wall in your treatment room.
2. From the home screen icon: tap **Capture for NarrateRx** → take photo → wait for notification.
3. Or via Share Sheet: open Photos → pick the photo → Share → scroll to **Capture for NarrateRx** → tap.

You should see "Captured ✓ — Status: uploaded" within ~10 seconds.

Then sign in to NarrateRx and navigate to your Media Library — the new photo should appear there with `source: capture_companion` and an auto-generated thumbnail.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Status: 401 unauthorized" | Token is wrong, expired, or missing the `Bearer ` prefix | Re-copy the token from NarrateRx → Profile → Capture Companion. Make sure the header value is `Bearer cct_xxx` with a space. |
| "Status: 413 payload too large" | File is bigger than the current cap (~50MB) | Trim the video in Photos first, or split into multiple clips. We'll raise the cap based on real-world sizes during dogfood. |
| "Status: 415 unsupported media type" | Wrong Content-Type header | Set `image/jpeg` for photos, `video/quicktime` for iPhone videos, `application/octet-stream` as fallback. |
| Notification never shows | Network failed, or Shortcut is misconfigured | Re-run with the Shortcut visible in the Shortcuts app — it'll show the error inline. Check that all variables are wired correctly. |
| Upload succeeds but file is missing in NarrateRx | media_assets row was created but the blob upload silently failed | Check Vercel logs for `[capture/upload]` errors. Re-upload. |

## Sensitivity

| Item | Tier |
|---|---|
| **Capture Upload Token** (`cct_…`) | **Sensitive** — anyone with this can upload to your clinician identity. Treat like a password. Rotate immediately if leaked. |
| iCloud Shortcut backup | Encrypted by Apple; not an issue under normal use |

## Rotation procedure

If your token leaks or you change phones:

1. Sign in to NarrateRx → Profile → Capture Companion → **Rotate Token**
2. Copy the new token
3. Open Shortcuts → **Capture for NarrateRx** → edit the **Text** action → paste new token → Done
4. Old token is immediately invalid; no other action needed

## Future enhancements (not in v1)

- **Auto-trim**: Shortcut could trim videos to last 60s automatically
- **Burst capture**: tap once, get 5 photos in 2 seconds
- **Voice memo + photo**: combo capture pipeline
- **Family sharing of one Shortcut across team iPhones**: when the team grows past Move Better's current four

These all live in the Phase 7+ backlog and are not part of the 30-day build.
