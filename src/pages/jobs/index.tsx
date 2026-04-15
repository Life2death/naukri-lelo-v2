import { useState, useCallback, useEffect } from "react";
import {
  Button,
  Input,
} from "@/components";
import { PageLayout } from "@/layouts";
import { useApp } from "@/contexts";
import {
  searchJobs,
  buildJobQuery,
  scoreJobWithAI,
  getJobProviderConfig,
  getProfileById,
} from "@/lib";
import { JobListing } from "@/types";
import {
  BriefcaseIcon,
  SearchIcon,
  Loader2Icon,
  ExternalLinkIcon,
  SparklesIcon,
  MapPinIcon,
  CalendarIcon,
  BuildingIcon,
  AlertCircleIcon,
  SettingsIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

// ─── Score badge ─────────────────────────────────────────────────────────────

const ScoreBadge = ({
  score,
  isScoring,
}: {
  score?: number;
  isScoring?: boolean;
}) => {
  if (isScoring) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2Icon className="h-3 w-3 animate-spin" />
        Scoring…
      </div>
    );
  }
  if (score === undefined) return null;

  const label =
    score >= 85
      ? "Excellent"
      : score >= 70
      ? "Good"
      : score >= 50
      ? "Fair"
      : "Low";

  const barColor =
    score >= 85
      ? "bg-green-500"
      : score >= 70
      ? "bg-blue-500"
      : score >= 50
      ? "bg-yellow-500"
      : "bg-muted-foreground";

  const textColor =
    score >= 85
      ? "text-green-600 dark:text-green-400"
      : score >= 70
      ? "text-blue-600 dark:text-blue-400"
      : score >= 50
      ? "text-yellow-600 dark:text-yellow-400"
      : "text-muted-foreground";

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={cn("text-xs font-semibold tabular-nums", textColor)}>
        {score}% · {label}
      </span>
    </div>
  );
};

// ─── Job card ─────────────────────────────────────────────────────────────────

const JobCard = ({ job }: { job: JobListing }) => (
  <div className="rounded-xl border border-border bg-card p-4 space-y-3 hover:border-primary/40 transition-colors">
    {/* Header row */}
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold leading-snug truncate">
          {job.title}
        </h3>
        {job.company && (
          <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
            <BuildingIcon className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{job.company}</span>
          </div>
        )}
      </div>
      <ScoreBadge score={job.matchScore} isScoring={job.isScoring} />
    </div>

    {/* Meta row */}
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {job.location && (
        <span className="flex items-center gap-1">
          <MapPinIcon className="h-3 w-3" />
          {job.location}
        </span>
      )}
      {job.via && (
        <span className="flex items-center gap-1">
          <ExternalLinkIcon className="h-3 w-3" />
          {job.via}
        </span>
      )}
      {job.postedAt && (
        <span className="flex items-center gap-1">
          <CalendarIcon className="h-3 w-3" />
          {job.postedAt}
        </span>
      )}
      {job.scheduleType && (
        <span className="rounded-sm bg-muted px-1 py-0.5 font-medium">
          {job.scheduleType}
        </span>
      )}
      {job.salary && (
        <span className="rounded-sm bg-primary/10 text-primary px-1 py-0.5 font-medium">
          {job.salary}
        </span>
      )}
    </div>

    {/* Snippet */}
    {job.snippet && (
      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
        {job.snippet}
      </p>
    )}

    {/* Actions */}
    <div className="flex gap-2 pt-1">
      <Button
        size="sm"
        variant="default"
        className="h-7 text-xs"
        onClick={() => job.url && window.open(job.url, "_blank")}
        disabled={!job.url}
      >
        <ExternalLinkIcon className="h-3 w-3" />
        Apply
      </Button>
    </div>
  </div>
);

// ─── Main page ────────────────────────────────────────────────────────────────

