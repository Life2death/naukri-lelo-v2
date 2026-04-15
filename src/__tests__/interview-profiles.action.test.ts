import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock plugin-sql ────────────────────────────────────────────────────────────
// (setup.ts provides a base mock; we override per-test to control DB state)
const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: vi.fn(() =>
      Promise.resolve({ execute: mockExecute, select: mockSelect })
    ),
  },
}));

import {
  getAllProfiles,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,
} from "@/lib/database/interview-profiles.action";
import type { InterviewProfile } from "@/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const NOW = 1_700_000_000_000;

const dbRow = {
  id: "profile_1_abc",
  name: "Senior React Engineer",
  first_name: "",
  persona_text: "",
  resume_text: "5 years React experience",
  resume_file_name: "resume.pdf",
  goals: "Land a senior role at a FAANG company",
  documents_json: '[{"name":"cover.pdf","text":"Cover letter text"}]',
  created_at: NOW,
  updated_at: NOW,
};

const expectedProfile: InterviewProfile = {
  id: "profile_1_abc",
  name: "Senior React Engineer",
  firstName: "", persona: "", resumeText: "5 years React experience",
  resumeFileName: "resume.pdf",
  goals: "Land a senior role at a FAANG company",
  documents: [{ name: "cover.pdf", text: "Cover letter text" }],
  createdAt: NOW,
  updatedAt: NOW,
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("interview-profiles.action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset DB singleton so each test gets fresh state
    vi.resetModules();
  });

  // ── getAllProfiles ─────────────────────────────────────────────────────────
  describe("getAllProfiles", () => {
    it("returns an empty array when the table is empty", async () => {
      mockSelect.mockResolvedValueOnce([]);
      const result = await getAllProfiles();
      expect(result).toEqual([]);
    });

    it("maps snake_case DB columns to camelCase profile fields", async () => {
      mockSelect.mockResolvedValueOnce([dbRow]);
      const result = await getAllProfiles();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expectedProfile);
    });

    it("maps multiple rows correctly", async () => {
      const row2 = { ...dbRow, id: "profile_2_xyz", name: "Backend Dev", documents_json: "[]" };
      mockSelect.mockResolvedValueOnce([dbRow, row2]);
      const result = await getAllProfiles();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("profile_1_abc");
      expect(result[1].id).toBe("profile_2_xyz");
    });

    it("falls back to empty documents array on invalid documents_json", async () => {
      const rowBad = { ...dbRow, documents_json: "not-valid-json" };
      mockSelect.mockResolvedValueOnce([rowBad]);
      const result = await getAllProfiles();
      expect(result[0].documents).toEqual([]);
    });
  });

  // ── getProfileById ─────────────────────────────────────────────────────────
  describe("getProfileById", () => {
    it("returns null when no profile matches the id", async () => {
      mockSelect.mockResolvedValueOnce([]);
      const result = await getProfileById("nonexistent");
      expect(result).toBeNull();
    });

    it("returns the matching profile", async () => {
      mockSelect.mockResolvedValueOnce([dbRow]);
      const result = await getProfileById("profile_1_abc");
      expect(result).toEqual(expectedProfile);
    });

    it("passes the id as a query parameter", async () => {
      mockSelect.mockResolvedValueOnce([dbRow]);
      await getProfileById("profile_1_abc");
      expect(mockSelect).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = ?"),
        ["profile_1_abc"]
      );
    });
  });

  // ── createProfile ──────────────────────────────────────────────────────────
  describe("createProfile", () => {
    it("calls execute with correct INSERT statement", async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });
      await createProfile(expectedProfile);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO interview_profiles"),
        [
          expectedProfile.id,
          expectedProfile.name,
          expectedProfile.firstName,
          expectedProfile.persona,
          expectedProfile.resumeText,
          expectedProfile.resumeFileName,
          expectedProfile.goals,
          JSON.stringify(expectedProfile.documents),
          expectedProfile.createdAt,
          expectedProfile.updatedAt,
        ]
      );
    });

    it("returns the profile that was passed in", async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });
      const result = await createProfile(expectedProfile);
      expect(result).toEqual(expectedProfile);
    });
  });

  // ── updateProfile ──────────────────────────────────────────────────────────
  describe("updateProfile", () => {
    it("calls execute with UPDATE and correct fields", async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });
      const updated = { ...expectedProfile, name: "Staff Engineer", updatedAt: NOW + 1000 };
      await updateProfile(updated);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE interview_profiles"),
        [
          updated.name,
          updated.firstName,
          updated.persona,
          updated.resumeText,
          updated.resumeFileName,
          updated.goals,
          JSON.stringify(updated.documents),
          updated.updatedAt,
          updated.id,
        ]
      );
    });

    it("returns the updated profile", async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });
      const updated = { ...expectedProfile, name: "Staff Engineer" };
      const result = await updateProfile(updated);
      expect(result).toEqual(updated);
    });
  });

  // ── deleteProfile ──────────────────────────────────────────────────────────
  describe("deleteProfile", () => {
    it("returns true when a row is deleted", async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });
      const result = await deleteProfile("profile_1_abc");
      expect(result).toBe(true);
    });

    it("returns false when no row matches", async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 0 });
      const result = await deleteProfile("nonexistent");
      expect(result).toBe(false);
    });

    it("passes the id to the DELETE query", async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });
      await deleteProfile("profile_1_abc");
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM interview_profiles"),
        ["profile_1_abc"]
      );
    });
  });
});
