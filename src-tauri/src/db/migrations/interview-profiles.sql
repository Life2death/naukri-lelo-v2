-- Create interview_profiles table
CREATE TABLE IF NOT EXISTS interview_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    resume_text TEXT NOT NULL DEFAULT '',
    goals TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_interview_profiles_updated_at ON interview_profiles(updated_at DESC);
