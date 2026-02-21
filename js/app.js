/**
 * RustSSH — Main Application Module
 * Initializes all components and handles global state.
 */

import { ConnectionManager } from './connections.js';
import { TerminalManager } from './terminal.js';
import { FileManager } from './filemanager.js';
import { initSplitPane } from './splitpane.js';

class App {
    constructor() {
        this.sessions = []; // Array of session objects
        this.currentSessionId = null;
        this.currentConnectionId = null;

        this.connectionManager = new ConnectionManager(this);
        // this.terminalManager = new TerminalManager(this); // Removed, now per session
        this.fileManager = new FileManager(this);

        // Expose fileManager for inline drag-drop handler
        window.fileManager = this.fileManager;

        this.init();
    }

    async init() {
        // Platform detection for CSS styling
        try {
            const { platform } = await import('@tauri-apps/plugin-os');
            const currentPlatform = await platform();
            document.body.classList.add(`platform-${currentPlatform}`);
        } catch (e) {
            console.error('Failed to detect platform:', e);
        }

        this.bindToolbar();
        this.bindSidebarTabs();
        this.bindModalEvents();
        initSplitPane();

        // Load saved connections
        await this.connectionManager.loadConnections();

        // Listen for SSH events from Tauri backend
        const { listen } = await import('@tauri-apps/api/event');

        listen('ssh-data', (event) => {
            const { sessionId, data } = event.payload;
            const session = this.sessions.find(s => s.id === sessionId);
            if (session && session.terminalManager) {
                session.terminalManager.writeData(new Uint8Array(data));
            }
        });

        listen('ssh-error', (event) => {
            const { sessionId, error } = event.payload;
            // Show error even if not active session? Ideally show notification.
            // For now, update global status if related to active session.
            if (sessionId === this.currentSessionId) {
                this.setStatus('error', `Error: ${error}`);
            }
        });

        listen('ssh-close', (event) => {
            const { sessionId } = event.payload;
            this.closeSession(sessionId);
        });

        // Handle window resize for active terminal
        window.addEventListener('resize', () => {
            const session = this.sessions.find(s => s.id === this.currentSessionId);
            if (session && session.terminalManager) {
                session.terminalManager.fit();
            }
        });
    }

    // ── Toolbar ──────────────────────────────────────────────

    bindToolbar() {
        // "New" now opens connection modal
        document.getElementById('btn-connect').addEventListener('click', () => {
            this.connectionManager.showModal();
        });

        document.getElementById('btn-disconnect').addEventListener('click', () => {
            if (this.currentSessionId) {
                this.disconnect();
            }
        });
    }

    // ── Sidebar Tabs ─────────────────────────────────────────

