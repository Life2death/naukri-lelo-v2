import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mock the database actions ─────────────────────────────────────────────────
const mockGetAllProfiles = vi.fn();
const mockCreateProfile = vi.fn();
const mockUpdateProfile = vi.fn();
const mockDeleteProfile = vi.fn();

vi.mock("@/lib", async (importOriginal) => {
  const orig = await importOriginal<any>();
  return {
    ...orig,
    getAllProfiles: (...args: any[]) => mockGetAllProfiles(...args),
    createProfile: (...args: any[]) => mockCreateProfile(...args),
    updateProfile: (...args: any[]) => mockUpdateProfile(...args),
    deleteProfile: (...args: any[]) => mockDeleteProfile(...args),
  };
});

import { useProfiles } from "@/hooks/useProfiles";
import type { InterviewProfile } from "@/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const NOW = 1_700_000_000_000;

const profileA: InterviewProfile = {
  id: "profile_1_aaa",
  name: "Senior React Engineer",
  resumeText: "5 years React",
  goals: "FAANG senior role",
  createdAt: NOW,
  updatedAt: NOW,
};

const profileB: InterviewProfile = {
  id: "profile_2_bbb",
  name: "Backend Dev",
  resumeText: "Node.js expert",
  goals: "Backend role at startup",
  createdAt: NOW,
  updatedAt: NOW,
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("useProfiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllProfiles.mockResolvedValue([]);
  });

  // ── Initial load ───────────────────────────────────────────────────────────
  it("starts with empty profiles and isLoading true, then resolves", async () => {
    mockGetAllProfiles.mockResolvedValueOnce([profileA, profileB]);
    const { result } = renderHook(() => useProfiles());

    // loading should start true
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profiles).toHaveLength(2);
    expect(result.current.profiles[0].id).toBe("profile_1_aaa");
  });

  it("sets profiles to empty array when DB returns nothing", async () => {
    mockGetAllProfiles.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profiles).toEqual([]);
  });

  it("sets profiles to empty array and does not throw when DB call fails", async () => {
    mockGetAllProfiles.mockRejectedValueOnce(new Error("DB error"));
    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profiles).toEqual([]);
  });

  // ── addProfile ─────────────────────────────────────────────────────────────
  it("adds a new profile and prepends it to the list", async () => {
    mockGetAllProfiles.mockResolvedValueOnce([profileA]);
    mockCreateProfile.mockImplementation((p: InterviewProfile) =>
      Promise.resolve(p)
    );

    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const fields = {
      name: "New Profile",
      resumeText: "some resume",
      goals: "some goal",
    };

    let returned: InterviewProfile | undefined;
    await act(async () => {
      returned = await result.current.addProfile(fields);
    });

    expect(mockCreateProfile).toHaveBeenCalledOnce();
    expect(result.current.profiles).toHaveLength(2);
    // new profile is prepended
    expect(result.current.profiles[0].name).toBe("New Profile");
    expect(returned?.name).toBe("New Profile");
  });

  it("generated profile has all required fields", async () => {
    mockGetAllProfiles.mockResolvedValueOnce([]);
    mockCreateProfile.mockImplementation((p: InterviewProfile) =>
      Promise.resolve(p)
    );

    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: InterviewProfile | undefined;
    await act(async () => {
      returned = await result.current.addProfile({
        name: "Test",
        resumeText: "resume",
        goals: "goal",
      });
    });

    expect(returned?.id).toMatch(/^profile_/);
    expect(typeof returned?.createdAt).toBe("number");
    expect(typeof returned?.updatedAt).toBe("number");
  });

  // ── editProfile ────────────────────────────────────────────────────────────
  it("updates an existing profile in state", async () => {
    mockGetAllProfiles.mockResolvedValueOnce([profileA]);
    mockUpdateProfile.mockImplementation((p: InterviewProfile) =>
      Promise.resolve(p)
    );

    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.editProfile(profileA.id, {
        name: "Updated Name",
        resumeText: profileA.resumeText,
        goals: profileA.goals,
      });
    });

    expect(mockUpdateProfile).toHaveBeenCalledOnce();
    expect(result.current.profiles[0].name).toBe("Updated Name");
    expect(result.current.profiles[0].id).toBe(profileA.id);
  });

  it("throws when editing an id that does not exist", async () => {
    mockGetAllProfiles.mockResolvedValueOnce([profileA]);
    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.editProfile("nonexistent-id", {
          name: "X",
          resumeText: "",
          goals: "",
        });
      })
    ).rejects.toThrow("Profile not found");
  });

  it("sets updatedAt to a newer value than createdAt after edit", async () => {
    mockGetAllProfiles.mockResolvedValueOnce([profileA]);
    mockUpdateProfile.mockImplementation((p: InterviewProfile) =>
      Promise.resolve(p)
    );

    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let updated: InterviewProfile | undefined;
    await act(async () => {
      updated = await result.current.editProfile(profileA.id, {
        name: profileA.name,
        resumeText: profileA.resumeText,
        goals: profileA.goals,
      });
    });

    expect(updated?.updatedAt).toBeGreaterThanOrEqual(profileA.updatedAt);
  });

  // ── removeProfile ──────────────────────────────────────────────────────────
  it("removes a profile from state", async () => {
    mockGetAllProfiles.mockResolvedValueOnce([profileA, profileB]);
    mockDeleteProfile.mockResolvedValueOnce(true);

    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profiles).toHaveLength(2);

    await act(async () => {
      await result.current.removeProfile(profileA.id);
    });

    expect(mockDeleteProfile).toHaveBeenCalledWith(profileA.id);
    expect(result.current.profiles).toHaveLength(1);
    expect(result.current.profiles[0].id).toBe(profileB.id);
  });

  // ── loadProfiles (manual refresh) ─────────────────────────────────────────
  it("loadProfiles refreshes state from DB", async () => {
    mockGetAllProfiles.mockResolvedValueOnce([]).mockResolvedValueOnce([profileA]);

    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profiles).toHaveLength(0);

    await act(async () => {
      await result.current.loadProfiles();
    });

    expect(result.current.profiles).toHaveLength(1);
  });
});
