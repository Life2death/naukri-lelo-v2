// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod activate;
mod api;
mod capture;
mod db;
mod shortcuts;
mod window;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_posthog::{init as posthog_init, PostHogConfig, PostHogOptions};
use tokio::task::JoinHandle;
mod speaker;
use capture::CaptureState;
use speaker::VadConfig;

#[cfg(target_os = "macos")]
#[allow(deprecated)]
use tauri_nspanel::{cocoa::appkit::NSWindowCollectionBehavior, panel_delegate, WebviewWindowExt};

#[derive(Default)]
pub struct AudioState {
    stream_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    vad_config: Arc<Mutex<VadConfig>>,
    is_capturing: Arc<Mutex<bool>>,
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Panic hook: if the app crashes, write the reason to a file before exiting
    std::panic::set_hook(Box::new(|panic_info| {
        let msg = format!(
            "Naukri Lelo crashed at {:?}\n\n{}\n\nPlease report at:\nhttps://github.com/Life2death/naukri-lelo-v2/issues",
            std::time::SystemTime::now(),
            panic_info
        );
        let _ = std::fs::write(
            std::env::temp_dir().join("naukri-lelo-crash.txt"),
            &msg,
        );
    }));

    // Startup diagnostic: step 1 — binary is executing
    let _ = std::fs::write(
        std::env::temp_dir().join("naukri-lelo-startup.txt"),
        format!("step1: Naukri Lelo v{} binary started", env!("CARGO_PKG_VERSION")),
    );

