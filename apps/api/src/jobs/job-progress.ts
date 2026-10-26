/** Live count of a running crawl step (the crawler writes it every few seconds; `at` is its heartbeat). */
export interface StepProgress {
  done: number;
  total: number | null;
  unit: string;
  note: string | null;
  at: Date | string;
}

interface StepLike {
  status: string;
  progress?: Partial<StepProgress> | null;
}

/** Share of a job done, 0–1: finished steps (done, failed or skipped), plus the running step's fraction when it reports a total. */
export function jobFraction(steps: StepLike[] | undefined): number {
  if (!steps?.length) return 0;
  const finished = steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length;
  const running = steps.find((s) => s.status === 'running')?.progress;
  const partial = running?.total ? Math.min(1, Math.max(0, (running.done ?? 0) / running.total)) : 0;
  return Math.min(1, (finished + partial) / steps.length);
}

/** Whole percent for the jobs endpoints. */
export const jobPercent = (steps: StepLike[] | undefined) => Math.round(jobFraction(steps) * 100);