    bindSidebarTabs() {
        const tabs = document.querySelectorAll('.sidebar-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchToTab(tab.dataset.tab);
            });
        });
    }

    switchToTab(tabName) {
        document.querySelectorAll('.sidebar-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tabName);
        });
        document.querySelectorAll('.sidebar-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');
    }

    // ── Modal & Events ───────────────────────────────────────

    bindModalEvents() {
        // Add Connection
        document.getElementById('btn-add-connection').addEventListener('click', () => {
            this.connectionManager.showModal();
        });

        document.getElementById('btn-modal-close').addEventListener('click', () => {
            this.connectionManager.hideModal();
        });

        document.getElementById('btn-modal-cancel').addEventListener('click', () => {
            this.connectionManager.hideModal();
        });

        // Close modal on overlay click
        document.getElementById('connection-modal').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.connectionManager.hideModal();
            }
        });

        // Auth type toggle
        document.getElementById('conn-auth-type').addEventListener('change', (e) => {
            const isKey = e.target.value === 'keyfile';
            document.getElementById('auth-password-fields').style.display = isKey ? 'none' : 'block';
            document.getElementById('auth-keyfile-fields').style.display = isKey ? 'block' : 'none';
        });

        // Browse key file
        document.getElementById('btn-browse-key').addEventListener('click', async () => {
            try {
                const { open } = await import('@tauri-apps/plugin-dialog');
                const file = await open({
                    multiple: false,
                    filters: [{ name: 'SSH Keys', extensions: ['pem', 'key', 'pub', ''] }],
                });
                if (file) {
                    document.getElementById('conn-keypath').value = file;
                }
            } catch (e) {
                console.error('Failed to browse for key:', e);
            }
        });

        // Settings modal
        document.getElementById('btn-settings').addEventListener('click', () => {
            this.showSettingsModal();
        });

        document.getElementById('btn-settings-close').addEventListener('click', () => {
            this.hideSettingsModal();
        });

        document.getElementById('btn-settings-cancel').addEventListener('click', () => {
            this.hideSettingsModal();
        });

        document.getElementById('btn-settings-save').addEventListener('click', () => {
            this.saveSettings();
        });

        // Show/hide custom editor path input
        document.getElementById('editor-preset').addEventListener('change', (e) => {
            const customGroup = document.getElementById('custom-editor-group');
            customGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
        });

        // Close settings modal on overlay click
        document.getElementById('settings-modal').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.hideSettingsModal();
            }
        });

        // Form submit
        document.getElementById('connection-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.connectionManager.saveConnection();
        });
    }

    // ── Status Bar ───────────────────────────────────────────

    setStatus(status, message) {
        // Supports two styles of status bar updates based on what's available
        // Style 1: ID based (as seen in index.html)
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');

        if (dot && text) {
            dot.className = `status-dot ${status}`;
            text.textContent = message;
        } else {
            // Fallback for older style if any
            const dotQuery = document.querySelector('.status-dot');
            const labelQuery = document.querySelector('#status-connection span:last-child');
            if (dotQuery) dotQuery.className = `status-dot ${status}`;
            if (labelQuery) labelQuery.textContent = message;
        }
    }

    // ── Connection Logic ─────────────────────────────────────

    async connect(id) {
        const connection = this.connectionManager.connections.find(c => c.id === id);
        if (!connection) return;

        // If previously connected and no session, clear currentConnectionId?
        // multi-tab allows connecting to same server multiple times.

        this.currentConnectionId = id;
        this.setStatus('connecting', `Connecting to ${connection.host}...`);
        this.connectionManager.hideModal();

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const sessionId = await invoke('ssh_connect', {
                connectionId: connection.id
            });

            this.setStatus('connected', `Connected to ${connection.host}`);

            // Create new session tab
            this.addSession(sessionId, connection.name || connection.host);

        } catch (e) {
            this.setStatus('error', `Connection failed: ${e}`);
            console.error(e);
        }
    }

    async disconnect() {
        if (!this.currentSessionId) return;
        this.closeSession(this.currentSessionId);
    }

    // ── Session Management ───────────────────────────────────

    addSession(sessionId, name) {
        // Create terminal container
        const container = document.createElement('div');
        container.className = 'terminal-instance';
        container.id = `term-${sessionId}`;
        // Ensure parent exists
        const parent = document.getElementById('terminals-container');
        if (parent) parent.appendChild(container);

        // Create terminal manager instance
        const termManager = new TerminalManager(this);
        termManager.init(sessionId, container);

        const session = {
            id: sessionId,
            name: name,
            terminalManager: termManager,
            container: container,
            fileManagerState: {
                path: '/', // Default, will be updated by fileManager flow
                history: []
            }
        };

        this.sessions.push(session);
        this.switchSession(sessionId);
        this.updateTabsUI();

        // Enable disconnect button
        const disBtn = document.getElementById('btn-disconnect');
        if (disBtn) disBtn.disabled = false;

        // Initial file load
        this.loadInitialFiles(sessionId);
    }

    async loadInitialFiles(sessionId) {
        // This mimics the logic that was in connect() before
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const homeDir = await invoke('sftp_get_home', { sessionId });
            // Only update fileManager if this session is active
            if (this.currentSessionId === sessionId) {
                await this.fileManager.loadDirectory(homeDir);
            } else {
                // Store initial path in state
                const session = this.sessions.find(s => s.id === sessionId);
                if (session) session.fileManagerState.path = homeDir;
            }
        } catch (e) {
            console.warn('Failed to get home directory', e);
            if (this.currentSessionId === sessionId) {
                await this.fileManager.loadDirectory('/');
            }
        }
    }

    switchSession(sessionId) {
        const oldSession = this.sessions.find(s => s.id === this.currentSessionId);
        const newSession = this.sessions.find(s => s.id === sessionId);

        if (!newSession) return;

        // Save state of old session
        if (oldSession) {
            oldSession.container.style.display = 'none';
            // Save file manager state
            oldSession.fileManagerState = this.fileManager.getState();
        }

        // Switch
        this.currentSessionId = sessionId;
        newSession.container.style.display = 'block';

        // Restore file manager state
        this.fileManager.setState(newSession.fileManagerState, sessionId);

        // Update UI
        this.setStatus('connected', `Connected to ${newSession.name}`);
        this.updateTabsUI();

        // Focus terminal
        if (newSession.terminalManager && newSession.terminalManager.terminal) {
            newSession.terminalManager.terminal.focus();
            newSession.terminalManager.fit();
        }
    }

    async closeSession(sessionId) {
        const sessionIndex = this.sessions.findIndex(s => s.id === sessionId);
        if (sessionIndex === -1) return;

        const session = this.sessions[sessionIndex];

        // Cleanup backend
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('ssh_disconnect', { sessionId });
        } catch (e) {
            console.error('Disconnect error:', e);
        }

        // Cleanup frontend
        session.terminalManager.destroy();
        session.container.remove();
        this.sessions.splice(sessionIndex, 1);

        // Switch to another tab or empty state
        if (this.sessions.length > 0) {
            // Switch to last available (or previous)
            const nextSession = this.sessions[Math.max(0, sessionIndex - 1)];
            this.switchSession(nextSession.id);
        } else {
            this.currentSessionId = null;
            this.handleDisconnect(); // Reset UI to empty state
            this.updateTabsUI();
        }
    }

    handleDisconnect() {
        this.currentSessionId = null;
        this.setStatus('disconnected', 'Disconnected');
        const placeholder = document.getElementById('terminal-placeholder');
        if (placeholder) placeholder.style.display = 'flex';

        const disBtn = document.getElementById('btn-disconnect');
        if (disBtn) disBtn.disabled = true;

        // Clear file manager
        this.fileManager.clear();
    }

    updateTabsUI() {
        const container = document.getElementById('tabs-container');
        if (!container) return;

        container.innerHTML = '';

        this.sessions.forEach(session => {
            const tab = document.createElement('div');
            tab.className = `tab ${session.id === this.currentSessionId ? 'active' : ''}`;

            // Icon
            tab.innerHTML = `
                <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 17l6-6-6-6M12 19h8" />
                </svg>
                <div class="tab-title" title="${session.name}">${session.name}</div>
                <div class="tab-close" title="Close Tab">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </div>
            `;

            tab.addEventListener('click', (e) => {
                if (!e.target.closest('.tab-close')) {
                    this.switchSession(session.id);
                }
            });

            tab.querySelector('.tab-close').addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeSession(session.id);
            });

            container.appendChild(tab);
        });

        // Toggle placeholder vs terminals container
        const placeholder = document.getElementById('terminal-placeholder');
        const terminalsContainer = document.getElementById('terminals-container');

        if (this.sessions.length === 0) {
            if (placeholder) placeholder.style.display = 'flex';
            if (terminalsContainer) terminalsContainer.style.display = 'none';
        } else {
            if (placeholder) placeholder.style.display = 'none';
            if (terminalsContainer) terminalsContainer.style.display = 'block';
        }
    }

    // ── Settings ─────────────────────────────────────────────

    showSettingsModal() {
        const modal = document.getElementById('settings-modal');
        const preset = localStorage.getItem('editorPreset') || 'system';
        const customPath = localStorage.getItem('editorCustomPath') || '';

        document.getElementById('editor-preset').value = preset;
        document.getElementById('custom-editor-path').value = customPath;
        document.getElementById('custom-editor-group').style.display = preset === 'custom' ? 'block' : 'none';

        modal.style.display = 'flex';
    }

    hideSettingsModal() {
        document.getElementById('settings-modal').style.display = 'none';
    }

    saveSettings() {
        const preset = document.getElementById('editor-preset').value;
        const customPath = document.getElementById('custom-editor-path').value;

        localStorage.setItem('editorPreset', preset);
        localStorage.setItem('editorCustomPath', customPath);

        this.hideSettingsModal();
    }

    getEditorConfig(presetOverride = null, customPathOverride = null) {
        const preset = presetOverride || localStorage.getItem('editorPreset') || 'system';
        const customPath = customPathOverride || localStorage.getItem('editorCustomPath') || '';

        if (preset === 'system') {
            return null; // Use opener::open()
        }

        if (preset === 'custom') {
            return customPath || null;
        }

        // Map presets to common paths based on platform
        const isMac = document.body.classList.contains('platform-macos');

        const editorPaths = isMac ? {
            'vscode': 'code',
            'sublime': 'subl',
            'textedit': 'open -e'
        } : {
            'vscode': 'code',
            'notepad++': 'C:\\Program Files\\Notepad++\\notepad++.exe',
            'sublime': 'C:\\Program Files\\Sublime Text\\sublime_text.exe',
            'atom': '%LOCALAPPDATA%\\atom\\atom.exe',
            'notepad': 'notepad.exe'
        };

        return editorPaths[preset] || (isMac ? null : editorPaths['notepad']);
    }
}

// ── Bootstrap ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
