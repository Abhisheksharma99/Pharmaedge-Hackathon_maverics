"""Corporate presentation intelligence - an isolated, resource-bounded subsystem.

company -> latest investor presentations (IR page, SEC fallback) -> safe download -> supervised worker process
(render, text, images, tables, vector charts) -> selective OpenAI vision -> validation -> artifacts + MongoDB.

Nothing in the rest of patent_intel imports this package except the optional API router; removing the package
(and that router line) leaves the patent/regulatory/FDA pipeline unchanged.
"""
