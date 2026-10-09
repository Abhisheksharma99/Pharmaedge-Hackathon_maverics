import { readNdjson } from './ndjson'

const encoder = new TextEncoder()

function streamOf(...chunks: (string | Uint8Array)[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out: unknown[] = []
  for await (const value of readNdjson(stream)) out.push(value)
  return out
}

describe('readNdjson', () => {
  it('joins lines split across chunks', async () => {
    const values = await collect(streamOf('{"type":"tok', 'en","text":"a"}\n{"type":', '"done"}\n'))
    expect(values).toEqual([{ type: 'token', text: 'a' }, { type: 'done' }])
  })

  it('reads a trailing line without a newline and skips blank lines', async () => {
    expect(await collect(streamOf('{"a":1}\n\n{"b":2}'))).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('keeps multi-byte characters split between chunks', async () => {
    const bytes = encoder.encode('{"text":"é"}\n')
    const cut = bytes.indexOf(0xc3) + 1 // inside the two-byte "é"
    expect(await collect(streamOf(bytes.slice(0, cut), bytes.slice(cut)))).toEqual([{ text: 'é' }])
  })
})
