// Emotional-weight detection for InterviewSession.
//
// Pure, side-effect-free — accepts an array of user message strings and
// returns the detected state so it can be tested independently of React.
//
// High-weight keyword groups (weighted):
//   loss, struggle, personal-injury, hedging/resistance
//
// Two output states:
//   'weighted'  — person is describing something emotionally hard
//   'resistant' — person is hedging, opting out, or terse across 3+ turns
//   null        — no signal detected

const LOSS_WORDS = [
  "lost",
  "didn't make it",
  "passed away",
  "couldn't",
  "failed",
  "gave up",
  "quit",
]

const STRUGGLE_WORDS = [
  "really hard",
  "difficult",
  "struggled",
  "was rough",
  "broke down",
  "cried",
  "scared",
  "afraid",
  "worried",
]

const PERSONAL_INJURY_SIGNALS = [
  "my own",
  "i had",
  "when i was a patient",
  "my injury",
  "my surgery",
]

// Explicit opt-out phrases. These route to 'resistant' rather than
// being treated as session-end signals (see STOP_PHRASES in InterviewSession).
export const RESIST_PHRASES = [
  "i'd rather not",
  "not sure i want to",
  "that's personal",
  "can we skip",
  "move on",
  "next question",
]

/**
 * Detect emotional state from the last 2–3 user messages.
 *
 * @param {string[]} userMessages - Array of recent user message strings,
 *   ordered oldest-first. The function considers the last 3 entries.
 * @returns {'weighted' | 'resistant' | null}
 */
export function detectEmotionalState(userMessages) {
  if (!Array.isArray(userMessages) || userMessages.length === 0) return null

  const window = userMessages.slice(-3)
  const combined = window.join(' ').toLowerCase()

  // --- Resistance check (explicit opt-out phrases) ---
  for (const phrase of RESIST_PHRASES) {
    if (combined.includes(phrase)) return 'resistant'
  }

  // --- Terse-responses check (3 consecutive messages each under 10 words) ---
  if (window.length >= 3) {
    const allTerse = window.every((msg) => msg.trim().split(/\s+/).length < 10)
    if (allTerse) return 'resistant'
  }

  // --- Emotional-weight check (2+ signal matches across loss + struggle + personal-injury) ---
  let matches = 0

  for (const word of LOSS_WORDS) {
    if (combined.includes(word)) {
      matches += 1
      if (matches >= 2) return 'weighted'
    }
  }

  for (const word of STRUGGLE_WORDS) {
    if (combined.includes(word)) {
      matches += 1
      if (matches >= 2) return 'weighted'
    }
  }

  for (const signal of PERSONAL_INJURY_SIGNALS) {
    if (combined.includes(signal)) {
      matches += 1
      if (matches >= 2) return 'weighted'
    }
  }

  return null
}

/**
 * Returns the system-prompt injection string for the given emotional state,
 * or an empty string when state is null.
 *
 * @param {'weighted' | 'resistant' | null} state
 * @returns {string}
 */
export function getEmotionPromptInjection(state) {
  if (state === 'weighted') {
    return `\nEMOTIONAL CONTEXT — The staff member's last response carries emotional weight. Slow down. Respond with warmth and acknowledgment before asking anything. Give them space: "That sounds significant — thank you for sharing that. Take your time." If they want to continue on this topic, follow their lead with a gentle probe. If they seem done, move naturally to the next topic without pressing.\n`
  }
  if (state === 'resistant') {
    return `\nEMOTIONAL CONTEXT — The staff member appears uncomfortable with this topic. Do not probe further. Acknowledge briefly ("Of course — let's move on") and transition to the next topic naturally. Do not reference the skipped topic again.\n`
  }
  return ''
}
