use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

use crate::connection::{AuthType, Connection, ConnectionStore};
use crate::sftp;
use crate::ssh::{SessionManager, SshEvent, SshSession};

// ── Connection Commands ──────────────────────────────────────────────

#[tauri::command]
pub async fn get_connections(
    app: AppHandle,
) -> Result<Vec<Connection>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let store = ConnectionStore::new(data_dir);
    Ok(store.load())
}

#[tauri::command]
pub async fn save_connection(
    app: AppHandle,
    id: Option<String>,
    name: String,
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    password: Option<String>,
    private_key_path: Option<String>,
    passphrase: Option<String>,
) -> Result<Vec<Connection>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let store = ConnectionStore::new(data_dir);

    let at = match auth_type.as_str() {
        "password" => AuthType::Password,
        "keyfile" => AuthType::KeyFile,
        _ => return Err("Invalid auth type".to_string()),
    };

    match id {
        Some(existing_id) => {
            let conn = Connection {
                id: existing_id,
                name,
                host,
                port,
                username,
                auth_type: at,
                password,
                private_key_path,
                passphrase,
            };
            store.update(conn)
        }
        None => {
            let conn = Connection::new(
                name,
                host,
                port,
                username,
                at,
                password,
                private_key_path,
                passphrase,
            );
            store.add(conn)
        }
    }
}

#[tauri::command]
pub async fn delete_connection(
    app: AppHandle,
    id: String,
) -> Result<Vec<Connection>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let store = ConnectionStore::new(data_dir);
    store.delete(&id)
}

// ── SSH Commands ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    session_manager: State<'_, Arc<SessionManager>>,
    connection_id: String,
) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let store = ConnectionStore::new(data_dir);
    let connections = store.load();

    let conn = connections
        .iter()
        .find(|c| c.id == connection_id)
        .ok_or("Connection not found")?
        .clone();

    let (tx, mut rx) = mpsc::channel::<SshEvent>(1024);

    let session = SshSession::connect(&conn, tx).await?;
    let session_id = session_manager.add_session(session).await;

    // Spawn a task to forward SSH data to the frontend
    let app_handle = app.clone();
    let sid = session_id.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                SshEvent::Data(data) => {
                    // Send raw bytes as array to frontend
                    let _ = app_handle.emit("ssh-data", serde_json::json!({
                        "sessionId": sid,
                        "data": data,
                    }));
                }
                SshEvent::Error(err) => {
                    let _ = app_handle.emit("ssh-error", serde_json::json!({
                        "sessionId": sid,
                        "error": err,
                    }));
                }
                SshEvent::Close => {
                    let _ = app_handle.emit("ssh-close", serde_json::json!({
                        "sessionId": sid,
                    }));
                    break;
                }
            }
        }
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn ssh_write(
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let sessions = session_manager.sessions.lock().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    session.write(&data).await
}

#[tauri::command]
pub async fn ssh_resize(
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let sessions = session_manager.sessions.lock().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    session.resize(cols, rows).await
}

#[tauri::command]
pub async fn ssh_disconnect(
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
) -> Result<(), String> {
    if let Some(session) = session_manager.remove_session(&session_id).await {
        session.close().await?;
    }
    Ok(())
}

// ── SFTP Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_list(
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
    path: String,
) -> Result<Vec<sftp::FileEntry>, String> {
    let sessions = session_manager.sessions.lock().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    let sftp_session = sftp::open_sftp(session).await?;
    sftp::list_dir(&sftp_session, &path).await
}

#[tauri::command]
pub async fn sftp_download(
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let sessions = session_manager.sessions.lock().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    let sftp_session = sftp::open_sftp(session).await?;
    sftp::download_file(&sftp_session, &remote_path, &local_path).await
}

#[tauri::command]
pub async fn sftp_upload(
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let sessions = session_manager.sessions.lock().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    let sftp_session = sftp::open_sftp(session).await?;
    sftp::upload_file(&sftp_session, &local_path, &remote_path).await
}

#[tauri::command]
pub async fn sftp_mkdir(
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let sessions = session_manager.sessions.lock().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    let sftp_session = sftp::open_sftp(session).await?;
    sftp::mkdir(&sftp_session, &path).await
}

#[tauri::command]
pub async fn sftp_delete(
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let sessions = session_manager.sessions.lock().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    let sftp_session = sftp::open_sftp(session).await?;
    if is_dir {
        sftp::remove_dir(&sftp_session, &path).await
    } else {
        sftp::remove_file(&sftp_session, &path).await
    }
}

#[tauri::command]
pub async fn sftp_rename(
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let sessions = session_manager.sessions.lock().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    let sftp_session = sftp::open_sftp(session).await?;
    sftp::rename(&sftp_session, &from, &to).await
}

#[tauri::command]
pub async fn sftp_get_home(
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
) -> Result<String, String> {
    let sessions = session_manager.sessions.lock().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    let sftp_session = sftp::open_sftp(session).await?;
    sftp::get_home_dir(&sftp_session).await
}

