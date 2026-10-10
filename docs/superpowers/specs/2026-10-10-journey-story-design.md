# Journey Story — Design

**Date:** 2026-10-10
**Status:** Approved to build (owner asked to implement directly)
**Brief:** PharmaEdge hackathon slide "Asset Journey — What changed in an asset's evidence, and what does it mean?"
Outcomes: 1 journey reconstruction, 2 evidence evolution (new findings and corrections), 3 meaningful comparison,
4 analyst usefulness. "A good visual is worth at least a hundred words."

## 1. Decisions

- **AI-driven only.** The story appears when Asset AI builds it in answer to a question; nothing reveals on its own.
- **Visual language:** the team's journey board (`design/competitors-redesign/Timeline.dc.html` on branch
  `claude/design-optimization-vppjvy`): lanes per category, events sized by significance, dashed diamonds for
  upcoming milestones, approvals staircase, Today line, range buttons, inspector, chapters that zoom the timeline.
  Added for the brief: change badges (new / moved / removed), verification flags (unconfirmed / conflict), a
  comparison lane, the AI's "what it means" notes.
- **Built layer by layer in front of the user:** the tool streams layers as it builds them, the view animates each in.
- **Real data, real filters:** range, categories, significance, comparison asset; scrollable; every mark opens its
  evidence. No UI outside this feature changes.
- **Facts from data, words from the model:** layout, changes, checks and comparisons are computed deterministically;
  the model only names chapters and writes notes that must cite events of the story.

## 2. Data foundation (crawler, ingestion pipeline)

### 2.1 Change log — `journey_changes` (new collection)
Written where events are written, so every job records what changed.
`{_id, asset, event_id, origin, kind: added|changed|removed, field?, before?, after?, title, category, event_date,
at, baseline}`
- `replace_rule_events` (journey + finalize steps): compares this run's rule events with the stored ones:
  new id → `added`; watched field differs (`date`, `expected_date`, `type`, `significance`, `title`,
  `is_milestone`) → one `changed` per field; stale event deleted → `removed` (not when only its id spelling
  changed). `baseline: true` when the asset had no rule events before (first build: not a "change").
- `extract_events` (ai_events): each new AI event → `added`, `baseline: true` on the asset's first extraction.
- Events gain `first_seen` (set once).
- Idempotent ids (sha1 of asset, event, kind, field, after) so a retried step does not double-count.

### 2.2 Cross-source checks — `verification` on events (finalize step)
Pure module `crawler/journey/checks.py`, run in `finalize` after the rule rebuild:
- **Unconfirmed approval:** an AI-extracted `approval` / `label_expansion` (US or EU, past) with no regulator
  approval-type rule event in that region within ±45 days, while the asset has regulator approvals in that
  region → `{status: unconfirmed, note, against: nearest rule event}`. Matching ones → `confirmed`.
- **Conflicting dates:** `pdufa_date` / `regulatory_decision_expected` events within 120 days of each other with
  different dates → `{status: conflict, note, against}`.
- Cleared when no longer true. Slide figure conflicts stay on the slide records and are read by `get_changes`.

## 3. API (apps/api)

- `StoryService` (`assets/story.service.ts`), one computation used by the endpoint and the tools:
  `story(assetId, spec)` → `{asset, range{from,to,today}, approvals[], lanes[{category, events[]}], changes{developments,
  updates, checks, slides}, compare?{asset, events[], deltas[]}, chapters[]}`. Events carry `change` (latest
  non-baseline change) and `verification`. Chapters: computed boundaries (before first approval; each first
  approval of a new indication/region; the focus window `since`; ahead = upcoming milestones).
- `GET /assets/:id/story?from&to&since&category&significance&compare` (JWT, validated, cached by asset version).
- `GET /assets/:id/changes?since` (same `changes` block).
- Stories saved like canvases: `stories` collection (owner-private), `{spec, notes[], chapter_names}`;
  `GET /stories?asset`, `GET /stories/:id`, `DELETE /stories/:id`. The saved story re-reads live data for its spec.
- Asset AI tools:
  - `build_journey_story(asset_id, since?, from?, to?, category?, significance?, compare_with?, title?)` — computes
    the story, saves it, navigates to it, streams layers (`story_start`, `story_layer` × axis, approvals, lanes,
    events, changes, compare, chapters). Returns counts + change/check summaries with event refs for citation.
  - `get_changes(asset_id, since)` — developments, updates, checks, slide conflicts; every item citable.
  - `compare_journeys(asset_id, other_id)` — aligned milestones and deltas (first approval lag, phase-3 start,
    indications only one has, FDA vs EMA timing); citable.
  - `annotate_story(story_id, notes[{text ≤ 300, event_ids[1..6]}], chapter_names?)` — event ids must belong to the
    story; notes stream as `story_layer: notes` and are saved.
- System prompt: for "what changed / what does it mean / compare journeys / show the journey", build the story,
  then annotate it, then answer citing the same events.

## 4. Web (apps/web, canvas area only)

- `features/story/`: `StoryView` (lanes, staircase, Today, badges, comparison lane, notes, chapters, inspector),
  `live-store` for streamed layers, `api`. Canvas tab lists stories with the canvases; `/assets/:id/canvas/story/:storyId`.
- Filters on the story: range (All / focus window / last 3 years / upcoming / chapter), category chips with counts,
  significance (key / all), comparison on/off. Changing a filter re-reads `GET /assets/:id/story` with the story's
  spec + filters; AI notes stay pinned to their events.
- Layer animation: each layer enters with the team design's keyframes (`pe-draw`, `pe-pop`, `pe-rise`, `pe-grow`);
  live layers animate as they arrive; "Replay" re-runs the sequence; `prefers-reduced-motion` respected.
- Scrollable: the plot has a minimum width per year, scrolls horizontally, opens at the focus window; the inspector
  and chapters stay in view.

## 5. RAG and agent (follow-on sub-projects)

Evidence-sufficiency gate (abstention), reranker / parent-child / HyDE benchmark against the current baseline
(hit@8 0.988, recall@8 0.896, MRR 0.801), ColBERT/RAPTOR/GraphRAG documented; navigation to records and stories
from the full chat page; hardening and final report.

## 6. Testing

Crawler: change log (added/changed/removed/baseline/idempotent), checks (unconfirmed, confirmed, conflict, cleared)
with mongomock. API: story computation unit tests (lanes, approvals, chapters, changes, compare), e2e for endpoints,
tools streaming order, annotate validation, owner privacy. Web: StoryView rendering, filters → query, live layers,
inspector, reduced motion. Live: run on Treprostinil (PH-ILD conflict must be flagged), Selexipag vs Macitentan.
