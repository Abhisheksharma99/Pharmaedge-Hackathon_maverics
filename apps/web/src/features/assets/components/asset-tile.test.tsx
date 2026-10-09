import { render } from '@testing-library/react'
import { AssetTile } from './asset-tile'

describe('AssetTile', () => {
  it('shows two letters sized from the tile, primary on primary-soft', () => {
    const { container } = render(<AssetTile name="treprostinil" kind="primary" size={36} />)
    const tile = container.firstElementChild as HTMLElement
    expect(tile).toHaveTextContent('Tr')
    expect(tile).toHaveClass('bg-primary-soft', 'text-primary')
    expect(tile).toHaveStyle({ width: '36px', height: '36px', fontSize: '15px' })
    expect(tile).toHaveAttribute('aria-hidden', 'true')
  })

  it('mutes competitors and skips punctuation', () => {
    const { container } = render(<AssetTile name="(S)-Yutrepia" kind="competitor" />)
    const tile = container.firstElementChild as HTMLElement
    expect(tile).toHaveTextContent('Sy')
    expect(tile).toHaveClass('bg-muted', 'text-text-secondary')
  })
})
