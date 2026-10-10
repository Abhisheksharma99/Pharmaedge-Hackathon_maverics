import { viewPath } from './navigation'

describe('viewPath', () => {
  it('builds paths only from known parts: tabs, canvases, stories and cited records', () => {
    expect(viewPath({ assetId: 'trep', tab: 'patents' })).toBe('/assets/trep/patents')
    expect(viewPath({ assetId: 'trep', tab: 'not-a-tab' })).toBe('/assets/trep/overview')
    expect(viewPath({ assetId: 'trep', tab: 'canvas', canvasId: 'c 1' })).toBe('/assets/trep/canvas/c%201')
    expect(viewPath({ assetId: 'trep', tab: 'canvas', storyId: 's1' })).toBe('/assets/trep/canvas/story/s1')
    expect(viewPath({ assetId: 'trep', tab: 'regulatory', record: { tab: 'regulatory', key: 'fda:NDA021272&x=1' } }))
      .toBe('/assets/trep/regulatory?rtab=regulatory&record=fda%3ANDA021272%26x%3D1')
  })
})
