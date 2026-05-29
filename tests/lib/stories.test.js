import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { deriveStoryStage, buildStories } from '../../src/lib/stories.js'

describe('deriveStoryStage', () => {
  it('returns capture when interview is not completed', () => {
    expect(deriveStoryStage({ status: 'in_progress' }, [])).toBe('capture')
    expect(deriveStoryStage({ status: 'in_progress' }, [{ status: 'published' }])).toBe('capture')
  })

  it('returns drafting when completed with zero pieces', () => {
    expect(deriveStoryStage({ status: 'completed' }, [])).toBe('drafting')
  })

  it('returns published when any piece is published and none are scheduled or in_review', () => {
    const pieces = [
      { status: 'published' },
      { status: 'draft' },
      { status: 'approved' },
    ]
    expect(deriveStoryStage({ status: 'completed' }, pieces)).toBe('published')
  })

  it('returns scheduled when any piece is scheduled (even with published)', () => {
    const pieces = [
      { status: 'published' },
      { status: 'scheduled' },
    ]
    expect(deriveStoryStage({ status: 'completed' }, pieces)).toBe('scheduled')
  })

  it('returns review when any piece is in_review (and none scheduled)', () => {
    const pieces = [
      { status: 'published' },
      { status: 'in_review' },
      { status: 'draft' },
    ]
    expect(deriveStoryStage({ status: 'completed' }, pieces)).toBe('review')
  })

  it('returns drafting when pieces exist but none match published/scheduled/in_review buckets', () => {
    expect(deriveStoryStage({ status: 'completed' }, [{ status: 'draft' }])).toBe('drafting')
    expect(deriveStoryStage({ status: 'completed' }, [{ status: 'approved' }])).toBe('drafting')
    expect(deriveStoryStage({ status: 'completed' }, [{ status: 'draft' }, { status: 'approved' }])).toBe('drafting')
  })

  it('treats missing/null interview as capture (defensive)', () => {
    expect(deriveStoryStage(null, [])).toBe('capture')
    expect(deriveStoryStage(undefined, [{ status: 'published' }])).toBe('capture')
  })
})

