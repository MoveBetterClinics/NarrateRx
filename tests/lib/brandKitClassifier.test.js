import { describe, it, expect } from 'vitest'
import { parseFilenameTokens, scoreRoleCandidates } from '../../api/_lib/brandKitClassifier.js'

// SVG logos skip sharp attribute inference in api/brand-kit/upload.js, so they
// arrive here with shape/background/color_mode unknown. These cases lock in the
// filename-fallback that lets an SVG logo still be auto-assigned (the tenant
// onboarding dead-end that prompted the fix).
function svgAsset(filename) {
  return {
    mime_type: 'image/svg+xml',
    filename_tokens: parseFilenameTokens(filename),
    shape: null,
    background: 'unknown',
    color_mode: 'unknown',
    width: null,
    height: null,
  }
}

describe('scoreRoleCandidates — SVG / uninferrable logo fallback', () => {
  it('surfaces primary_logo for a bare logo.svg above the auto-assign threshold', () => {
    const out = scoreRoleCandidates(svgAsset('logo.svg'))
    const logo = out.find((c) => c.role === 'primary_logo')
    expect(logo).toBeTruthy()
    expect(logo.confidence).toBeGreaterThanOrEqual(0.7)
    // Below the upload-time silent-assign bar so the user still confirms it.
    expect(logo.confidence).toBeLessThan(0.75)
  })

  it('surfaces primary_logo for a real-world named SVG logo', () => {
    const out = scoreRoleCandidates(svgAsset('MyClinic-Primary-Logo.svg'))
    expect(out.some((c) => c.role === 'primary_logo')).toBe(true)
  })

  it('does NOT invent a logo role for an SVG with no logo-ish filename', () => {
    const out = scoreRoleCandidates(svgAsset('texture-background.svg'))
    expect(out.some((c) => c.role === 'primary_logo')).toBe(false)
  })

  it('does not double-assign when the SVG is already an icon/mark', () => {
    const out = scoreRoleCandidates(svgAsset('brand-mark.svg'))
    // 'mark' routes to mark_only via the icon path; the fallback must not also
    // push a competing primary_logo candidate.
    expect(out.some((c) => c.role === 'mark_only')).toBe(true)
    expect(out.some((c) => c.role === 'primary_logo')).toBe(false)
  })
})

describe('scoreRoleCandidates — raster path unchanged (regression)', () => {
  it('keeps the high-confidence primary_logo for a horizontal/light/color PNG', () => {
    const out = scoreRoleCandidates({
      mime_type: 'image/png',
      filename_tokens: parseFilenameTokens('acme-primary-horizontal-rgb.png'),
      shape: 'horizontal',
      background: 'light',
      color_mode: 'color',
      width: 1200,
      height: 400,
    })
    const logo = out.find((c) => c.role === 'primary_logo')
    expect(logo).toBeTruthy()
    expect(logo.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('still classifies a PDF as a brand book', () => {
    const out = scoreRoleCandidates({
      mime_type: 'application/pdf',
      filename_tokens: parseFilenameTokens('brand-guidelines.pdf'),
      shape: null,
      background: 'unknown',
      color_mode: 'unknown',
    })
    expect(out).toEqual([{ role: 'brand_book', confidence: 0.95 }])
  })
})
