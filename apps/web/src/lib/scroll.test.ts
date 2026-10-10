import { findScroller, offsetIn, scrollToTop, viewportHeight } from './scroll'

describe('scroll helpers', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('finds the nearest scrolling ancestor, else the document', () => {
    const outer = document.body.appendChild(document.createElement('main'))
    outer.style.overflowY = 'auto'
    const inner = outer.appendChild(document.createElement('div')).appendChild(document.createElement('section'))
    expect(findScroller(inner)).toBe(outer)
    const loose = document.body.appendChild(document.createElement('div'))
    expect(findScroller(loose)).toBe(document.documentElement)
    expect(viewportHeight(document.documentElement)).toBe(window.innerHeight)
  })

  it('scrolls with scrollTo when there is one, else sets scrollTop, never below 0', () => {
    const el = document.body.appendChild(document.createElement('div'))
    scrollToTop(el, 120.4, true)
    expect(el.scrollTop).toBe(120)
    scrollToTop(el, -50, false)
    expect(el.scrollTop).toBe(0)
    const scrollTo = vi.fn()
    Object.assign(el, { scrollTo })
    scrollToTop(el, 300, true)
    expect(scrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'smooth' })
    scrollToTop(el, 300, false)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 300, behavior: 'auto' })
  })

  it('measures an element in the scroller’s content coordinates', () => {
    const sc = document.body.appendChild(document.createElement('div'))
    const child = sc.appendChild(document.createElement('div'))
    sc.scrollTop = 40
    vi.spyOn(sc, 'getBoundingClientRect').mockReturnValue({ top: 56 } as DOMRect)
    vi.spyOn(child, 'getBoundingClientRect').mockReturnValue({ top: 156 } as DOMRect)
    expect(offsetIn(sc, child)).toBe(140)
  })
})
