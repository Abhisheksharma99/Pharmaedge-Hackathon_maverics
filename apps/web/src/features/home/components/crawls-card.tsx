import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetTile } from "@/features/assets/components/asset-tile";
import { EmptyState, Panel } from "@/features/assets/components/panel";
import {
  isActive,
  useJobProgress,
  useJobs,
  type Job,
} from "@/features/jobs/api";
import { StepBar } from "@/features/jobs/components/step-bar";
import { JobStatusBadge } from "@/features/jobs/jobs-pages";
import {
  jobDuration,
  jobProgress,
  jobStepLabel,
  stepsFinished,
} from "@/features/jobs/steps";
import type { JobProgress } from "@/features/journey/types";
import { formatNumber } from "@/lib/format";

const JOB_TYPE: Record<Job["type"], string> = {
  onboard: "onboarding",
  refresh: "refresh",
  competitor: "competitor crawl",
};

/** Home "Crawls" (README §5.2): the running crawl, live, and the last three finished jobs. */
export function CrawlsCard() {
  const running = useJobs({ status: "running" });
  const recent = useJobs({ limit: 10 });
  const live = running.data?.[0];
  const progress = useJobProgress(live?.id ?? null);
  const finished = (recent.data ?? [])
    .filter((j) => !isActive(j.status))
    .slice(0, 3);
  const last = live ? undefined : finished[0];
  const lastProgress = useJobProgress(last?.id ?? null);

  return (
    <Panel
      title="Crawls"
      description={
        live ? "Data collection running now" : "Nothing running right now"
      }
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to="/jobs">All jobs</Link>
        </Button>
      }
      bodyClassName="p-3"
    >
      {live && <LiveJob job={live} progress={progress.data} />}
      {last && <LiveJob job={last} progress={lastProgress.data} done />}
      {recent.isPending && <Skeleton className="h-9 w-full" />}
      {recent.isError && (
        <p className="p-2 text-destructive">Crawl jobs couldn't be loaded.</p>
      )}
      {recent.data && !live && finished.length === 0 && (
        <EmptyState title="No crawls yet">
          Add an asset to start collecting its data.
        </EmptyState>
      )}
      {finished.length > 0 && (
        <ul>
          {finished.map((j) => (
            <li key={j.id}>
              <Link
                to={`/jobs/${encodeURIComponent(j.id)}`}
                className="flex items-center gap-2.5 rounded-lg px-1 py-2 text-[12.5px] transition-colors hover:bg-background"
              >
                <JobStatusBadge status={j.status} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {j.assetName ?? j.asset}
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {j.type}
                  </span>
                </span>
                <span className="font-mono text-[11.5px] text-muted-foreground">
                  {jobDuration(j)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function LiveJob({
  job,
  progress,
  done = false,
}: {
  job: Job;
  progress?: JobProgress;
  done?: boolean;
}) {
  const j = progress ?? job;
  const n = j.steps.length;
  const label = jobStepLabel(j);
  const name = j.assetName ?? j.asset;
  const records = progress?.records.reduce((sum, r) => sum + r.count, 0) ?? 0;
  return (
    <Link
      to={`/assets/${encodeURIComponent(j.asset)}/overview${done ? "" : "?build=1"}`}
      className="mb-1.5 flex flex-col gap-2.5 rounded-xl border border-[#d5ddfa] bg-linear-to-b from-[#f6f8fe] to-card px-3.5 py-3 transition-colors hover:border-primary"
    >
      <span className="flex items-center gap-2.5">
        <AssetTile
          name={name}
          kind={j.type === "competitor" ? "competitor" : "primary"}
          size={26}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="font-semibold">
            {name} · {JOB_TYPE[j.type]}
          </b>
          <span className="truncate text-[12px] text-text-secondary">
            {done
              ? `Finished · ${formatNumber(progress?.events_created ?? 0)} events from ${formatNumber(records)} records`
              : label === "planning"
                ? `Planning ${n} steps`
                : `Step ${Math.min(n, stepsFinished(j) + 1)} of ${n} · ${label}`}
          </span>
        </span>
        <span className="font-mono text-[15px] font-semibold text-primary">
          {done ? 100 : Math.round(jobProgress(j) * 100)}%
        </span>
      </span>
      <StepBar steps={j.steps} />
      {progress && !done && (
        <span className="flex gap-4 text-[12px] text-muted-foreground">
          <span>
            <b className="font-semibold text-foreground tabular-nums">
              {formatNumber(records)}
            </b>{" "}
            records
          </span>
          <span>
            <b className="font-semibold text-foreground tabular-nums">
              {formatNumber(progress.events_created)}
            </b>{" "}
            events
          </span>
        </span>
      )}
      <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary">
        {done ? "Explore the journey" : "Watch the live build"}{" "}
        <ArrowRight className="size-[13px]" />
      </span>
    </Link>
  );
}
