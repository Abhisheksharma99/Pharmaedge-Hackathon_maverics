import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InlineError } from './inline-error'

describe('InlineError', () => {
  it('announces the message as an alert and retries on "Try again"', async () => {
    const onRetry = vi.fn()
    render(<InlineError message="Assets couldn't be loaded." onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Assets couldn't be loaded.")
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('retries from the keyboard', async () => {
    const onRetry = vi.fn()
    render(<InlineError message="Nope" onRetry={onRetry} />)
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
