/**
 * RustSSH — Connection Manager
 * Handles CRUD operations for saved SSH connections.
 */

export class ConnectionManager {
    constructor(app) {
        this.app = app;
        this.connections = [];
        this.activeId = null;
    }

    async loadConnections() {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            this.connections = await invoke('get_connections');
            this.render();
        } catch (e) {
            console.error('Failed to load connections:', e);
        }
    }

    render() {
        const list = document.getElementById('connections-list');

        if (this.connections.length === 0) {
            list.innerHTML = `
        <div class="empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
          </svg>
          <p>No connections yet</p>
          <p class="hint">Click + to add one</p>
        </div>
      `;
            return;
        }

        list.innerHTML = this.connections.map(conn => `
      <div class="connection-item ${this.activeId === conn.id ? 'active' : ''}"
           data-id="${conn.id}"
           title="Double-click to connect">
        <div class="conn-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <div class="conn-info">
          <div class="conn-name">${this.escapeHtml(conn.name)}</div>
          <div class="conn-host">${this.escapeHtml(conn.username)}@${this.escapeHtml(conn.host)}:${conn.port}</div>
        </div>
        ${this.activeId === conn.id ? '<div class="conn-status-dot online"></div>' : ''}
        <div class="conn-actions">
          <button class="icon-btn btn-edit-conn" data-id="${conn.id}" title="Edit">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="icon-btn btn-delete-conn" data-id="${conn.id}" title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `).join('');

        // Bind events
        list.querySelectorAll('.connection-item').forEach(item => {
            item.addEventListener('dblclick', () => {
                this.app.connect(item.dataset.id);
            });

            // Single click to select
            item.addEventListener('click', () => {
                this.app.currentConnectionId = item.dataset.id;
            });
        });

        list.querySelectorAll('.btn-edit-conn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.editConnection(btn.dataset.id);
            });
        });

        list.querySelectorAll('.btn-delete-conn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteConnection(btn.dataset.id);
            });
        });
    }

    showModal(conn = null) {
        const modal = document.getElementById('connection-modal');
        const title = document.getElementById('modal-title');

        if (conn) {
            title.textContent = 'Edit Connection';
            document.getElementById('conn-id').value = conn.id;
            document.getElementById('conn-name').value = conn.name;
            document.getElementById('conn-host').value = conn.host;
            document.getElementById('conn-port').value = conn.port;
            document.getElementById('conn-username').value = conn.username;
            document.getElementById('conn-auth-type').value = conn.auth_type === 'KeyFile' ? 'keyfile' : 'password';
            document.getElementById('conn-password').value = conn.password || '';
            document.getElementById('conn-keypath').value = conn.private_key_path || '';
            document.getElementById('conn-passphrase').value = conn.passphrase || '';

            // Toggle auth fields
            const isKey = conn.auth_type === 'KeyFile';
            document.getElementById('auth-password-fields').style.display = isKey ? 'none' : 'block';
            document.getElementById('auth-keyfile-fields').style.display = isKey ? 'block' : 'none';
        } else {
            title.textContent = 'New Connection';
            document.getElementById('connection-form').reset();
            document.getElementById('conn-id').value = '';
            document.getElementById('conn-port').value = '22';
            document.getElementById('auth-password-fields').style.display = 'block';
            document.getElementById('auth-keyfile-fields').style.display = 'none';
        }

        modal.style.display = 'flex';
    }

    hideModal() {
        document.getElementById('connection-modal').style.display = 'none';
    }

    editConnection(id) {
        const conn = this.connections.find(c => c.id === id);
        if (conn) {
            this.showModal(conn);
        }
    }

    async saveConnection() {
        try {
            const { invoke } = await import('@tauri-apps/api/core');

            const id = document.getElementById('conn-id').value || undefined;
            const name = document.getElementById('conn-name').value;
            const host = document.getElementById('conn-host').value;
            const port = parseInt(document.getElementById('conn-port').value, 10);
            const username = document.getElementById('conn-username').value;
            const authType = document.getElementById('conn-auth-type').value;
            const password = document.getElementById('conn-password').value || null;
            const privateKeyPath = document.getElementById('conn-keypath').value || null;
            const passphrase = document.getElementById('conn-passphrase').value || null;

            this.connections = await invoke('save_connection', {
                id: id || null,
                name,
                host,
                port,
                username,
                authType,
                password: authType === 'password' ? password : null,
                privateKeyPath: authType === 'keyfile' ? privateKeyPath : null,
                passphrase: authType === 'keyfile' ? passphrase : null,
            });

            this.hideModal();
            this.render();
        } catch (e) {
            console.error('Failed to save connection:', e);
            alert(`Error saving: ${e}`);
        }
    }

    async deleteConnection(id) {
        if (!confirm('Delete this connection?')) return;

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            this.connections = await invoke('delete_connection', { id });
            this.render();
        } catch (e) {
            console.error('Failed to delete connection:', e);
        }
    }

    setActive(id) {
        this.activeId = id;
        this.render();
    }

    clearActive() {
        this.activeId = null;
        this.render();
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}
