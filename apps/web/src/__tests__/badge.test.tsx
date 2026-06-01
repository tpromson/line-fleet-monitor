import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from '../components/ui/badge'

describe('Badge', () => {
  it('renders with default variant', () => {
    render(<Badge>Active</Badge>)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders with custom variant', () => {
    render(<Badge variant="destructive">Error</Badge>)
    const el = screen.getByText('Error')
    expect(el).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(<Badge className="custom-class">Tag</Badge>)
    const el = screen.getByText('Tag')
    expect(el.className).toContain('custom-class')
  })

  it('renders as span by default', () => {
    render(<Badge>Tag</Badge>)
    const el = screen.getByText('Tag')
    expect(el.tagName).toBe('SPAN')
  })
})
