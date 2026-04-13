import { getDatabase } from "./config";
import { InterviewProfile } from "@/types";

interface DbInterviewProfile {
  id: string;
  name: string;
  resume_text: string;
  goals: string;
  created_at: number;
  updated_at: number;
}

function toProfile(row: DbInterviewProfile): InterviewProfile {
  return {
    id: row.id,
    name: row.name,
    resumeText: row.resume_text,
    goals: row.goals,
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
  await db.execute(
    "INSERT INTO interview_profiles (id, name, resume_text, goals, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [profile.id, profile.name, profile.resumeText, profile.goals, profile.createdAt, profile.updatedAt]
  );
  return profile;
}

export async function updateProfile(profile: InterviewProfile): Promise<InterviewProfile> {
  const db = await getDatabase();
  await db.execute(
    "UPDATE interview_profiles SET name = ?, resume_text = ?, goals = ?, updated_at = ? WHERE id = ?",
    [profile.name, profile.resumeText, profile.goals, profile.updatedAt, profile.id]
  );
  return profile;
}

export async function deleteProfile(id: string): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.execute("DELETE FROM interview_profiles WHERE id = ?", [id]);
  return result.rowsAffected > 0;
}
