# RustSSH — Cross-Platform SSH/SFTP Desktop Application

A modern desktop SSH client built with **Rust** and **Tauri 2**, featuring an integrated file manager (SFTP) and terminal emulator.

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | **Tauri 2** | Cross-platform desktop app (Windows, macOS) |
| Backend | **Rust** + `russh` + `russh-sftp` | SSH/SFTP protocol handling |
| Frontend | **HTML/JS/CSS** + `xterm.js` | Modern UI with terminal emulation |
| Async Runtime | **Tokio** | Async SSH/SFTP operations |
| Serialization | **serde** + `serde_json` | Connection config persistence |

## User Review Required

> [!IMPORTANT]
> **Scope**: This plan builds a fully functional SSH/SFTP client. The initial version will support **password** and **key-based** authentication. Advanced features like SSH agent forwarding, tunneling, and multi-hop connections are out of scope for v1.

> [!NOTE]
> **xterm.js**: The terminal emulator runs in the Tauri webview. SSH data flows: `xterm.js ↔ Tauri IPC ↔ Rust russh ↔ Remote Server`. There is no WebSocket involved — Tauri's native IPC handles the bridge.

---

## Proposed Changes

### Project Scaffolding

#### [NEW] Project root at `D:\test\ssh-client`

Initialize a Tauri 2 project with this structure:

```
ssh-client/
├── src-tauri/           # Rust backend
│   ├── Cargo.toml       # Rust dependencies
│   ├── tauri.conf.json  # Tauri configuration
│   ├── src/
│   │   ├── main.rs      # Tauri entry point
│   │   ├── lib.rs       # Module declarations
│   │   ├── ssh.rs       # SSH session management
│   │   ├── sftp.rs      # SFTP file operations
│   │   ├── connection.rs # Connection store (CRUD)
│   │   └── commands.rs  # Tauri IPC commands
├── src/                 # Frontend
│   ├── index.html       # Main HTML layout
│   ├── styles/
│   │   ├── main.css     # Design system & global styles
│   │   ├── sidebar.css  # Connection sidebar styles
│   │   ├── filemanager.css # File manager styles
│   │   └── terminal.css # Terminal styles
│   ├── js/
│   │   ├── app.js       # App initialization & routing
│   │   ├── connections.js # Connection CRUD UI
│   │   ├── filemanager.js # SFTP file manager with drag-drop
│   │   ├── terminal.js  # xterm.js terminal wrapper
│   │   └── splitpane.js # Resizable split-pane logic
│   └── assets/          # Icons and images
├── package.json         # npm dependencies (xterm.js)
└── README.md
```

---

### Rust Backend

#### [NEW] [Cargo.toml](file:///D:/test/ssh-client/src-tauri/Cargo.toml)

Key dependencies:
- `tauri` (v2) — desktop framework
- `russh` — async SSH client
- `russh-sftp` — SFTP subsystem
- `russh-keys` — SSH key handling
- `tokio` — async runtime
- `serde` / `serde_json` — serialization
- `dirs` — cross-platform config directory

#### [NEW] [connection.rs](file:///D:/test/ssh-client/src-tauri/src/connection.rs)

#### [NEW] [connection.rs](file:///D:/test/ssh-client/src-tauri/src/connection.rs)

Connection management module:
- `Connection` struct:
    - `id`: UUID
    - `name`: Display name
    - `host`: Hostname or IP
    - `port`: u16 (default 22)
    - `username`: String
    - `auth_type`: Enum (Password, KeyFile, Agent)
    - `password`: Option<String> (Encrypted? Or just stored for MVP - *User requirement: store config*)
    - `private_key_path`: Option<String> (Path to identity file, e.g., `~/.ssh/id_rsa`)
- `ConnectionStore`:
    - Load/save `Vec<Connection>` to `app_data_dir/connections.json`
    - Ensure robust serialization/deserialization
- CRUD operations: `list`, `add`, `update`, `delete`


#### [NEW] [ssh.rs](file:///D:/test/ssh-client/src-tauri/src/ssh.rs)

SSH session management:
- `SshSession`: wraps `russh::client::Handle` with session state
- Connect with password or private key
- Open PTY channel for interactive terminal
- Read/write data to the PTY channel
- Manage session lifecycle (connect, disconnect, keepalive)
- Session registry: map of active sessions by ID

#### [NEW] [sftp.rs](file:///D:/test/ssh-client/src-tauri/src/sftp.rs)

SFTP file operations:
- Open SFTP subsystem from an existing SSH session
- `list_dir`: list remote directory contents with metadata
- `upload`: upload local file to remote path
- `download`: download remote file to local path
- `mkdir`, `rmdir`, `rename`, `delete`: file management operations
- Progress reporting via Tauri events

#### [NEW] [commands.rs](file:///D:/test/ssh-client/src-tauri/src/commands.rs)

Tauri IPC commands (exposed to frontend):
- **Connection**: `get_connections`, `save_connection`, `delete_connection`
- **SSH**: `ssh_connect`, `ssh_disconnect`, `ssh_write`, `ssh_resize`
- **SFTP**: `sftp_list`, `sftp_upload`, `sftp_download`, `sftp_mkdir`, `sftp_delete`, `sftp_rename`
- SSH data flows to frontend via Tauri events (`ssh-data`, `ssh-error`, `ssh-close`)

