-- Migration 5: Add first_name and persona_text to interview_profiles
ALTER TABLE interview_profiles ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE interview_profiles ADD COLUMN persona_text TEXT NOT NULL DEFAULT '';
