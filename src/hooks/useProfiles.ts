import { useState, useEffect, useCallback } from "react";
import {
  getAllProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
} from "@/lib";
import { InterviewProfile } from "@/types";

function generateProfileId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `profile_${timestamp}_${random}`;
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<InterviewProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadProfiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getAllProfiles();
      setProfiles(data);
    } catch (error) {
      console.error("Failed to load profiles:", error);
      setProfiles([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const addProfile = useCallback(
    async (fields: { name: string; resumeText: string; goals: string }) => {
      const now = Date.now();
      const profile: InterviewProfile = {
        id: generateProfileId(),
        name: fields.name,
        resumeText: fields.resumeText,
        goals: fields.goals,
        createdAt: now,
        updatedAt: now,
      };
      await createProfile(profile);
      setProfiles((prev) => [profile, ...prev]);
      return profile;
    },
    []
  );

  const editProfile = useCallback(
    async (
      id: string,
      fields: { name: string; resumeText: string; goals: string }
    ) => {
      const existing = profiles.find((p) => p.id === id);
      if (!existing) throw new Error("Profile not found");
      const updated: InterviewProfile = {
        ...existing,
        ...fields,
        updatedAt: Date.now(),
      };
      await updateProfile(updated);
      setProfiles((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return updated;
    },
    [profiles]
  );

  const removeProfile = useCallback(async (id: string) => {
    await deleteProfile(id);
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { profiles, isLoading, loadProfiles, addProfile, editProfile, removeProfile };
}
