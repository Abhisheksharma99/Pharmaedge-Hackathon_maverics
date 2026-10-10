import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { CardFilters, useCardFilter } from "@/components/card-filters";
import { InlineError } from "@/components/inline-error";
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
import { cn } from "@/lib/utils";
import { NoMatches } from "./no-matches";

const JOB_TYPE: Record<Job["type"], string> = {
  onboard: "onboarding",
  refresh: "refresh",
  competitor: "competitor crawl",
};

const STATUS_LABEL: Partial<Record<Job["status"], string>> = {
  completed: "Completed",
  completed_with_errors: "Completed with errors",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Home "Crawls" (README §5.2): the running crawl, live, and the last three finished jobs. */
export function CrawlsCard() {
  const running = useJobs({ status: "running" });
  const recent = useJobs({ limit: 10 });
  const live = running.data?.[0];
  const progress = useJobProgress(live?.id ?? null);
  const finishedAll = (recent.data ?? []).filter((j) => !isActive(j.status));
  const { filtered, filters } = useCardFilter(
    finishedAll,
    (j) => j.assetName ?? j.asset,
    [{ label: "Status", of: (j) => [STATUS_LABEL[j.status] ?? j.status] }],
  );
  const finished = filtered.slice(0, 3);
  const last = live ? undefined : finishedAll[0];
  const lastProgress = useJobProgress(last?.id ?? null);

  return (
    <Panel
      title="Crawls"
      description={
        live ? "Data collection running now" : "Nothing running right now"
      }
      actions={
        <Button asChild variant="ghost" size="sm" className="text-primary hover:bg-primary-soft hover:text-primary">
          <Link to="/jobs">All jobs</Link>
        </Button>
      }
      bodyClassName="flex flex-col gap-[4px] px-[16px] pt-[12px] pb-[10px]"
    >
      {live && <LiveJob job={live} progress={progress.data} />}
      {last && <LiveJob job={last} progress={lastProgress.data} done />}
      {recent.isPending && <Skeleton className="h-[36px] w-full" />}
      {recent.isError && (
        <InlineError message="Crawl jobs couldn't be loaded." onRetry={() => void recent.refetch()} className="p-[8px]" />
      )}
      {recent.data && !live && finishedAll.length === 0 && (
        <EmptyState title="No crawls yet">
          Add an asset to start collecting its data.
        </EmptyState>
      )}
      {finishedAll.length > 0 && (
        <CardFilters {...filters} placeholder="Search by asset" className="px-0 pt-[4px]" />
      )}
      {finishedAll.length > 0 && finished.length === 0 && <NoMatches what="crawls" />}
      {finished.length > 0 && (
        <ul>
          {finished.map((j) => (
            <li key={j.id}>
              <Link
                to={`/jobs/${encodeURIComponent(j.id)}`}
                className="flex items-center gap-[10px] rounded-lg px-[4px] py-[8px] text-[12.5px] transition-colors hover:bg-background"
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
      className={cn(
        "mb-[6px] flex flex-col gap-[10px] rounded-[12px] border px-[14px] py-[12px] transition-colors hover:border-primary",
        done ? "border-[#bfe3dd] bg-card" : "border-[#d5ddfa] bg-linear-to-b from-[#f6f8fe] to-card",
      )}
    >
      <span className="flex items-center gap-[10px]">
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
        <span className="flex gap-[16px] text-[12px] text-muted-foreground">
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
      <span className="inline-flex items-center gap-[4px] text-[12.5px] font-semibold text-primary">
        {done ? "Explore the journey" : "Watch the live build"}{" "}
        <ArrowRight className="size-[13px]" />
      </span>
    </Link>
  );
}
