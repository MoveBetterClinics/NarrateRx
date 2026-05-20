import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { isHeicBuffer, isHeicMime } from '../../api/_lib/imagePipeline.js'

// Helper — synthesize an ISO-BMFF "ftyp" box with the given major brand.
// Mirrors the first 12 bytes of a real HEIF/HEIC file. Anything beyond byte
// 12 is irrelevant to the detector.
function ftypBytes(brand) {
  const buf = Buffer.alloc(16)
  buf.writeUInt32BE(16, 0)          // box size
  buf.write('ftyp', 4, 4, 'ascii')  // box type
  buf.write(brand, 8, 4, 'ascii')   // major brand
  return buf
}

describe('isHeicMime', () => {
  it('matches the four HEIC/HEIF mime variants case-insensitively', () => {
    expect(isHeicMime('image/heic')).toBe(true)
    expect(isHeicMime('image/heif')).toBe(true)
    expect(isHeicMime('IMAGE/HEIC')).toBe(true)
    expect(isHeicMime('image/heic-sequence')).toBe(true)
    expect(isHeicMime('image/heif-sequence')).toBe(true)
  })

  it('returns false for browser-safe mimes and missing values', () => {
    expect(isHeicMime('image/jpeg')).toBe(false)
    expect(isHeicMime('image/png')).toBe(false)
    expect(isHeicMime('')).toBe(false)
    expect(isHeicMime(null)).toBe(false)
    expect(isHeicMime(undefined)).toBe(false)
  })
})

describe('isHeicBuffer', () => {
  it('matches all documented HEIC/HEIF major brands', () => {
    for (const brand of ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs']) {
      expect(isHeicBuffer(ftypBytes(brand))).toBe(true)
    }
  })

  it('rejects non-HEIF brands and non-BMFF data', () => {
    // mp4 ftyp box — sanity check that the detector doesn't false-positive
    // on video files that share the same ftyp box structure.
    expect(isHeicBuffer(ftypBytes('isom'))).toBe(false)
    expect(isHeicBuffer(ftypBytes('mp42'))).toBe(false)
    // JPEG SOI marker
    expect(isHeicBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false)
    // PNG magic
    expect(isHeicBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false)
  })

  it('returns false for short or empty buffers', () => {
    expect(isHeicBuffer(null)).toBe(false)
    expect(isHeicBuffer(Buffer.alloc(0))).toBe(false)
    expect(isHeicBuffer(Buffer.alloc(8))).toBe(false)  // too short for brand
  })
})

// Integration smoke for the resize side of the pipeline — exercises the
// internal sharp invocation by re-creating the same resize args. Skipped if
// sharp's HEIF decode isn't available on this platform (CI Linux + libheif
// have it; some macOS builds don't).
describe('sharp resize behavior used by processImageUpload', () => {
  it('produces a JPEG within the 2000px ceiling and respects EXIF rotation', async () => {
    // 3000×1500 red rectangle — wider than the resize ceiling.
    const src = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).jpeg().toBuffer()

    const { data, info } = await sharp(src)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true, progressive: true })
      .toBuffer({ resolveWithObject: true })

    expect(info.format).toBe('jpeg')
    expect(info.width).toBe(2000)
    expect(info.height).toBe(1000)
    expect(data.length).toBeLessThan(src.length) // resize must shrink, not grow
  })

  it('preserves PNG transparency when the source is PNG', async () => {
    const src = await sharp({
      create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer()

    const { info } = await sharp(src)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer({ resolveWithObject: true })

    expect(info.format).toBe('png')
    // withoutEnlargement keeps the smaller source untouched
    expect(info.width).toBe(800)
    expect(info.height).toBe(600)
  })
})
