-- Key/value store for app state that must be identical across every build
-- and window of the app.
--
-- Why this exists: localStorage is partitioned by origin in the webview, and
-- a dev build (http://localhost:1420) and a production build
-- (http://tauri.localhost) are different origins. Anything kept in
-- localStorage therefore silently diverges between the two, even though both
-- builds open the very same SQLite file (the DB path derives from the bundle
-- identifier, which is shared). That is why the system-prompt *library* and
-- the profile *records* stayed in sync while the active selection did not.
--
-- Selections like "which system prompt is active" are app state, not
-- per-origin browser state, so they belong here alongside the records they
-- point at.
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
);
