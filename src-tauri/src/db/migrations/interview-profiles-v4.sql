-- Migration 6: Add brief_text to interview_profiles
ALTER TABLE interview_profiles ADD COLUMN brief_text TEXT NOT NULL DEFAULT '';
