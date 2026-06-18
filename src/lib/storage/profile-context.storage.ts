import { STORAGE_KEYS } from "@/config";

export interface ProfileContextSettings {
  maxContextChars: number;
  maxResumeChars: number;
  maxGoalsChars: number;
  maxDocChars: number;
  maxRefConvChars: number;
  maxRefConvs: number;
}

export const DEFAULT_PROFILE_CONTEXT_SETTINGS: ProfileContextSettings = {
  maxContextChars: 8000,
  maxResumeChars: 3000,
  maxGoalsChars: 2000,
  maxDocChars: 800,
  maxRefConvChars: 800,
  maxRefConvs: 1,
};

export const getProfileContextSettings = (): ProfileContextSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.PROFILE_CONTEXT_SETTINGS);
    if (!stored) {
      return DEFAULT_PROFILE_CONTEXT_SETTINGS;
    }
    const parsed = JSON.parse(stored);
    return {
      maxContextChars: parsed.maxContextChars ?? DEFAULT_PROFILE_CONTEXT_SETTINGS.maxContextChars,
      maxResumeChars: parsed.maxResumeChars ?? DEFAULT_PROFILE_CONTEXT_SETTINGS.maxResumeChars,
      maxGoalsChars: parsed.maxGoalsChars ?? DEFAULT_PROFILE_CONTEXT_SETTINGS.maxGoalsChars,
      maxDocChars: parsed.maxDocChars ?? DEFAULT_PROFILE_CONTEXT_SETTINGS.maxDocChars,
      maxRefConvChars: parsed.maxRefConvChars ?? DEFAULT_PROFILE_CONTEXT_SETTINGS.maxRefConvChars,
      maxRefConvs: parsed.maxRefConvs ?? DEFAULT_PROFILE_CONTEXT_SETTINGS.maxRefConvs,
    };
  } catch {
    return DEFAULT_PROFILE_CONTEXT_SETTINGS;
  }
};

export const setProfileContextSettings = (settings: ProfileContextSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.PROFILE_CONTEXT_SETTINGS, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
};
