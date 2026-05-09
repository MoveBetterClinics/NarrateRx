// Deprecated: topic suggestions are now per-workspace overlay modules at
// brands/<brand>/topicSuggestions.js, selected via the @brand-overlay alias.
// This file remains as a thin compatibility shim — prefer importing from
// '@brand-overlay/topicSuggestions' directly in new code.

export { TOPIC_SUGGESTIONS, getSuggestedTopics } from '@brand-overlay/topicSuggestions'
