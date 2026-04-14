-- Migration 4: Add resume file name and custom documents to interview_profiles
ALTER TABLE interview_profiles ADD COLUMN resume_file_name TEXT NOT NULL DEFAULT '';
ALTER TABLE interview_profiles ADD COLUMN documents_json TEXT NOT NULL DEFAULT '[]';
