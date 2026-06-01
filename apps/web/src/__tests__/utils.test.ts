import { describe, it, expect } from 'vitest'
import { cn } from '../lib/utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('filters falsy values', () => {
    expect(cn('foo', false, undefined, null, 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('base', true && 'active', false && 'hidden')).toBe('base active')
  })

  it('resolves tailwind conflicts via twMerge', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })

  it('returns empty string for no inputs', () => {
    expect(cn()).toBe('')
  })
})
