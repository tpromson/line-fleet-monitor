import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatCard } from '../components/stat-card'

describe('StatCard', () => {
  it('renders value and label', () => {
    render(<StatCard icon={<span>icon</span>} value="500" label="Quota Used" />)
    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.getByText('Quota Used')).toBeInTheDocument()
  })

  it('renders label when provided', () => {
    render(<StatCard icon={<span>icon</span>} value="500" label="Monthly limit" />)
    expect(screen.getByText('Monthly limit')).toBeInTheDocument()
  })

  it('renders icon', () => {
    render(<StatCard icon={<span data-testid="icon">icon</span>} value="500" label="Label" />)
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('applies warn styling when warn is true', () => {
    render(<StatCard icon={<span>icon</span>} value="500" label="Label" warn />)
    const valueEl = screen.getByText('500')
    expect(valueEl.className).toContain('text-destructive')
  })
})
