use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AuthType {
    Password,
    KeyFile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
}

impl Connection {
    pub fn new(
        name: String,
        host: String,
        port: u16,
        username: String,
        auth_type: AuthType,
        password: Option<String>,
        private_key_path: Option<String>,
        passphrase: Option<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            host,
            port,
            username,
            auth_type,
            password,
            private_key_path,
            passphrase,
        }
    }
}

pub struct ConnectionStore {
    file_path: PathBuf,
}

impl ConnectionStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let file_path = app_data_dir.join("connections.json");
        Self { file_path }
    }

    pub fn load(&self) -> Vec<Connection> {
        if !self.file_path.exists() {
            return Vec::new();
        }
        match fs::read_to_string(&self.file_path) {
            Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    pub fn save(&self, connections: &[Connection]) -> Result<(), String> {
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let data = serde_json::to_string_pretty(connections).map_err(|e| e.to_string())?;
        fs::write(&self.file_path, data).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add(&self, connection: Connection) -> Result<Vec<Connection>, String> {
        let mut connections = self.load();
        connections.push(connection);
        self.save(&connections)?;
        Ok(connections)
    }

    pub fn update(&self, connection: Connection) -> Result<Vec<Connection>, String> {
        let mut connections = self.load();
        if let Some(pos) = connections.iter().position(|c| c.id == connection.id) {
            connections[pos] = connection;
            self.save(&connections)?;
            Ok(connections)
        } else {
            Err("Connection not found".to_string())
        }
    }

    pub fn delete(&self, id: &str) -> Result<Vec<Connection>, String> {
        let mut connections = self.load();
        connections.retain(|c| c.id != id);
        self.save(&connections)?;
        Ok(connections)
    }
}
