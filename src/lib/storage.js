const KEY = 'mb_interviewer_v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : { clinicians: [] }
  } catch {
    return { clinicians: [] }
  }
}

function save(data) {
  localStorage.setItem(KEY, JSON.stringify(data))
}

export function getClinicians() {
  return load().clinicians
}

export function getClinician(id) {
  return load().clinicians.find((c) => c.id === id) || null
}

export function getOrCreateClinician(name) {
  const data = load()
  const normalized = name.trim()
  let clinician = data.clinicians.find(
    (c) => c.name.toLowerCase() === normalized.toLowerCase()
  )
  if (!clinician) {
    clinician = {
      id: crypto.randomUUID(),
      name: normalized,
      createdAt: new Date().toISOString(),
      interviews: [],
    }
    data.clinicians.push(clinician)
    save(data)
  }
  return clinician
}

export function createInterview(staffId, topic) {
  const data = load()
  const clinician = data.clinicians.find((c) => c.id === staffId)
  if (!clinician) return null
  const interview = {
    id: crypto.randomUUID(),
    topic,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    outputs: null,
    status: 'in_progress',
  }
  clinician.interviews.unshift(interview)
  save(data)
  return interview
}

export function getInterview(staffId, interviewId) {
  const clinician = getClinician(staffId)
  if (!clinician) return null
  return clinician.interviews.find((i) => i.id === interviewId) || null
}

export function updateInterviewMessages(staffId, interviewId, messages) {
  const data = load()
  const clinician = data.clinicians.find((c) => c.id === staffId)
  if (!clinician) return
  const interview = clinician.interviews.find((i) => i.id === interviewId)
  if (!interview) return
  interview.messages = messages
  interview.updatedAt = new Date().toISOString()
  save(data)
}

export function saveInterviewOutputs(staffId, interviewId, outputs) {
  const data = load()
  const clinician = data.clinicians.find((c) => c.id === staffId)
  if (!clinician) return
  const interview = clinician.interviews.find((i) => i.id === interviewId)
  if (!interview) return
  interview.outputs = outputs
  interview.status = 'completed'
  interview.updatedAt = new Date().toISOString()
  save(data)
}

export function deleteInterview(staffId, interviewId) {
  const data = load()
  const clinician = data.clinicians.find((c) => c.id === staffId)
  if (!clinician) return
  clinician.interviews = clinician.interviews.filter((i) => i.id !== interviewId)
  save(data)
}

export function deleteClinician(staffId) {
  const data = load()
  data.clinicians = data.clinicians.filter((c) => c.id !== staffId)
  save(data)
}

