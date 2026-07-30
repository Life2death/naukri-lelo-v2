import { emit } from "@tauri-apps/api/event";
import { getDatabase } from "./config";
import { InterviewProfile, InterviewProfileDocument } from "@/types";

/**
 * Broadcast whenever a profile's contents change, so other windows can drop
 * cached copies. Profiles live in SQLite, not localStorage, so there is no
 * `storage` event to piggyback on — and `storage` isn't delivered between
 * Tauri webview windows anyway. Tauri emit/listen is the only channel that
 * actually crosses the Dashboard <-> overlay boundary.
 */
export const PROFILE_UPDATED_EVENT = "interview-profile-updated";

const announceProfileChange = (id: string) => {
  // Fire-and-forget: a failed (or absent, e.g. under test) event bus must
  // never fail the write that just succeeded.
  try {
    void Promise.resolve(emit(PROFILE_UPDATED_EVENT, { id })).catch(() => {});
  } catch {
    // ignore
  }
};

interface DbInterviewProfile {
  id: string;
  name: string;
  resume_text: string;
  resume_file_name: string;
  goals: string;
  documents_json: string;
  brief_text: string;
  created_at: number;
  updated_at: number;
}

function toProfile(row: DbInterviewProfile): InterviewProfile {
  let documents: InterviewProfileDocument[] = [];
  try {
    const parsed = JSON.parse(row.documents_json || "[]");
    documents = Array.isArray(parsed) ? parsed : [];
  } catch {
    documents = [];
  }
  return {
    id: row.id,
    name: row.name,
    resumeText: row.resume_text,
    resumeFileName: row.resume_file_name || "",
    goals: row.goals,
    documents,
    briefText: row.brief_text || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAllProfiles(): Promise<InterviewProfile[]> {
  const db = await getDatabase();
  const rows = await db.select<DbInterviewProfile[]>(
    "SELECT * FROM interview_profiles ORDER BY updated_at DESC"
  );
  return rows.map(toProfile);
}

export async function getProfileById(id: string): Promise<InterviewProfile | null> {
  const db = await getDatabase();
  const rows = await db.select<DbInterviewProfile[]>(
    "SELECT * FROM interview_profiles WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? toProfile(rows[0]) : null;
}

export async function createProfile(profile: InterviewProfile): Promise<InterviewProfile> {
  const db = await getDatabase();
  const documentsJson = JSON.stringify(profile.documents || []);
  await db.execute(
    "INSERT INTO interview_profiles (id, name, resume_text, resume_file_name, goals, documents_json, brief_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [profile.id, profile.name, profile.resumeText, profile.resumeFileName || "", profile.goals, documentsJson, profile.briefText || "", profile.createdAt, profile.updatedAt]
  );
  announceProfileChange(profile.id);
  return profile;
}

export async function updateProfile(profile: InterviewProfile): Promise<InterviewProfile> {
  const db = await getDatabase();
  const documentsJson = JSON.stringify(profile.documents || []);
  await db.execute(
    "UPDATE interview_profiles SET name = ?, resume_text = ?, resume_file_name = ?, goals = ?, documents_json = ?, brief_text = ?, updated_at = ? WHERE id = ?",
    [profile.name, profile.resumeText, profile.resumeFileName || "", profile.goals, documentsJson, profile.briefText || "", profile.updatedAt, profile.id]
  );
  announceProfileChange(profile.id);
  return profile;
}

export async function deleteProfile(id: string): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.execute("DELETE FROM interview_profiles WHERE id = ?", [id]);
  return result.rowsAffected > 0;
}
