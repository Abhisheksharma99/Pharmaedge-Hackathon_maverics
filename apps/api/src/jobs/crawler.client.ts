import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

export type JobType = 'refresh' | 'onboard' | 'competitor';

const describe = (err: unknown) => {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  return `${e.name ?? 'Error'}: ${e.cause?.code ?? e.cause?.message ?? e.message ?? String(err)}`;
};

/** HTTP client for the internal Python crawl service (spec §2: resolve an asset, start or cancel a job). */
@Injectable()
export class CrawlerClient {
  private readonly logger = new Logger(CrawlerClient.name);
  private readonly baseUrl: string;
  private readonly key: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('CRAWLER_API_URL', { infer: true }).replace(/\/$/, '');
    this.key = config.get('CRAWLER_SERVICE_KEY', { infer: true });
  }

  createJob(body: { asset_id: string; type: JobType; steps?: string[]; requested_by: { id: string; name: string } }) {
    return this.post<Record<string, unknown>>('/jobs', body);
  }

  /** Identity card for a drug name (FDA, EMA, ClinicalTrials.gov + AI); takes 10-60 s. */
  resolve(query: string) {
    return this.post<Record<string, unknown>>('/resolve', { query }, 120_000);
  }

  cancelJob(jobId: string) {
    return this.post<Record<string, unknown>>(`/jobs/${encodeURIComponent(jobId)}/cancel`, {});
  }

  private async post<T>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
    const send = () =>
      fetch(this.baseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Service-Key': this.key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    let res: Response;
    try {
      res = await send().catch(async (err: unknown) => {
        // A dropped or refused connection usually works on a second try; a timeout wouldn't, so it isn't retried.
        // Starting a job twice is harmless: the service refuses a second active job for the same asset.
        if ((err as { name?: string }).name === 'TimeoutError') throw err;
        this.logger.warn(`POST ${path} failed (${describe(err)}); retrying once`);
        await new Promise((r) => setTimeout(r, 1000));
        return send();
      });
    } catch (err) {
      this.logger.error(`POST ${path} failed: ${describe(err)}`);
      throw new ServiceUnavailableException({
        code: 'CRAWLER_UNAVAILABLE',
        message: 'The data collection service is unavailable. Try again shortly.',
      });
    }
    const json = (await res.json().catch(() => ({}))) as { detail?: { code?: string; message?: string } };
    if (!res.ok) {
      // FastAPI wraps errors in `detail`; pass the service's code/message through.
      const detail = json.detail ?? {};
      if (res.status >= 500 || res.status === 401) {
        this.logger.error(`POST ${path} answered ${res.status}`);
        throw new ServiceUnavailableException({ code: 'CRAWLER_UNAVAILABLE', message: 'The data collection service failed.' });
      }
      throw new HttpException({ code: detail.code ?? 'CRAWLER_ERROR', message: detail.message ?? 'Request failed', ...detail }, res.status);
    }
    return json as T;
  }
}
