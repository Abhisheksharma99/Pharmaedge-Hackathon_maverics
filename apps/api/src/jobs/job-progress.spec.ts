import { jobFraction, jobPercent } from './job-progress.js';

const step = (status: string, progress?: { done: number; total: number | null }) => ({ status, progress });

describe('job progress', () => {
  it('counts finished steps, whatever their outcome', () => {
    expect(jobFraction([step('done'), step('failed'), step('skipped'), step('pending')])).toBe(0.75);
    expect(jobFraction([])).toBe(0);
    expect(jobFraction(undefined)).toBe(0);
  });

  it("adds the running step's fraction when it reports a total", () => {
    const steps = [step('done'), step('running', { done: 500, total: 1000 }), step('pending'), step('pending')];
    expect(jobFraction(steps)).toBe(1.5 / 4);
    expect(jobPercent(steps)).toBe(38);
  });

  it('adds nothing for a running step without a total, and never passes the step', () => {
    expect(jobFraction([step('done'), step('running', { done: 1240, total: null })])).toBe(0.5);
    expect(jobFraction([step('done'), step('running', { done: 12, total: 10 })])).toBe(1);
    expect(jobFraction([step('done'), step('running')])).toBe(0.5);
  });
});
