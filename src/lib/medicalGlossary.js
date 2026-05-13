// Seed medical / movement-therapy glossary used to anchor the transcript
// cleanup prompt. Web Speech tends to mangle anatomical and clinical terms
// the same way over and over (fascia → fashion, scapula → scapular,
// piriformis → "pure form is"), so we hand the model a list to prefer over
// phonetic guesses. The list is intentionally broad rather than long —
// terms here drive prompt anchoring, not regex substitution, so a handful
// of representative anatomy + modality terms covers the common misses.
//
// Per-workspace overrides live on workspaces.transcript_glossary; the
// cleanup handler merges the workspace list on top of this seed.

export const SEED_MEDICAL_TERMS = [
  // Anatomy — skeletal
  'scapula', 'clavicle', 'sternum', 'thoracic', 'lumbar', 'cervical',
  'sacrum', 'coccyx', 'patella', 'tibia', 'fibula', 'femur',
  'humerus', 'radius', 'ulna', 'calcaneus', 'metatarsal', 'phalanges',
  // Anatomy — soft tissue
  'fascia', 'tendon', 'ligament', 'meniscus', 'cartilage', 'bursa',
  'piriformis', 'psoas', 'iliopsoas', 'gastrocnemius', 'soleus', 'plantar fascia',
  'rotator cuff', 'labrum', 'IT band', 'iliotibial band', 'hamstring', 'quadriceps',
  // Movement / kinematics
  'dorsiflexion', 'plantarflexion', 'pronation', 'supination',
  'eversion', 'inversion', 'abduction', 'adduction', 'flexion', 'extension',
  'proprioception', 'kinematic', 'kinetic chain', 'biomechanics',
  // Common conditions
  'plantar fasciitis', 'tendinopathy', 'tendinosis', 'bursitis',
  'sciatica', 'radiculopathy', 'stenosis', 'herniation',
  'osteoarthritis', 'frozen shoulder', 'adhesive capsulitis',
  // Modalities / approaches
  'myofascial release', 'manual therapy', 'dry needling', 'cupping',
  'IASTM', 'Graston', 'proprioceptive', 'neuromuscular',
]

export const SEED_FILLER_WORDS = [
  'um', 'uh', 'er', 'ah', 'hmm',
  'like', 'you know', 'sort of', 'kind of', 'i mean',
  'basically', 'literally', 'right', 'okay so', 'so yeah',
]

// Merge workspace overrides over the seed. Each workspace key is optional;
// when present, its values are added to (not replacing) the seed list.
// Returned arrays are de-duped and lower-cased so the prompt stays compact.
export function resolveGlossary(workspaceGlossary) {
  const wsTerms = Array.isArray(workspaceGlossary?.terms) ? workspaceGlossary.terms : []
  const wsFillers = Array.isArray(workspaceGlossary?.fillers) ? workspaceGlossary.fillers : []
  const terms = Array.from(new Set([...SEED_MEDICAL_TERMS, ...wsTerms].map((t) => String(t).trim()).filter(Boolean)))
  const fillers = Array.from(new Set([...SEED_FILLER_WORDS, ...wsFillers].map((t) => String(t).trim().toLowerCase()).filter(Boolean)))
  return { terms, fillers }
}
