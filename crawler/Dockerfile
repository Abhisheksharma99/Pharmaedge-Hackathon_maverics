# Crawl service image (API and worker). Build from the repo root:
#   docker build -f crawler/Dockerfile .
FROM python:3.11-slim
WORKDIR /app
COPY crawler/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY crawler/ .
# The team's crawlers (repo-root packages) run as pipeline steps; see crawler/integrations/
COPY pubmed/ ./pubmed/
COPY clinicalTrialgov/ ./clinicalTrialgov/
COPY company_pr/ ./company_pr/
COPY conference/ ./conference/
COPY patent_intel/ ./patent_intel/
COPY ema/ ./ema/
COPY designations/ ./designations/
RUN useradd --create-home app && mkdir -p logs cache && chown -R app /app
USER app
EXPOSE 8100
CMD ["uvicorn", "service.api:app", "--host", "0.0.0.0", "--port", "8100"]