---

### Frontend

#### [NEW] [index.html](file:///D:/test/ssh-client/src/index.html)

Main layout structure:
```
┌──────────────────────────────────────────────────┐
│  Toolbar (Connect, Disconnect, Settings)         │
├────────────┬─────────────────────────────────────┤
│ Sidebar    │  Main Content Area                  │
│ [Tabs]     │                                     │
│ [Conn][File]                                     │
│ ┌────────┐ │  ┌───────────────────────────────┐  │
│ │ List   │ │  │                               │  │
│ │ or     │ │  │          Terminal             │  │
│ │ Tree   │ │  │         (xterm.js)            │  │
│ │ View   │ │  │                               │  │
│ └────────┘ │  └───────────────────────────────┘  │
│            │                                     │
├────────────┴─────────────────────────────────────┤
│  Status Bar (connection info, transfer progress) │
└──────────────────────────────────────────────────┘
```

#### [NEW] [main.css](file:///D:/test/ssh-client/src/styles/main.css)

Design system:
- **Aesthetic**: "Deep Ocean Glass"
- **Color Palette**: Dark translucent navy blue background with charcoal secondary panels.
- **Accents**: Vibrant **cyan** (#00e5ff) for active states, buttons, and connection indicators.
- **Glassmorphism**: 15-20px background blur on the sidebar and modal overlays for a premium frosted look.
- **Typography**: Clean, professional sans-serif (**Inter**).
- **Animations**: Subtle scale-up on hover, smooth width transitions for the sidebar.
- **Sidebar Tabs**: Styled toggle between "Connections" and "Files" with cyan underlines.
- **Top Toolbar**: Full-width header with frosted glass finish.

#### [NEW] [filemanager.js](file:///D:/test/ssh-client/src/js/filemanager.js)

Sidebar-based SFTP file manager:
- Compact Tree View of remote files (optimized for sidebar width)
- File/folder icons with type-based coloring
- **Drag-and-drop**: drag local files onto the sidebar tree to upload
- Context menu (rename, delete, create folder, download)
- Breadcrumb path navigation (compact)

#### [NEW] [terminal.js](file:///D:/test/ssh-client/src/js/terminal.js)

Terminal emulator:
- Initialize xterm.js with custom theme matching the app
- Listen for Tauri events (`ssh-data`) to write to terminal
- Send user input via Tauri command (`ssh_write`)
- Handle terminal resize → send `ssh_resize` command
- **Full Width**: Takes up all available space right of the sidebar

#### [NEW] [connections.js](file:///D:/test/ssh-client/src/js/connections.js)

#### [NEW] [connections.js](file:///D:/test/ssh-client/src/js/connections.js)

Connection management UI (Tab 1):
- List of saved connections with status indicators
- UI for add/edit connection (modal dialog):
    - **Authentication Method Selector**: Dropdown (Password / Private Key)
    - **Private Key Input**: File picker button to select `.pem` / `id_rsa` files
    - Fields: Name, Host, Port, Username
- Double-click to connect -> Auto-switch to "Files" tab (optional) or just activate terminal
- Connection grouping/favorites


---

## Verification Plan

### Automated Tests

Since this is a new project with no existing tests, verification is functionality-based:

1. **Build verification** (both platforms):
   ```bash
   cd D:\test\ssh-client
   npm install
   cd src-tauri && cargo build
   ```
   Confirms Rust compiles without errors and dependencies resolve.

2. **Development server**:
   ```bash
   cd D:\test\ssh-client
   npx tauri dev
   ```
   Confirms the app launches and the UI renders correctly.

### Manual Verification

1. **UI Layout Check**: Launch the app and verify:
   - Dark theme with modern styling renders correctly
   - Sidebar shows on the left with connection list
   - Main area splits into file manager (left) and terminal (right)
   - Split pane is resizable via drag handle
   - Status bar shows at the bottom

2. **Connection Management**: Click "New Connection" and verify:
   - Modal dialog appears with fields for name, host, port, username, auth type
   - Saving a connection adds it to the sidebar
   - Editing and deleting connections works
   - Connections persist after app restart
- [ ] Test UI responsiveness and interactions
- [ ] **Bug Fix**: Isolate SFTP channel data from Terminal (filter `ClientHandler` events)
- [ ] **Bug Fix**: Fix Drag-and-Drop using `tauri://file-drop` event (standard HTML5 drop lacks paths)
- [ ] **Feature**: Set initial file manager path to user's home directory (implement `sftp_get_home`)

3. **SSH Terminal**: Connect to a test server and verify:
   - Terminal opens on the right pane with xterm.js
   - Commands can be typed and executed
   - Output renders correctly with colors/formatting
   - Terminal resizes when the split pane is adjusted

4. **SFTP File Manager**: After connecting, verify:
   - Remote directory listing appears in the file manager pane
   - Can navigate folders by clicking
   - Drag-and-drop local files onto the panel triggers upload
   - Right-click context menu provides download, rename, delete options

> [!TIP]
> For manual testing, you'll need access to an SSH server. You can use a local VM, WSL, or a cloud instance with SSH enabled.
