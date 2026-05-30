const KEY = 'mb_interviewer_v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : { staff: [] }
  } catch {
    return { staff: [] }
  }
}

function save(data) {
  localStorage.setItem(KEY, JSON.stringify(data))
}

export function getStaff() {
  return load().staff
}

export function getStaffMember(id) {
  return load().staff.find((c) => c.id === id) || null
}

export function getOrCreateStaff(name) {
  const data = load()
  const normalized = name.trim()
  let member = data.staff.find(
    (c) => c.name.toLowerCase() === normalized.toLowerCase()
  )
  if (!member) {
    member = {
      id: crypto.randomUUID(),
      name: normalized,
      createdAt: new Date().toISOString(),
      interviews: [],
    }
    data.staff.push(member)
    save(data)
  }
  return member
}

export function createInterview(staffId, topic) {
  const data = load()
  const member = data.staff.find((c) => c.id === staffId)
  if (!member) return null
  const interview = {
    id: crypto.randomUUID(),
    topic,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    outputs: null,
    status: 'in_progress',
  }
  member.interviews.unshift(interview)
  save(data)
  return interview
}

export function getInterview(staffId, interviewId) {
  const member = getStaffMember(staffId)
  if (!member) return null
  return member.interviews.find((i) => i.id === interviewId) || null
}

export function updateInterviewMessages(staffId, interviewId, messages) {
  const data = load()
  const member = data.staff.find((c) => c.id === staffId)
  if (!member) return
  const interview = member.interviews.find((i) => i.id === interviewId)
  if (!interview) return
  interview.messages = messages
  interview.updatedAt = new Date().toISOString()
  save(data)
}

export function saveInterviewOutputs(staffId, interviewId, outputs) {
  const data = load()
  const member = data.staff.find((c) => c.id === staffId)
  if (!member) return
  const interview = member.interviews.find((i) => i.id === interviewId)
  if (!interview) return
  interview.outputs = outputs
  interview.status = 'completed'
  interview.updatedAt = new Date().toISOString()
  save(data)
}

export function deleteInterview(staffId, interviewId) {
  const data = load()
  const member = data.staff.find((c) => c.id === staffId)
  if (!member) return
  member.interviews = member.interviews.filter((i) => i.id !== interviewId)
  save(data)
}

export function deleteStaff(staffId) {
  const data = load()
  data.staff = data.staff.filter((c) => c.id !== staffId)
  save(data)
}
