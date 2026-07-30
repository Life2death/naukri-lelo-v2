import { emit } from "@tauri-apps/api/event";
import { getDatabase } from "./config";

/**
 * Shared app settings, stored in SQLite rather than localStorage.
 *
 * localStorage is partitioned by webview origin, and a dev build
 * (http://localhost:1420) and a production build (http://tauri.localhost) are
 * different origins — so anything kept there silently diverges between the
 * two builds. Both builds open the same SQLite file, so state stored here is
 * genuinely shared.
 *
 * Use this for state that points at a database record (which prompt is
 * selected, which profile is active). Genuinely machine-local or
 * origin-appropriate state — API keys, window geometry, theme — deliberately
 * stays in localStorage, which also keeps a dev build from spending the
 * production build's API credits.
 */

export const APP_SETTING_KEYS = {
  SELECTED_SYSTEM_PROMPT_ID: "selected_system_prompt_id",
  ACTIVE_PROFILE_ID: "active_profile_id",
} as const;

export type AppSettingKey =
  (typeof APP_SETTING_KEYS)[keyof typeof APP_SETTING_KEYS];

/** Broadcast so other windows can react to a settings change. */
export const APP_SETTING_CHANGED_EVENT = "app-setting-changed";

export async function getAppSetting(key: AppSettingKey): Promise<string | null> {
  try {
    const db = await getDatabase();
    const rows = await db.select<{ value: string | null }[]>(
      "SELECT value FROM app_settings WHERE key = ?",
      [key]
    );
    return rows.length > 0 ? rows[0].value : null;
  } catch (error) {
    console.error(`Failed to read app setting "${key}":`, error);
    return null;
  }
}

export async function setAppSetting(
  key: AppSettingKey,
  value: string | null
): Promise<void> {
  try {
    const db = await getDatabase();
    if (value === null) {
      await db.execute("DELETE FROM app_settings WHERE key = ?", [key]);
    } else {
      await db.execute(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [key, value]
      );
    }
    // Fire-and-forget: a failed notification must not fail the write.
    try {
      void Promise.resolve(
        emit(APP_SETTING_CHANGED_EVENT, { key, value })
      ).catch(() => {});
    } catch {
      // ignore
    }
  } catch (error) {
    console.error(`Failed to write app setting "${key}":`, error);
  }
}

/**
 * One-time lift of a value that used to live in localStorage.
 *
 * Returns the SQLite value when one exists. Otherwise it adopts whatever the
 * current origin's localStorage holds and writes it through, so an existing
 * install keeps its selection on first run after upgrading instead of
 * silently resetting to "nothing selected".
 *
 * The localStorage entry is intentionally left in place: the *other* build
 * may still be on an older version and reading it.
 */
export async function getAppSettingWithLocalStorageFallback(
  key: AppSettingKey,
  legacyLocalStorageKey: string
): Promise<string | null> {
  const stored = await getAppSetting(key);
  if (stored !== null) return stored;

  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(legacyLocalStorageKey);
  } catch {
    legacy = null;
  }

  if (legacy !== null && legacy !== "") {
    await setAppSetting(key, legacy);
    return legacy;
  }

  return null;
}
