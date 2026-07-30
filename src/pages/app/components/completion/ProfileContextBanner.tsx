/**
 * Banner shown at the top of the overlay response panel that tells the
 * user which Interview Profile's resume/goals/documents are currently
 * being injected into the AI's system prompt.
 *
 * The actual injection happens inside useCompletion.ts via
 * buildProfileKnowledgeContext(); this component is purely informational
 * so the user always knows what context the AI sees.
 */
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { BriefcaseIcon, FileTextIcon, MessagesSquareIcon } from "lucide-react";
import { useApp } from "@/contexts";
import {
  getProfileById,
  getProfileRefConvIds,
  PROFILE_UPDATED_EVENT,
} from "@/lib";
import { InterviewProfile } from "@/types";

export const ProfileContextBanner = () => {
  const { activeProfileId } = useApp();
  const [profile, setProfile] = useState<InterviewProfile | null>(null);
  const [refConvCount, setRefConvCount] = useState<number>(0);
  // Forces a refetch when a profile is edited in another window. Profiles live
  // in SQLite, so there is no `storage` event to observe — and this banner
  // reports what the AI actually sees, so a stale "0 docs" here is actively
  // misleading.
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const fn = await listen(PROFILE_UPDATED_EVENT, () => {
          setReloadTick((tick) => tick + 1);
        });
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      } catch {
        // Non-fatal: the banner just won't live-update.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!activeProfileId) {
      setProfile(null);
      setRefConvCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const p = await getProfileById(activeProfileId);
        if (cancelled) return;
        setProfile(p);
        setRefConvCount(getProfileRefConvIds(activeProfileId).length);
      } catch {
        if (!cancelled) {
          setProfile(null);
          setRefConvCount(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, reloadTick]);

  // Nothing to show when no profile is active — the AI just uses the
  // selected System Prompt (or the default) on its own.
  if (!profile) return null;

  const docCount = profile.documents.length;
  const hasResume = !!profile.resumeText.trim();
  const hasGoals = !!profile.goals.trim();

  return (
    <div
      className="flex items-center gap-2 px-4 py-1.5 border-b bg-primary/8 text-[11px]"
      title="The AI receives your selected System Prompt PLUS this profile's resume, goals and reference docs as context."
    >
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 flex-shrink-0">
        <BriefcaseIcon className="h-3 w-3 text-primary" />
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        <span className="font-medium text-primary truncate">
          Answering as <strong>{profile.name}</strong>
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {hasResume && <span title="Resume is included">resume</span>}
          {hasResume && (hasGoals || docCount > 0) && (
            <span className="text-muted-foreground/40">+</span>
          )}
          {hasGoals && <span title="Target role / job description">goals</span>}
          {(hasResume || hasGoals) && docCount > 0 && (
            <span className="text-muted-foreground/40">+</span>
          )}
          {docCount > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <FileTextIcon className="h-2.5 w-2.5" />
              {docCount} doc{docCount !== 1 ? "s" : ""}
            </span>
          )}
          {refConvCount > 0 && (
            <>
              <span className="text-muted-foreground/40">+</span>
              <span className="inline-flex items-center gap-0.5">
                <MessagesSquareIcon className="h-2.5 w-2.5" />
                {refConvCount} ref conv{refConvCount !== 1 ? "s" : ""}
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  );
};
