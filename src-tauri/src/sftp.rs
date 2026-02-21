use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};

use crate::ssh::SshSession;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
}

/// Open an SFTP session from an existing SSH session
pub async fn open_sftp(session: &SshSession) -> Result<SftpSession, String> {
    let channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SFTP channel: {}", e))?;

    channel
        .request_subsystem(false, "sftp")
        .await
        .map_err(|e| format!("Failed to request SFTP subsystem: {}", e))?;

    let sftp = SftpSession::new(channel.into_stream()).await
        .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

    Ok(sftp)
}

/// Get the user's home directory (resolves "." to absolute path)
pub async fn get_home_dir(sftp: &SftpSession) -> Result<String, String> {
    let path = sftp
        .canonicalize(".")
        .await
        .map_err(|e| format!("Failed to get home directory: {}", e))?;
    
    Ok(path)
}

/// List directory contents
pub async fn list_dir(sftp: &SftpSession, path: &str) -> Result<Vec<FileEntry>, String> {
    let entries = sftp
        .read_dir(path)
        .await
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut files: Vec<FileEntry> = Vec::new();

    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }

        let full_path = if path.ends_with('/') {
            format!("{}{}", path, name)
        } else {
            format!("{}/{}", path, name)
        };

        let attrs = entry.metadata();
        let is_dir = attrs.is_dir();
        let size = attrs.len();
        let modified = attrs.modified().ok().and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH).ok()
        }).map(|d| d.as_secs());

        let permissions = attrs.permissions;
        let uid = attrs.uid;
        let gid = attrs.gid;

        files.push(FileEntry {
            name,
            path: full_path,
            is_dir,
            size,
            modified,
            permissions,
            uid,
            gid,
        });
    }

    // Sort: directories first, then alphabetical
    files.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(files)
}

/// Download a file from remote
pub async fn download_file(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &str,
) -> Result<(), String> {
    use tokio::io::AsyncReadExt;

    let mut remote_file = sftp
        .open(remote_path)
        .await
        .map_err(|e| format!("Failed to open remote file: {}", e))?;

    let mut contents = Vec::new();
    remote_file
        .read_to_end(&mut contents)
        .await
        .map_err(|e| format!("Failed to read remote file: {}", e))?;

    tokio::fs::write(local_path, &contents)
        .await
        .map_err(|e| format!("Failed to write local file: {}", e))?;

    Ok(())
}

/// Upload a file to remote
pub async fn upload_file(
    sftp: &SftpSession,
    local_path: &str,
    remote_path: &str,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    let contents = tokio::fs::read(local_path)
        .await
        .map_err(|e| format!("Failed to read local file: {}", e))?;

    let mut remote_file = sftp
        .create(remote_path)
        .await
        .map_err(|e| format!("Failed to create remote file: {}", e))?;

    remote_file
        .write_all(&contents)
        .await
        .map_err(|e| format!("Failed to write remote file: {}", e))?;

    remote_file
        .shutdown()
        .await
        .map_err(|e| format!("Failed to close remote file: {}", e))?;

    Ok(())
}

/// Create a remote directory
pub async fn mkdir(sftp: &SftpSession, path: &str) -> Result<(), String> {
    sftp.create_dir(path)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))
}

/// Remove a remote file
pub async fn remove_file(sftp: &SftpSession, path: &str) -> Result<(), String> {
    sftp.remove_file(path)
        .await
        .map_err(|e| format!("Failed to remove file: {}", e))
}

/// Remove a remote directory
pub async fn remove_dir(sftp: &SftpSession, path: &str) -> Result<(), String> {
    sftp.remove_dir(path)
        .await
        .map_err(|e| format!("Failed to remove directory: {}", e))
}

/// Rename/move a remote file or directory
pub async fn rename(sftp: &SftpSession, from: &str, to: &str) -> Result<(), String> {
    sftp.rename(from, to)
        .await
        .map_err(|e| format!("Failed to rename: {}", e))
}

/// Set file permissions (chmod)
pub async fn set_permissions(sftp: &SftpSession, path: &str, mode: u32) -> Result<(), String> {
    use russh_sftp::protocol::FileAttributes;
    let attrs = FileAttributes {
        permissions: Some(mode),
        ..FileAttributes::empty()
    };
    sftp.set_metadata(path, attrs)
        .await
        .map_err(|e| format!("Failed to set permissions: {}", e))
}
