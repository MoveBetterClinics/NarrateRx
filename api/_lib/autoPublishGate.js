// Auto-publish gate evaluator — pure function, no side effects.
//
// evaluate({ pkg, workspace, sourceAsset }) → { eligible, channels, reasons }
//
// All four gate signals must pass for a package to be eligible:
//   1. voice_fidelity_score ≥ per-channel voice_fidelity_min (default 7.0)
//   2. similarity ≥ per-channel similarity_min (default 0.65)
//   3. consent_status obtained or not_required (not pending/revoked/null)
//   4. No QC flags on the package or source asset
//
// Returns the set of channels that are both enabled in workspace settings
// AND cleared by all four signals.

const DEFAULT_VOICE_FIDELITY_MIN = 70
const DEFAULT_SIMILARITY_MIN     = 0.65

// Channels wired to the auto-publish cron at launch.
// Others are stored in settings but silently skipped by the cron.
const LIVE_CHANNELS = new Set(['gbp'])

export function evaluate({ pkg, workspace, sourceAsset }) {
  const settings = workspace?.auto_publish_settings || {}
  const results = { eligible: false, channels: [], reasons: [] }

  // 1. Gather which channels the workspace has enabled (must be live + enabled).
  const enabledChannels = []
  for (const [channel, cfg] of Object.entries(settings)) {
    if (!cfg?.enabled) continue
    if (!LIVE_CHANNELS.has(channel)) continue // not yet wired
    enabledChannels.push({ channel, cfg })
  }
  if (enabledChannels.length === 0) {
    results.reasons.push({ signal: 'config', detail: 'No auto-publish channels enabled in workspace settings' })
    return results
  }

  // 2. Consent gate (workspace-level — same for all channels).
  const consent = sourceAsset?.consent_status ?? pkg?.source_asset?.consent_status
  if (consent === 'pending' || consent === 'revoked' || consent == null) {
    results.reasons.push({
      signal:    'consent',
      value:     consent,
      threshold: 'obtained or not_required',
      detail:    `Source asset consent is '${consent ?? 'unknown'}' — must be obtained or not_required`,
    })
    return results
  }

  // 3. QC flag check (workspace-level).
  const qcFlags = pkg?.qc_flags
  if (Array.isArray(qcFlags) && qcFlags.length > 0) {
    results.reasons.push({
      signal: 'qc_flag',
      value:  qcFlags,
      detail: `Package has QC flags: ${qcFlags.join(', ')}`,
    })
    return results
  }
  const assetQcFlags = sourceAsset?.qc_flags ?? pkg?.source_asset?.qc_flags
  if (Array.isArray(assetQcFlags) && assetQcFlags.length > 0) {
    results.reasons.push({
      signal: 'qc_flag',
      value:  assetQcFlags,
      detail: `Source asset has QC flags: ${assetQcFlags.join(', ')}`,
    })
    return results
  }

  // 4. Per-channel signal evaluation.
  const eligibleChannels = []
  const channelReasons = []

  for (const { channel, cfg } of enabledChannels) {
    const voiceMin = cfg.voice_fidelity_min ?? DEFAULT_VOICE_FIDELITY_MIN
    const simMin   = cfg.similarity_min     ?? DEFAULT_SIMILARITY_MIN
    const channelBlocked = []

    // voice_fidelity_score may be null if the scorer hasn't run yet.
    const score = pkg?.voice_fidelity_score
    if (score == null) {
      channelBlocked.push({
        signal:    'voice_fidelity',
        value:     null,
        threshold: voiceMin,
        detail:    'Voice fidelity not yet scored — hold until scored',
      })
    } else if (score < voiceMin) {
      channelBlocked.push({
        signal:    'voice_fidelity',
        value:     score,
        threshold: voiceMin,
        detail:    `Voice fidelity ${score.toFixed(2)} < ${voiceMin} threshold`,
      })
    }

    const similarity = pkg?.similarity
    if (similarity == null || similarity < simMin) {
      channelBlocked.push({
        signal:    'similarity',
        value:     similarity,
        threshold: simMin,
        detail:    `Clip-topic similarity ${similarity?.toFixed(3) ?? 'null'} < ${simMin} threshold`,
      })
    }

    if (channelBlocked.length === 0) {
      eligibleChannels.push(channel)
    } else {
      channelReasons.push(...channelBlocked.map((r) => ({ ...r, channel })))
    }
  }

  results.channels = eligibleChannels
  results.reasons  = [...results.reasons, ...channelReasons]
  results.eligible = eligibleChannels.length > 0
  return results
}
