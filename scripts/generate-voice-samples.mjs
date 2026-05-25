#!/usr/bin/env node
// Generate voice clone quality samples for Q (eleven_voice_id T3n3TddZK97Pv2VfG9eR).
// Writes 4 MP3 files to _voice-samples/ — one per register Q uses.
//
// Usage: node scripts/generate-voice-samples.mjs

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const envText = await readFile(join(ROOT, '.env.local'), 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const VOICE_ID   = 'T3n3TddZK97Pv2VfG9eR'
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY
if (!ELEVEN_KEY || ELEVEN_KEY.includes('REDACTED')) {
  console.error('Missing ELEVENLABS_API_KEY'); process.exit(1)
}

const SAMPLES = [
  {
    name: '01-patient-explanation',
    label: 'Patient explanation (clinical)',
    text: `The reason your hip is doing that is actually pretty straightforward once you understand the relationship between your pelvis and your lower back. When those segments aren't moving the way they should, your body compensates — and that compensation is what you're feeling. What we're going to do today is restore that movement, and then give you something to do at home so it stays that way.`,
  },
  {
    name: '02-teaching-mode',
    label: 'Teaching / educational',
    text: `Movement is the thing most people take for granted until they can't do it. And that's the problem with the way we talk about pain — we treat it like it's the enemy, when really it's just the signal. The question is never "how do I make this stop?" The question is "what is my body trying to tell me, and am I actually listening?" That shift in framing changes everything about how someone engages with their own recovery.`,
  },
  {
    name: '03-conversational',
    label: 'Conversational / natural aside',
    text: `I had a patient last week — been coming in for years — and she said something that really stuck with me. She said, "I used to think getting adjusted was something I needed. Now I think of it like training." And that's exactly it. That's the whole point. When you get there, you stop chasing relief and start building capacity.`,
  },
  {
    name: '04-book-opening',
    label: 'Book / long-form prose',
    text: `I didn't become a chiropractor because I wanted to fix backs. I became one because I kept asking why — why does this person hurt, why did this person heal, why does the same intervention work brilliantly for one patient and do almost nothing for another? The answer, I eventually realized, was never in the tissue. It was always in the movement. Or more precisely: in the relationship between a person and their own ability to move through the world without fear.`,
  },
]

const OUT = join(ROOT, '_voice-samples')

for (const sample of SAMPLES) {
  process.stdout.write(`Generating [${sample.label}]... `)

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key':   ELEVEN_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text:           sample.text,
      model_id:       'eleven_turbo_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0.0, use_speaker_boost: true },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.log(`FAILED ${res.status}: ${body.slice(0, 200)}`)
    continue
  }

  const buf = Buffer.from(await res.arrayBuffer())
  const path = join(OUT, `${sample.name}.mp3`)
  await writeFile(path, buf)
  console.log(`OK (${(buf.length / 1024).toFixed(0)} KB) → _voice-samples/${sample.name}.mp3`)
}

console.log(`\nAll samples saved to: ${OUT}`)
console.log('Open them in Finder or any audio player to check fidelity.')