#[tauri::command]
pub async fn sftp_chmod(
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
    path: String,
    mode: u32,
) -> Result<(), String> {
    let sessions = session_manager.sessions.lock().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    let sftp_session = sftp::open_sftp(session).await?;
    sftp::set_permissions(&sftp_session, &path, mode).await
}

#[tauri::command]
pub async fn sftp_edit_file(
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
    remote_path: String,
    editor_path: Option<String>,
) -> Result<String, String> {
    // Create temp directory for editing
    let temp_dir = std::env::temp_dir().join("rustssh-edit").join(&session_id);
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    // Extract filename
    let filename = remote_path.split('/').last()
        .ok_or("Invalid remote path")?;
    let local_path = temp_dir.join(filename);
    let local_path_str = local_path.to_string_lossy().to_string();

    // Download file
    let sessions = session_manager.sessions.lock().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    let sftp_session = sftp::open_sftp(session).await?;
    sftp::download_file(&sftp_session, &remote_path, &local_path_str).await?;

    // Open file with configured editor or system default
    if let Some(editor) = editor_path {
        // Special flag to show "Open With" dialog
        if editor == "open-with-dialog" {
            std::process::Command::new("rundll32.exe")
                .args(&["shell32.dll,OpenAs_RunDLL", &local_path_str])
                .spawn()
                .map_err(|e| format!("Failed to open system dialog: {}", e))?;
            return Ok(local_path_str);
        }

        let mut cmd = std::process::Command::new(&editor);
        cmd.arg(&local_path);
        
        // Try launching specified editor
        if let Err(e) = cmd.spawn() {
            // If failed and editor is "code", try common paths
            if editor == "code" {
                let common_paths = [
                    format!("{}\\Programs\\Microsoft VS Code\\Code.exe", std::env::var("LOCALAPPDATA").unwrap_or_default()),
                    String::from("C:\\Program Files\\Microsoft VS Code\\Code.exe"),
                    String::from("C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe"),
                ];

                let mut launched = false;
                for path in common_paths {
                    if std::path::Path::new(&path).exists() {
                        if std::process::Command::new(&path).arg(&local_path).spawn().is_ok() {
                            launched = true;
                            break;
                        }
                    }
                }

                if !launched {
                    return Err(format!("Failed to launch editor '{}' and could not find it in common locations: {}", editor, e));
                }
            } else {
                return Err(format!("Failed to launch editor '{}': {}", editor, e));
            }
        }
    } else {
        // Use system default
        opener::open(&local_path)
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    Ok(local_path_str)
}

#[tauri::command]
pub async fn sftp_watch_file(
    app: AppHandle,
    session_manager: State<'_, Arc<SessionManager>>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    use notify::{Watcher, RecursiveMode, Config};
    use std::sync::mpsc::channel;

    let sm = session_manager.inner().clone();
    let app_handle = app.clone();

    // Spawn blocking task for file watcher
    tokio::task::spawn_blocking(move || {
        let (tx, rx) = channel();

        let mut watcher = notify::RecommendedWatcher::new(tx, Config::default())
            .map_err(|e| format!("Failed to create watcher: {}", e)).unwrap();

        let path = std::path::Path::new(&local_path);
        watcher.watch(path, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch file: {}", e)).unwrap();

        let _ = app_handle.emit("file-sync-status", serde_json::json!({
            "status": "watching",
            "file": remote_path,
        }));

        // Watch loop
        loop {
            match rx.recv() {
                Ok(Ok(event)) => {
                    if event.kind.is_modify() {
                        // Small delay for file to finish writing
                        std::thread::sleep(std::time::Duration::from_millis(500));

                        let rt = tokio::runtime::Handle::current();
                        let sm_clone = sm.clone();
                        let sid = session_id.clone();
                        let lp = local_path.clone();
                        let rp = remote_path.clone();
                        let ah = app_handle.clone();

                        rt.spawn(async move {
                            let sessions = sm_clone.sessions.lock().await;
                            if let Some(session) = sessions.get(&sid) {
                                match sftp::open_sftp(session).await {
                                    Ok(sftp_session) => {
                                        match sftp::upload_file(&sftp_session, &lp, &rp).await {
                                            Ok(_) => {
                                                let _ = ah.emit("file-sync-status", serde_json::json!({
                                                    "status": "synced",
                                                    "file": rp,
                                                }));
                                            }
                                            Err(e) => {
                                                let _ = ah.emit("file-sync-status", serde_json::json!({
                                                    "status": "error",
                                                    "file": rp,
                                                    "error": e,
                                                }));
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        let _ = ah.emit("file-sync-status", serde_json::json!({
                                            "status": "error",
                                            "file": rp,
                                            "error": e,
                                        }));
                                    }
                                }
                            }
                        });
                    }
                }
                Ok(Err(_)) | Err(_) => break,
            }
        }
    });

    Ok(())
}
