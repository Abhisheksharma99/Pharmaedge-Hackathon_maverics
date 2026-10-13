import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALLOWED_DOMAINS } from './web-search.service.js';

// The crawler keeps its own copy of the web-search allow-list (crawler/journey/feedback.py, WEB_ALLOW_LIST):
// the two must name the same domains, or a team note's web evidence would be judged against a different list.
const FEEDBACK_PY = fileURLToPath(
  new URL('../../../../crawler/journey/feedback.py', import.meta.url),
);

/** The string items of the Python tuple `WEB_ALLOW_LIST = (...)`. */
function crawlerAllowList(source: string): string[] {
  const tuple = /^WEB_ALLOW_LIST\s*=\s*\(([^)]*)\)/m.exec(source);
  if (!tuple) throw new Error(`WEB_ALLOW_LIST not found in ${FEEDBACK_PY}`);
  return [...tuple[1]!.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!);
}

describe('web-search allow-list', () => {
  it('parses a Python tuple, one or many lines', () => {
    expect(
      crawlerAllowList(
        'X = 1\nWEB_ALLOW_LIST = (\n    "a.gov",\n    \'b.eu\',  # note\n)\n',
      ),
    ).toEqual(['a.gov', 'b.eu']);
  });

  it("matches the crawler's WEB_ALLOW_LIST", () => {
    const crawler = crawlerAllowList(readFileSync(FEEDBACK_PY, 'utf8'));
    expect([...crawler].sort()).toEqual([...ALLOWED_DOMAINS].sort());
    expect(new Set(crawler).size).toBe(crawler.length);
  });
});
