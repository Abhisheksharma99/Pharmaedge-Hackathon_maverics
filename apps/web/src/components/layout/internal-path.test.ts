import { internalPath } from './internal-path'

describe('internalPath', () => {
  it.each(['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '/\r/evil.com', 'javascript:alert(1)', 'https://evil.example/x', ''])(
    'rejects %j',
    (link) => expect(internalPath(link, 'http://localhost:5173')).toBeNull(),
  )
  it('returns in-app paths with the encoded focus intact', () => {
    const link = '/assets/trep/overview?focus=ai%3Atrep%3Ahttps%3A%2F%2Fx%3A0'
    expect(internalPath(link, 'http://localhost:5173')).toBe(link)
    expect(internalPath('/', 'http://localhost:5173')).toBe('/')
  })
})
