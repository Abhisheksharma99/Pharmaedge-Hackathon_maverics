# Overview analytics: implementation notes

The prototype pins analytics cards to each asset's Overview tab. Users can add cards from three places:

1. **From your data**: templates computed directly from records already in Mongo (trials, regulatory, patents, journey events). No AI is involved.
2. **Suggested by AI**: Asset AI proposes analyses that fit the asset, and labels each one by where its data would come from.
3. **Ask for an analysis**: free text, e.g. "time from Phase 3 start to approval per indication".

## Pipeline for AI-built analytics

```
request ─▶ 1. index search ─▶ enough? ──yes──▶ 3. extract values ─▶ 4. chart spec ─▶ user review ─▶ pin
                              │
                              no
                              ▼
                    2. public web search (allow-listed domains) ─▶ 3 …
```

1. **Index search (no re-crawl).** Query the existing vector index (`index` step, ~1.2k passages per asset) plus structured collections. Return the matched passages and record keys.
2. **Web fallback.** Only when coverage is insufficient. Use a simple web search tool restricted to public, citable sources: fda.gov / open.fda.gov, ema.europa.eu, clinicaltrials.gov, pubmed, sec.gov (10-K/10-Q), and company IR. Store every fetched page as a record (`web_records`) so it's indexed for next time.
3. **Extract.** The LLM returns rows `{label, value, unit, date?, source_key}`. Reject any row without a source.
4. **Chart spec.** Pick one of the existing chart types (bars, horizontal bars, stacked bars, donut, gantt, heat, list) and return `{title, chart, data, sources[], method: 'index' | 'web' | 'none', note?}`.
5. **Review.** Show the chart with its sources before pinning. If neither the index nor public sources can answer (e.g. prescription share needs IQVIA), say so and suggest an alternative.

## Storage

- `asset_analytics`: `{asset, user, items: [{key} | {custom: spec}]}`, per user. Shared team boards come later.
- Custom specs keep `sources[]` and a `refreshed_at` timestamp. Index-based cards recompute after each crawl. Web-based cards re-run only when requested.

## Suggested-analytics heuristics

| Suggest when | Analytic | Source |
|---|---|---|
| ≥2 programmes with a pivotal start and a decision | Time from Phase 3 start to approval | index |
| ≥3 label supplements | Label evolution by indication | index |
| Competitors have dated milestones | Competitor milestone calendar | index |
| Marketed product, company files with the SEC | Net revenue by product | web (10-K) |
| Marketed product | FAERS adverse-event reports over time | web (openFDA) |
| Commercial share asked | Prescription share | limited (licensed data) |
