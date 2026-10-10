"""Stock impact of a drug's events: which listed companies own the drug's events, their daily prices, and how
each price moved after each event (measured, never claimed as caused by the event).

Ingestion (run_drug step `market`): ingest.collect -> drug_listings + market_prices.
Reads (API /v1/market/*): events of the selected drugs for one ticker + impact.measure on its prices.
Isolated like `presentations`: the patent/regulatory pipeline never depends on it.
"""
