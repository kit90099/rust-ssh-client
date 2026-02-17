use async_trait::async_trait;
use russh::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::connection::{AuthType, Connection};

/// Client handler for russh - receives server events
pub struct ClientHandler {
    pub session_id: String,
    pub sender: tokio::sync::mpsc::Sender<SshEvent>,
    pub shell_channel_id: Arc<Mutex<Option<ChannelId>>>,
}

#[derive(Debug, Clone)]
pub enum SshEvent {
    Data(Vec<u8>),
    Error(String),
    Close,
}

#[async_trait]
impl client::Handler for ClientHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Accept all server keys for now (MVP)
        // TODO: Implement known_hosts verification
        Ok(true)
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let shell_id = self.shell_channel_id.lock().await;
        if let Some(id) = *shell_id {
            if id == channel {
                let _ = self.sender.send(SshEvent::Data(data.to_vec())).await;
            }
        }
        Ok(())
    }
}

/// Represents an active SSH session
pub struct SshSession {
    pub id: String,
    pub handle: client::Handle<ClientHandler>,
    pub channel: Channel<client::Msg>,
}

impl SshSession {
    pub async fn connect(
        connection: &Connection,
        sender: tokio::sync::mpsc::Sender<SshEvent>,
    ) -> Result<Self, String> {
        let session_id = Uuid::new_v4().to_string();

        let config = Arc::new(client::Config {
            ..Default::default()
        });

        let shell_channel_id = Arc::new(Mutex::new(None));

        let handler = ClientHandler {
            session_id: session_id.clone(),
            sender: sender.clone(),
            shell_channel_id: shell_channel_id.clone(),
        };

        let addr = format!("{}:{}", connection.host, connection.port);
        let mut handle = client::connect(config, addr, handler)
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;

        // Authenticate
        let authenticated = match connection.auth_type {
            AuthType::Password => {
                let password = connection
                    .password
                    .as_deref()
                    .ok_or("Password not provided")?;
                handle
                    .authenticate_password(&connection.username, password)
                    .await
                    .map_err(|e| format!("Auth failed: {}", e))?
            }
            AuthType::KeyFile => {
                let key_path = connection
                    .private_key_path
                    .as_deref()
                    .ok_or("Private key path not provided")?;

                let key_pair = russh_keys::load_secret_key(
                    key_path,
                    connection.passphrase.as_deref(),
                )
                .map_err(|e| format!("Failed to load key: {}", e))?;

                let key_pair = Arc::new(key_pair);
                handle
                    .authenticate_publickey(&connection.username, key_pair)
                    .await
                    .map_err(|e| format!("Key auth failed: {}", e))?
            }
        };

        if !authenticated {
            return Err("Authentication failed".to_string());
        }

        // Open a session channel
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Channel open failed: {}", e))?;

        // Store the channel ID so the handler knows which data to forward
        {
            let mut id_lock = shell_channel_id.lock().await;
            *id_lock = Some(channel.id());
        }

        // Request PTY
        channel
            .request_pty(
                false,
                "xterm-256color",
                80,
                24,
                0,
                0,
                &[],
            )
            .await
            .map_err(|e| format!("PTY request failed: {}", e))?;

        // Request shell
        channel
            .request_shell(false)
            .await
            .map_err(|e| format!("Shell request failed: {}", e))?;

        Ok(Self {
            id: session_id,
            handle,
            channel,
        })
    }

    pub async fn write(&self, data: &[u8]) -> Result<(), String> {
        self.channel
            .data(data)
            .await
            .map_err(|e| format!("Write failed: {}", e))
    }

    pub async fn resize(&self, cols: u32, rows: u32) -> Result<(), String> {
        self.channel
            .window_change(cols, rows, 0, 0)
            .await
            .map_err(|e| format!("Resize failed: {}", e))
    }

    pub async fn close(self) -> Result<(), String> {
        self.channel
            .close()
            .await
            .map_err(|e| format!("Close failed: {}", e))
    }
}

/// Global session registry
pub struct SessionManager {
    pub sessions: Mutex<HashMap<String, SshSession>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub async fn add_session(&self, session: SshSession) -> String {
        let id = session.id.clone();
        self.sessions.lock().await.insert(id.clone(), session);
        id
    }

    pub async fn remove_session(&self, id: &str) -> Option<SshSession> {
        self.sessions.lock().await.remove(id)
    }

    pub async fn has_session(&self, id: &str) -> bool {
        self.sessions.lock().await.contains_key(id)
    }
}
