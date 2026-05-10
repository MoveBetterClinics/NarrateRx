-- Pre-populate enabled_outputs for the three Move Better workspaces with all
-- 13 channels from src/lib/outputChannels.js. Run at Phase 2 cutover time so
-- workspace admins don't have to manually toggle every channel on first sign-in.
--
-- External workspaces (signed up via the future onboarding wizard) will start
-- with an empty enabled_outputs and pick channels in the settings UI.

update workspaces
set enabled_outputs = array[
  'blog',
  'email',
  'gbp',
  'instagram_post',
  'instagram_reel',
  'facebook',
  'linkedin',
  'tiktok',
  'youtube_short',
  'pinterest',
  'google_ads',
  'ig_ads',
  'landing_page'
]
where slug in ('movebetter-people','movebetter-equine','movebetter-animals');
