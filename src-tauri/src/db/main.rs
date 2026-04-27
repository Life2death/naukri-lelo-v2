use tauri_plugin_sql::{Migration, MigrationKind};

/// Returns all database migrations
pub fn migrations() -> Vec<Migration> {
    vec![
        // Migration 1: Create system_prompts table with indexes and triggers
        Migration {
            version: 1,
            description: "create_system_prompts_table",
            sql: include_str!("migrations/system-prompts.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 2: Create chat history tables (conversations and messages)
        Migration {
            version: 2,
            description: "create_chat_history_tables",
            sql: include_str!("migrations/chat-history.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 3: Create interview profiles table
        Migration {
            version: 3,
            description: "create_interview_profiles_table",
            sql: include_str!("migrations/interview-profiles.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 4: Add resume_file_name and documents_json to interview_profiles
        Migration {
            version: 4,
            description: "add_resume_file_and_documents_to_profiles",
            sql: include_str!("migrations/interview-profiles-v2.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 5: Add first_name and persona_text to interview_profiles
        Migration {
            version: 5,
            description: "add_first_name_and_persona_to_profiles",
            sql: include_str!("migrations/interview-profiles-v3.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