const Jobs = () => {
  const navigate = useNavigate();
  const { activeProfileId, selectedAIProvider, allAiProviders } = useApp();

  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("");
  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Pre-fill keywords from active profile goals
  useEffect(() => {
    if (!activeProfileId) return;
    getProfileById(activeProfileId).then((profile) => {
      if (profile?.goals) {
        // Use first line / first 80 chars of job description as keyword hint
        const firstLine = profile.goals.split("\n")[0].trim().substring(0, 80);
        if (firstLine) setKeywords(firstLine);
      }
    });
  }, [activeProfileId]);

  const handleSearch = useCallback(async () => {
    const config = getJobProviderConfig();
    if (!config) {
      setError(
        "No job discovery provider configured. Go to Dev Space → Job Discovery and add your Tavily or Serper API key."
      );
      return;
    }

    if (!keywords.trim()) {
      setError("Enter a job title or keywords to search.");
      return;
    }

    setIsSearching(true);
    setError(null);
    setHasSearched(true);
    setJobs([]);

    try {
      const query = buildJobQuery(keywords, location);
      const results = await searchJobs(config, query);
      // Show results immediately, then score in background
      setJobs(results.map((j) => ({ ...j, isScoring: false })));

      // Score asynchronously if we have a profile with a resume
      if (!activeProfileId) return;
      const profile = await getProfileById(activeProfileId);
      if (!profile?.resumeText) return;

      const provider = allAiProviders.find(
        (p) => p.id === selectedAIProvider.provider
      );
      if (!provider) return;

      // Score each job concurrently (cap at 10 to avoid rate limits)
      const toScore = results.slice(0, 10);

      // Mark all as scoring
      setJobs((prev) =>
        prev.map((j, i) => (i < 10 ? { ...j, isScoring: true } : j))
      );

      await Promise.allSettled(
        toScore.map(async (job) => {
          try {
            const score = await scoreJobWithAI(
              job,
              profile.resumeText,
              provider,
              selectedAIProvider
            );
            setJobs((prev) =>
              prev.map((j) =>
                j.id === job.id ? { ...j, matchScore: score, isScoring: false } : j
              )
            );
          } catch {
            setJobs((prev) =>
              prev.map((j) =>
                j.id === job.id ? { ...j, isScoring: false } : j
              )
            );
          }
        })
      );

      // Sort by score desc once all scored
      setJobs((prev) =>
        [...prev].sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1))
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Job search failed";
      setError(msg);
    } finally {
      setIsSearching(false);
    }
  }, [keywords, location, activeProfileId, allAiProviders, selectedAIProvider]);

  const hasProvider = !!getJobProviderConfig();

  return (
    <PageLayout
      title="Job Discovery"
      description="Search live job listings and score them against your profile resume."
      rightSlot={
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/dev-space")}
        >
          <SettingsIcon className="h-4 w-4" />
          Configure API
        </Button>
      }
    >
      {/* Provider warning */}
      {!hasProvider && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
          <AlertCircleIcon className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Job discovery not configured</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add a Tavily or Serper.dev API key in{" "}
              <button
                className="underline text-primary"
                onClick={() => navigate("/dev-space")}
              >
                Dev Space
              </button>{" "}
              to enable live job search. Both have generous free tiers.
            </p>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <BriefcaseIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Job title or keywords (e.g. Senior React Engineer)"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
        </div>
        <div className="relative sm:w-48">
          <MapPinIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Location (optional)"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
        </div>
        <Button
          onClick={handleSearch}
          disabled={isSearching || !keywords.trim()}
          className="sm:w-28"
        >
          {isSearching ? (
            <Loader2Icon className="h-4 w-4 animate-spin" />
          ) : (
            <SearchIcon className="h-4 w-4" />
          )}
          {isSearching ? "Searching…" : "Search"}
        </Button>
      </div>

      {/* Profile hint */}
      {activeProfileId && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 -mt-2">
          <SparklesIcon className="h-3 w-3" />
          Active profile detected — jobs will be automatically scored against
          your resume once results load.
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <AlertCircleIcon className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Results */}
      {hasSearched && !isSearching && jobs.length === 0 && !error && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No jobs found. Try different keywords or location.
        </p>
      )}

      {jobs.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {jobs.length} jobs found
            {activeProfileId ? " · scoring against your resume…" : ""}
          </p>
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!hasSearched && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="rounded-full bg-muted p-4">
            <BriefcaseIcon className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">Find your next role</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Search live job listings from LinkedIn, Naukri, Indeed and more.
              Your resume is used to score each result — no data ever leaves your
              device.
            </p>
          </div>
        </div>
      )}
    </PageLayout>
  );
};

export default Jobs;
