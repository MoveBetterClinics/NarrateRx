import { describe, it, expect } from 'vitest'
import {
  buildImagesManifest,
  extractInlineImages,
  pickHero,
} from '../../src/lib/publishImageMirror.js'
import {
  rewriteMarkdownImageUrls,
  buildImagesManifest as serverBuildImagesManifest,
} from '../../api/_lib/publishImageMirror.js'

const BLOB_HOST = 'https://example.public.blob.vercel-storage.com'

describe('extractInlineImages', () => {
  it('returns image refs in source order with alt text', () => {
    const md = '# Hi\n\n![One](https://a.com/1.jpg)\n\nText ![two](https://b.com/2.png "title") more.'
    expect(extractInlineImages(md)).toEqual([
      { alt: 'One', url: 'https://a.com/1.jpg' },
      { alt: 'two', url: 'https://b.com/2.png' },
    ])
  })

  it('deduplicates repeated URLs', () => {
    const md = '![a](https://x/y.jpg) ![b](https://x/y.jpg)'
    expect(extractInlineImages(md)).toEqual([{ alt: 'a', url: 'https://x/y.jpg' }])
  })

  it('returns [] for non-string or empty input', () => {
    expect(extractInlineImages(null)).toEqual([])
    expect(extractInlineImages('')).toEqual([])
    expect(extractInlineImages('# no images here')).toEqual([])
  })
})

describe('pickHero', () => {
  it('returns the first image entry, skipping videos', () => {
    const mediaUrls = [
      { url: 'https://x/v.mp4', type: 'video' },
      { url: 'https://x/a.jpg', type: 'image', alt: 'A' },
      { url: 'https://x/b.jpg', type: 'image' },
    ]
    expect(pickHero(mediaUrls)).toEqual({ url: 'https://x/a.jpg', alt: 'A' })
  })

  it('falls back across kind/type/photo signals', () => {
    expect(pickHero([{ url: 'https://x/p.jpg', type: 'photo' }])).toEqual({ url: 'https://x/p.jpg', alt: '' })
    expect(pickHero([{ url: 'https://x/k.jpg', kind: 'image' }])).toEqual({ url: 'https://x/k.jpg', alt: '' })
  })

  it('uses name as alt when alt is absent', () => {
    expect(pickHero([{ url: 'https://x/k.jpg', kind: 'image', name: 'horse.jpg' }]))
      .toEqual({ url: 'https://x/k.jpg', alt: 'horse.jpg' })
  })

  it('returns null when no image entries are present', () => {
    expect(pickHero([])).toBeNull()
    expect(pickHero(null)).toBeNull()
    expect(pickHero([{ url: 'https://x/v.mp4', type: 'video' }])).toBeNull()
  })
})

describe('buildImagesManifest', () => {
  it('emits hero + inline body images with stable filenames', () => {
    const markdown = `# Title\n\n![alt 1](${BLOB_HOST}/body-a.jpg)\n\n![](${BLOB_HOST}/body-b.png)`
    const mediaUrls = [{ url: `${BLOB_HOST}/hero.jpg`, type: 'image', alt: 'Hero' }]
    const out = buildImagesManifest({ markdown, mediaUrls, slug: 'my-post' })
    expect(out.heroImage).toBe(`${BLOB_HOST}/hero.jpg`)
    expect(out.heroImageAlt).toBe('Hero')
    expect(out.images).toEqual([
      { url: `${BLOB_HOST}/body-a.jpg`, alt: 'alt 1', filename: 'my-post-1.jpg', mirrorable: true },
      { url: `${BLOB_HOST}/body-b.png`, alt: '',      filename: 'my-post-2.png', mirrorable: true },
    ])
  })

  it('skips an inline reference that duplicates the hero URL', () => {
    const url = `${BLOB_HOST}/hero.jpg`
    const markdown = `![hero in body](${url})\n\nSome text.`
    const out = buildImagesManifest({
      markdown,
      mediaUrls: [{ url, type: 'image' }],
      slug: 's',
    })
    expect(out.heroImage).toBe(url)
    expect(out.images).toEqual([])
  })

  it('marks external CDN URLs as non-mirrorable', () => {
    const markdown = '![](https://images.unsplash.com/foo.jpg)'
    const out = buildImagesManifest({ markdown, mediaUrls: [], slug: 's' })
    expect(out.images).toEqual([
      { url: 'https://images.unsplash.com/foo.jpg', alt: '', filename: 's-1.jpg', mirrorable: false },
    ])
  })

  it('omits heroImage when no image entry is attached', () => {
    const out = buildImagesManifest({ markdown: '', mediaUrls: [], slug: 's' })
    expect(out.heroImage).toBeUndefined()
    expect(out.heroImageAlt).toBeUndefined()
    expect(out.images).toEqual([])
  })

  it('client and server builders produce identical output', () => {
    const markdown = `# T\n![a](${BLOB_HOST}/a.jpg)\n![b](${BLOB_HOST}/b.png)`
    const mediaUrls = [{ url: `${BLOB_HOST}/h.jpg`, type: 'image', alt: 'H' }]
    const slug = 'parity'
    expect(buildImagesManifest({ markdown, mediaUrls, slug }))
      .toEqual(serverBuildImagesManifest({ markdown, mediaUrls, slug }))
  })
})

describe('rewriteMarkdownImageUrls', () => {
  it('replaces only mapped URLs and preserves alt text', () => {
    const md = `![A](${BLOB_HOST}/a.jpg) and ![B](${BLOB_HOST}/b.jpg)`
    const out = rewriteMarkdownImageUrls(md, {
      [`${BLOB_HOST}/a.jpg`]: 'https://wp.example.com/wp-content/uploads/2026/05/a.jpg',
    })
    expect(out).toBe(
      `![A](https://wp.example.com/wp-content/uploads/2026/05/a.jpg) and ![B](${BLOB_HOST}/b.jpg)`,
    )
  })

  it('returns markdown unchanged when no map is given', () => {
    const md = '![x](https://x/y.jpg)'
    expect(rewriteMarkdownImageUrls(md, null)).toBe(md)
    expect(rewriteMarkdownImageUrls(md, {})).toBe(md)
  })

  it('leaves non-image links alone', () => {
    const md = '[link](https://x/y.jpg) plus ![pic](https://x/y.jpg)'
    const out = rewriteMarkdownImageUrls(md, { 'https://x/y.jpg': 'https://NEW/y.jpg' })
    expect(out).toBe('[link](https://x/y.jpg) plus ![pic](https://NEW/y.jpg)')
  })
})
