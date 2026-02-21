#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use rustssh::commands;
use rustssh::ssh::SessionManager;


fn log_path() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("rustssh-crash.log")
}

fn main() {
    let path = log_path();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!("[PANIC] {info}\nTimestamp: {:?}\n", std::time::SystemTime::now());
        let _ = std::fs::write(&path, &msg);
    }));

    let session_manager = Arc::new(SessionManager::new());

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .manage(session_manager)
        .setup(|_app| {
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_connections,
            commands::save_connection,
            commands::delete_connection,
            commands::ssh_connect,
            commands::ssh_write,
            commands::ssh_resize,
            commands::ssh_disconnect,
            commands::sftp_list,
            commands::sftp_download,
            commands::sftp_upload,
            commands::sftp_mkdir,
            commands::sftp_delete,
            commands::sftp_rename,
            commands::sftp_get_home,
            commands::sftp_chmod,
            commands::sftp_edit_file,
            commands::sftp_watch_file,
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        let msg = format!("[ERROR] Failed to start: {e}\nTimestamp: {:?}\n", std::time::SystemTime::now());
        let _ = std::fs::write(log_path(), &msg);
    }
}