#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use rustssh::commands;
use rustssh::ssh::SessionManager;

fn main() {
    let session_manager = Arc::new(SessionManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(session_manager)
        .invoke_handler(tauri::generate_handler![
            // Connection commands
            commands::get_connections,
            commands::save_connection,
            commands::delete_connection,
            // SSH commands
            commands::ssh_connect,
            commands::ssh_write,
            commands::ssh_resize,
            commands::ssh_disconnect,
            // SFTP commands
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
