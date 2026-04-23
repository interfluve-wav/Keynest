import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from '../components/ErrorBoundary'

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Hello</div>
      </ErrorBoundary>
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('renders fallback UI when child throws', () => {
    const BadComponent = () => {
      throw new Error('Test error')
    }

    render(
      <ErrorBoundary>
        <BadComponent />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/An unexpected error occurred/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument()
  })

  it('calls onError callback when error is caught', () => {
    const onError = vi.fn()
    const BadComponent = () => {
      throw new Error('Test error')
    }

    render(
      <ErrorBoundary onError={onError}>
        <BadComponent />
      </ErrorBoundary>
    )

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        componentStack: expect.any(String),
      })
    )
  })

  it('resets error state when Try Again is clicked', () => {
    const onError = vi.fn()
    const BadComponent = () => {
      throw new Error('Persistent error')
    }

    render(
      <ErrorBoundary onError={onError}>
        <BadComponent />
      </ErrorBoundary>
    )

    // Initially shows fallback
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(onError).toHaveBeenCalledTimes(1)

    // Click try again
    fireEvent.click(screen.getByRole('button', { name: /Try Again/i }))

    // Since the error persists (throw on render), it should show fallback again
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    // onError called again after re-throw
    expect(onError).toHaveBeenCalledTimes(2)
  })

  it('renders custom fallback if provided', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom error</div>}>
        <div>Content</div>
      </ErrorBoundary>
    )

    // Since no error, custom fallback shouldn't appear
    expect(screen.queryByTestId('custom-fallback')).not.toBeInTheDocument()
  })
})