describe('buildStories', () => {
  let warnSpy

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('returns [] when given zero clinicians', () => {
    expect(buildStories([], [])).toEqual([])
    expect(buildStories(null, null)).toEqual([])
    expect(buildStories(undefined, undefined)).toEqual([])
  })

  it('returns [] when clinicians exist but have no interviews', () => {
    const clinicians = [{ id: 'c1', name: 'Dr. A', interviews: [] }]
    expect(buildStories(clinicians, [])).toEqual([])
  })

  it('builds a story with empty pieces when interview has no content_items', () => {
    const clinicians = [{
      id: 'c1',
      name: 'Dr. A',
      workspace_id: 'ws1',
      interviews: [{
        id: 'iv1',
        workspace_id: 'ws1',
        topic: 'Knee health',
        status: 'completed',
        owner_id: 'u1',
        owner_email: 'u1@example.com',
        created_at: '2026-05-01T00:00:00Z',
        updated_at: '2026-05-02T00:00:00Z',
      }],
    }]
    const result = buildStories(clinicians, [])
    expect(result).toHaveLength(1)
    const s = result[0]
    expect(s.id).toBe('iv1')
    expect(s.workspace_id).toBe('ws1')
    expect(s.staff_id).toBe('c1')
    expect(s.staff_name).toBe('Dr. A')
    expect(s.topic).toBe('Knee health')
    expect(s.status).toBe('completed')
    expect(s.pieces).toEqual([])
    expect(s.pieces_count).toBe(0)
    expect(s.pieces_by_status).toEqual({
      draft: 0, in_review: 0, approved: 0, scheduled: 0, published: 0,
    })
    expect(s.story_stage).toBe('drafting')
    expect(s.next_scheduled_at).toBeNull()
    expect(s.last_activity_at).toBe('2026-05-02T00:00:00Z')
    expect(s.has_outputs).toBe(false)
  })

  it('rolls up multiple pieces under one interview', () => {
    const clinicians = [{
      id: 'c1',
      name: 'Dr. A',
      interviews: [{
        id: 'iv1',
        workspace_id: 'ws1',
        topic: 'Topic',
        status: 'completed',
        created_at: '2026-05-01T00:00:00Z',
        updated_at: '2026-05-02T00:00:00Z',
        outputs: { blog: '...' },
      }],
    }]
    const contentItems = [
      { id: 'p1', interview_id: 'iv1', workspace_id: 'ws1', platform: 'instagram', status: 'scheduled', scheduled_at: '2026-06-05T10:00:00Z', published_at: null, updated_at: '2026-05-03T00:00:00Z' },
      { id: 'p2', interview_id: 'iv1', workspace_id: 'ws1', platform: 'blog',      status: 'draft',     scheduled_at: null,                   published_at: null, updated_at: '2026-05-04T00:00:00Z' },
      { id: 'p3', interview_id: 'iv1', workspace_id: 'ws1', platform: 'facebook',  status: 'scheduled', scheduled_at: '2026-06-01T09:00:00Z', published_at: null, updated_at: '2026-05-03T00:00:00Z' },
    ]
    const [s] = buildStories(clinicians, contentItems)
    expect(s.pieces).toHaveLength(3)
    expect(s.pieces_count).toBe(3)
    expect(s.pieces_by_status.scheduled).toBe(2)
    expect(s.pieces_by_status.draft).toBe(1)
    expect(s.story_stage).toBe('scheduled')
    // Earliest scheduled_at across the pieces
    expect(s.next_scheduled_at).toBe('2026-06-01T09:00:00Z')
    // Max of interview.updated_at and piece updated_at values
    expect(s.last_activity_at).toBe('2026-05-04T00:00:00Z')
    expect(s.has_outputs).toBe(true)
  })

  it('emits one story per interview across multiple clinicians', () => {
    const clinicians = [
      { id: 'c1', name: 'Dr. A', interviews: [
        { id: 'iv1', status: 'completed', workspace_id: 'ws1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'iv2', status: 'in_progress', workspace_id: 'ws1', created_at: '2026-02-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' },
      ]},
      { id: 'c2', name: 'Dr. B', interviews: [
        { id: 'iv3', status: 'completed', workspace_id: 'ws1', created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
      ]},
    ]
    const contentItems = [
      { id: 'p1', interview_id: 'iv1', workspace_id: 'ws1', platform: 'instagram', status: 'published', scheduled_at: null, published_at: '2026-01-05T00:00:00Z', updated_at: '2026-01-05T00:00:00Z' },
    ]
    const stories = buildStories(clinicians, contentItems)
    expect(stories.map((s) => s.id)).toEqual(['iv1', 'iv2', 'iv3'])
    expect(stories.find((s) => s.id === 'iv1').story_stage).toBe('published')
    expect(stories.find((s) => s.id === 'iv2').story_stage).toBe('capture')
    expect(stories.find((s) => s.id === 'iv3').story_stage).toBe('drafting')
    expect(stories.find((s) => s.id === 'iv1').staff_name).toBe('Dr. A')
    expect(stories.find((s) => s.id === 'iv3').staff_name).toBe('Dr. B')
  })

  it('drops orphan content_items whose interview_id has no matching interview', () => {
    const clinicians = [{
      id: 'c1', name: 'Dr. A', interviews: [
        { id: 'iv1', status: 'completed', workspace_id: 'ws1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ],
    }]
    const contentItems = [
      { id: 'p1', interview_id: 'iv1', workspace_id: 'ws1', platform: 'instagram', status: 'draft', scheduled_at: null, published_at: null, updated_at: '2026-01-02T00:00:00Z' },
      { id: 'p-orphan', interview_id: 'iv-missing', workspace_id: 'ws1', platform: 'blog', status: 'draft', scheduled_at: null, published_at: null, updated_at: '2026-01-02T00:00:00Z' },
    ]
    const stories = buildStories(clinicians, contentItems)
    expect(stories).toHaveLength(1)
    expect(stories[0].pieces).toHaveLength(1)
    expect(stories[0].pieces[0].id).toBe('p1')
  })

  it('drops content_items whose workspace_id does not match the interview workspace_id and logs', () => {
    const clinicians = [{
      id: 'c1', name: 'Dr. A', interviews: [
        { id: 'iv1', status: 'completed', workspace_id: 'ws1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ],
    }]
    const contentItems = [
      { id: 'p-good', interview_id: 'iv1', workspace_id: 'ws1', platform: 'blog', status: 'draft', scheduled_at: null, published_at: null, updated_at: '2026-01-02T00:00:00Z' },
      { id: 'p-bad',  interview_id: 'iv1', workspace_id: 'ws-other', platform: 'blog', status: 'published', scheduled_at: null, published_at: '2026-01-03T00:00:00Z', updated_at: '2026-01-03T00:00:00Z' },
    ]
    const stories = buildStories(clinicians, contentItems)
    expect(stories).toHaveLength(1)
    expect(stories[0].pieces).toHaveLength(1)
    expect(stories[0].pieces[0].id).toBe('p-good')
    // The cross-workspace item must not influence stage either.
    expect(stories[0].story_stage).toBe('drafting')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('mismatched workspace_id')
  })
})