    // Get PostHog API key
    let posthog_api_key = option_env!("POSTHOG_API_KEY").unwrap_or("").to_string();
    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("naukri-lelo".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stderr),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:naukri-lelo.db", db::migrations())
                .build(),
        )
        .manage(AudioState::default())
        .manage(CaptureState::default())
        .manage(shortcuts::WindowVisibility {
            is_hidden: Mutex::new(false),
        })
        .manage(shortcuts::RegisteredShortcuts::default())
        // LicenseState removed - app is free
        .manage(shortcuts::MoveWindowState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(posthog_init(PostHogConfig {
            api_key: posthog_api_key,
            options: Some(PostHogOptions {
                disable_session_recording: Some(true),
                capture_pageview: Some(false),
                capture_pageleave: Some(false),
                ..Default::default()
            }),
            ..Default::default()
        }))
        .plugin(tauri_plugin_machine_uid::init());
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }
    let mut builder = builder
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            window::set_window_height,
            window::open_dashboard,
            window::toggle_dashboard,
            window::move_window,
            capture::capture_to_base64,
            capture::start_screen_capture,
            capture::capture_selected_area,
            capture::close_overlay_window,
            shortcuts::check_shortcuts_registered,
            shortcuts::get_registered_shortcuts,
            shortcuts::update_shortcuts,
            shortcuts::validate_shortcut_key,
            shortcuts::set_license_status,
            shortcuts::set_app_icon_visibility,
            shortcuts::set_always_on_top,
            shortcuts::exit_app,
            activate::activate_license_api,
            activate::deactivate_license_api,
            activate::validate_license_api,
            activate::mask_license_key_cmd,
            activate::get_checkout_url,
            activate::secure_storage_save,
            activate::secure_storage_get,
            activate::secure_storage_remove,
            api::transcribe_audio,
            api::chat_stream_response,
            api::fetch_models,
            api::fetch_prompts,
            api::create_system_prompt,
            api::check_license_status,
            api::get_activity,
            speaker::start_system_audio_capture,
            speaker::stop_system_audio_capture,
            speaker::manual_stop_continuous,
            speaker::check_system_audio_access,
            speaker::request_system_audio_access,
            speaker::get_vad_config,
            speaker::update_vad_config,
            speaker::get_capture_status,
            speaker::get_audio_sample_rate,
            speaker::get_input_devices,
            speaker::get_output_devices,
        ])
        .setup(|app| {
            // Non-fatal: if window positioning fails, continue anyway
            if let Err(e) = window::setup_main_window(app) {
                eprintln!("Warning: Failed to position main window: {}", e);
            }

            #[cfg(target_os = "macos")]
            init(app.app_handle());

            // Pre-create dashboard window so it's ready immediately
            let app_handle = app.handle();
            if app_handle.get_webview_window("dashboard").is_none() {
                if let Err(e) = window::create_dashboard_window(&app_handle) {
                    eprintln!("Failed to pre-create dashboard window: {}", e);
                }
            }

            // System tray: gives the user a reliable way to open the dashboard
            // and quit the app even when all windows are hidden
            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

                let open_item = MenuItem::with_id(
                    app,
                    "open_dashboard",
                    "Open Dashboard",
                    true,
                    None::<&str>,
                )?;
                let quit_item =
                    MenuItem::with_id(app, "quit", "Quit Naukri Lelo", true, None::<&str>)?;
                let sep = PredefinedMenuItem::separator(app)?;
                let menu = Menu::with_items(app, &[&open_item, &sep, &quit_item])?;

                let tray = tauri::tray::TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .menu_on_left_click(false)
                    .tooltip("Naukri Lelo — click to open dashboard")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "open_dashboard" => {
                            if let Some(w) = app.get_webview_window("dashboard") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("dashboard") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    })
                    .build(app)?;

                // Keep the tray icon alive for the full app lifetime
                std::mem::forget(tray);
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;

                #[allow(deprecated, unexpected_cfgs)]
                if let Err(e) = app.handle().plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,
                    Some(vec![]),
                )) {
                    eprintln!("Failed to initialize autostart plugin: {}", e);
                }
            }

            // Non-fatal: if global shortcut plugin fails, app still works
            if let Err(e) = app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, shortcut, event| {
                        use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

                        let action_id = {
                            let state = app.state::<shortcuts::RegisteredShortcuts>();
                            let registered = match state.shortcuts.lock() {
                                Ok(guard) => guard,
                                Err(poisoned) => {
                                    eprintln!("Mutex poisoned in handler, recovering...");
                                    poisoned.into_inner()
                                }
                            };

                            registered.iter().find_map(|(action_id, shortcut_str)| {
                                if let Ok(s) = shortcut_str.parse::<Shortcut>() {
                                    if &s == shortcut {
                                        return Some(action_id.clone());
                                    }
                                }
                                None
                            })
                        };

                        if let Some(action_id) = action_id {
                            match event.state() {
                                ShortcutState::Pressed => {
                                    if let Some(direction) =
                                        action_id.strip_prefix("move_window_")
                                    {
                                        shortcuts::start_move_window(app, direction);
                                    } else {
                                        eprintln!("Shortcut triggered: {}", action_id);
                                        shortcuts::handle_shortcut_action(app, &action_id);
                                    }
                                }
                                ShortcutState::Released => {
                                    if let Some(direction) =
                                        action_id.strip_prefix("move_window_")
                                    {
                                        shortcuts::stop_move_window(app, direction);
                                    }
                                }
                            }
                        }
                    })
                    .build(),
            ) {
                eprintln!("Warning: Failed to initialize global shortcut plugin: {}", e);
            }

            if let Err(e) = shortcuts::setup_global_shortcuts(app.handle()) {
                eprintln!("Failed to setup global shortcuts: {}", e);
            }
            Ok(())
        });

    // Add macOS-specific permissions plugin
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_plugin_macos_permissions::init());
    }

    // Startup diagnostic: step 2 — about to start Tauri event loop
    let _ = std::fs::write(
        std::env::temp_dir().join("naukri-lelo-startup.txt"),
        "step2: about to call builder.run() — if crash.txt appears, Tauri init failed",
    );

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
#[allow(deprecated, unexpected_cfgs)]
fn init(app_handle: &AppHandle) {
    let window: WebviewWindow = app_handle.get_webview_window("main").unwrap();

    let panel = window.to_panel().unwrap();

    let delegate = panel_delegate!(MyPanelDelegate {
        window_did_become_key,
        window_did_resign_key
    });

    let handle = app_handle.to_owned();

    delegate.set_listener(Box::new(move |delegate_name: String| {
        match delegate_name.as_str() {
            "window_did_become_key" => {
                let app_name = handle.package_info().name.to_owned();
                println!("[info]: {:?} panel becomes key window!", app_name);
            }
            "window_did_resign_key" => {
                println!("[info]: panel resigned from key window!");
            }
            _ => (),
        }
    }));

    #[allow(non_upper_case_globals)]
    const NSFloatWindowLevel: i32 = 4;
    panel.set_level(NSFloatWindowLevel);

    #[allow(non_upper_case_globals)]
    const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);

    #[allow(deprecated)]
    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces,
    );

    panel.set_delegate(delegate);
}
