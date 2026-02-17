/**
 * RustSSH — File Manager
 * SFTP file browser in the sidebar with drag-and-drop support.
 */

export class FileManager {
    constructor(app) {
        this.app = app;
        this.currentPath = '/';
        this.history = []; // Navigation history
        this.historyIndex = -1;
        this.files = [];
        this.selectedFile = null;
        this.state = {}; // For general state management

        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('btn-sftp-up').addEventListener('click', () => {
            this.navigateUp();
        });

        document.getElementById('btn-sftp-refresh').addEventListener('click', () => {
            this.loadDirectory(this.currentPath);
        });

        document.getElementById('btn-sftp-mkdir').addEventListener('click', () => {
            this.createFolder();
        });

        // Context menu
        document.addEventListener('click', () => {
            document.getElementById('context-menu').style.display = 'none';
        });

        document.querySelectorAll('#context-menu .context-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                if (this.selectedFile) {
                    this.handleContextAction(action, this.selectedFile);
                }
            });
        });

        // Drag-and-drop
        const fileList = document.getElementById('file-list');

        fileList.addEventListener('dragover', (e) => {
            // e.preventDefault();
            // e.stopPropagation();
            fileList.classList.add('drag-over');
        });

        fileList.addEventListener('dragleave', (e) => {
            e.preventDefault();
            fileList.classList.remove('drag-over');
        });

        // Listen for Tauri file drop events (provides absolute paths)
        this.initFileDropListener();
        this.initSyncListener();

        // Permissions modal
        this.bindPermissionsModal();
    }

    bindPermissionsModal() {
        const modal = document.getElementById('permissions-modal');
        document.getElementById('btn-perm-close').addEventListener('click', () => {
            modal.style.display = 'none';
        });
        document.getElementById('btn-perm-cancel').addEventListener('click', () => {
            modal.style.display = 'none';
        });
        modal.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                modal.style.display = 'none';
            }
        });
        document.getElementById('btn-perm-apply').addEventListener('click', () => {
            this.applyPermissions();
        });

        // Sync checkboxes with octal input
        document.querySelectorAll('.perm-check').forEach(cb => {
            cb.addEventListener('change', () => this.syncPermChecksToOctal());
        });
        document.getElementById('perm-octal').addEventListener('input', (e) => {
            this.syncOctalToPermChecks(e.target.value);
        });
    }

    async loadDirectory(path) {
        if (!this.app.currentSessionId) return;

        const fileList = document.getElementById('file-list');
        fileList.innerHTML = '<div class="file-loading"><div class="spinner"></div></div>';

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            this.files = await invoke('sftp_list', {
                sessionId: this.app.currentSessionId,
                path,
            });
            this.currentPath = path;

            document.getElementById('sftp-path-display').textContent = path;
            this.render();
        } catch (e) {
            fileList.innerHTML = `
        <div class="empty-state">
          <p style="color: var(--danger)">Error loading directory</p>
          <p class="hint">${e}</p>
        </div>
      `;
        }
    }

    render() {
        const fileList = document.getElementById('file-list');

        if (this.files.length === 0) {
            fileList.innerHTML = `
        <div class="empty-state">
          <p>Empty directory</p>
        </div>
      `;
            return;
        }

        fileList.innerHTML = this.files.map(file => `
      <div class="file-item" data-path="${this.escapeHtml(file.path)}" data-dir="${file.is_dir}" data-perms="${file.permissions || ''}">
        <div class="file-icon ${file.is_dir ? 'folder' : this.getFileIconClass(file.name)}">
          ${file.is_dir ? this.folderIcon() : this.fileIcon(file.name)}
        </div>
        <span class="file-name">${this.escapeHtml(file.name)}</span>
        ${file.permissions != null ? `<span class="file-perms">${this.formatPermissions(file.permissions)}</span>` : ''}
        ${!file.is_dir ? `<span class="file-size">${this.formatSize(file.size)}</span>` : ''}
      </div>
    `).join('');

        // Bind click events
        fileList.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('click', () => {
                // Remove previous selection
                fileList.querySelectorAll('.file-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                this.selectedFile = {
                    path: item.dataset.path,
                    isDir: item.dataset.dir === 'true',
                };
            });

            item.addEventListener('dblclick', () => {
                if (item.dataset.dir === 'true') {
                    this.loadDirectory(item.dataset.path);
                } else {
                    this.editFile(item.dataset.path);
                }
            });

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.selectedFile = {
                    path: item.dataset.path,
                    isDir: item.dataset.dir === 'true',
                };
                this.showContextMenu(e.clientX, e.clientY);
            });
        });
    }

    navigateUp() {
        if (this.currentPath === '/') return;
        const parts = this.currentPath.replace(/\/$/, '').split('/');
        parts.pop();
        const parent = parts.join('/') || '/';
        this.loadDirectory(parent);
    }

    async createFolder() {
        const name = prompt('New folder name:');
        if (!name) return;

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const path = this.currentPath.endsWith('/')
                ? `${this.currentPath}${name}`
                : `${this.currentPath}/${name}`;

            await invoke('sftp_mkdir', {
                sessionId: this.app.currentSessionId,
                path,
            });
            await this.loadDirectory(this.currentPath);
        } catch (e) {
            alert(`Error creating folder: ${e}`);
        }
    }

    showContextMenu(x, y) {
        const menu = document.getElementById('context-menu');
        menu.style.display = 'block';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        // Adjust if menu goes off screen
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${window.innerWidth - rect.width - 8}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${window.innerHeight - rect.height - 8}px`;
        }
    }

    async handleContextAction(action, file) {
        const { invoke } = await import('@tauri-apps/api/core');

        switch (action) {
            case 'download': {
                try {
                    const { save } = await import('@tauri-apps/plugin-dialog');
                    const fileName = file.path.split('/').pop();
                    const localPath = await save({ defaultPath: fileName });
                    if (localPath) {
                        this.app.setStatus('connected', `Downloading ${fileName}...`);
                        await invoke('sftp_download', {
                            sessionId: this.app.currentSessionId,
                            remotePath: file.path,
                            localPath,
                        });
                        this.app.setStatus('connected', 'Download complete');
                    }
                } catch (e) {
                    alert(`Download error: ${e}`);
                }
                break;
            }
            case 'open-with': {
                // Open native system dialog
                this.editFile(file.path, 'open-with-dialog');
                break;
            }
            case 'rename': {
                const oldName = file.path.split('/').pop();
                const newName = prompt('New name:', oldName);
                if (newName && newName !== oldName) {
                    try {
                        const parentPath = file.path.substring(0, file.path.lastIndexOf('/'));
                        const newPath = `${parentPath}/${newName}`;
                        await invoke('sftp_rename', {
                            sessionId: this.app.currentSessionId,
                            from: file.path,
                            to: newPath,
                        });
                        await this.loadDirectory(this.currentPath);
                    } catch (e) {
                        alert(`Rename error: ${e}`);
                    }
                }
                break;
            }
            case 'delete': {
                const name = file.path.split('/').pop();
                if (confirm(`Delete ${name}?`)) {
                    try {
                        await invoke('sftp_delete', {
                            sessionId: this.app.currentSessionId,
                            path: file.path,
                            isDir: file.isDir,
                        });
                        await this.loadDirectory(this.currentPath);
                    } catch (e) {
                        alert(`Delete error: ${e}`);
                    }
                }
                break;
            }
            case 'permissions': {
                this.showPermissionsModal(file);
                break;
            }
            case 'edit': {
                if (!file.isDir) {
                    this.editFile(file.path);
                }
                break;
            }
        }
    }

    async initFileDropListener() {
        console.log('Initializing Tauri 2 file drop listener...');
        try {
            const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
            const appWindow = getCurrentWebviewWindow();

            await appWindow.onDragDropEvent((event) => {
                console.log('Drag drop event:', event.payload.type, event.payload);
                const fileList = document.getElementById('file-list');

                if (event.payload.type === 'over') {
                    fileList.classList.add('drag-over');
                } else if (event.payload.type === 'drop') {
                    fileList.classList.remove('drag-over');
                    if (this.app.currentSessionId && event.payload.paths && event.payload.paths.length > 0) {
                        this.handleDrop(event.payload.paths);
                    } else {
                        console.warn('File drop ignored: No active session or no paths');
                    }
                } else if (event.payload.type === 'leave') {
                    fileList.classList.remove('drag-over');
                }
            });

            console.log('Tauri 2 file drop listener initialized.');
        } catch (e) {
            console.error('Failed to init file drop listener:', e);
        }
    }

    async handleDrop(paths) {
        console.log('Handling drop with paths:', paths);
        document.getElementById('file-list').classList.remove('drag-over');
        if (!this.app.currentSessionId || !paths || paths.length === 0) {
            console.warn('Drop ignored: validation failed', { sessionId: this.app.currentSessionId, paths });
            return;
        }

        const { invoke } = await import('@tauri-apps/api/core');

        for (const localPath of paths) {
            try {
                // Extract filename from path (windows or unix)
                const filename = localPath.split(/[\\/]/).pop();

                const remotePath = this.currentPath.endsWith('/')
                    ? `${this.currentPath}${filename}`
                    : `${this.currentPath}/${filename}`;

                this.app.setStatus('connected', `Uploading ${filename}...`);

                await invoke('sftp_upload', {
                    sessionId: this.app.currentSessionId,
                    localPath,
                    remotePath,
                });
            } catch (e) {
                alert(`Upload error: ${e}`);
            }
        }

        this.app.setStatus('connected', 'Upload complete');
        await this.loadDirectory(this.currentPath);
    }

    // ── Permissions Modal ─────────────────────────────────────

    showPermissionsModal(file) {
        const modal = document.getElementById('permissions-modal');
        document.getElementById('perm-file-name').textContent = file.path;
        this._permFile = file;

        // Find the file entry to get current permissions
        const entry = this.files.find(f => f.path === file.path);
        const mode = entry?.permissions || 0o644;

        // Set octal input
        const octalStr = (mode & 0o777).toString(8).padStart(3, '0');
        document.getElementById('perm-octal').value = octalStr;
        this.syncOctalToPermChecks(octalStr);
        this.updatePermPreview(octalStr);

        modal.style.display = 'flex';
    }

    syncPermChecksToOctal() {
        let octal = 0;
        if (document.getElementById('perm-owner-r').checked) octal += 400;
        if (document.getElementById('perm-owner-w').checked) octal += 200;
        if (document.getElementById('perm-owner-x').checked) octal += 100;
        if (document.getElementById('perm-group-r').checked) octal += 40;
        if (document.getElementById('perm-group-w').checked) octal += 20;
        if (document.getElementById('perm-group-x').checked) octal += 10;
        if (document.getElementById('perm-other-r').checked) octal += 4;
        if (document.getElementById('perm-other-w').checked) octal += 2;
        if (document.getElementById('perm-other-x').checked) octal += 1;

        const octalStr = octal.toString().padStart(3, '0');
        document.getElementById('perm-octal').value = octalStr;
        this.updatePermPreview(octalStr);
    }

    syncOctalToPermChecks(octalStr) {
        const digits = octalStr.padStart(3, '0').split('').map(Number);
        if (digits.length < 3 || digits.some(d => isNaN(d) || d > 7)) return;

        const [owner, group, other] = digits.slice(-3);
        document.getElementById('perm-owner-r').checked = !!(owner & 4);
        document.getElementById('perm-owner-w').checked = !!(owner & 2);
        document.getElementById('perm-owner-x').checked = !!(owner & 1);
        document.getElementById('perm-group-r').checked = !!(group & 4);
        document.getElementById('perm-group-w').checked = !!(group & 2);
        document.getElementById('perm-group-x').checked = !!(group & 1);
        document.getElementById('perm-other-r').checked = !!(other & 4);
        document.getElementById('perm-other-w').checked = !!(other & 2);
        document.getElementById('perm-other-x').checked = !!(other & 1);
        this.updatePermPreview(octalStr);
    }

    updatePermPreview(octalStr) {
        const digits = octalStr.padStart(3, '0').split('').map(Number);
        if (digits.length < 3) return;
        const [o, g, t] = digits.slice(-3);
        const rwx = (n) => `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
        document.getElementById('perm-preview').textContent = `${rwx(o)}${rwx(g)}${rwx(t)}`;
    }

    async applyPermissions() {
        if (!this._permFile) return;
        const octalStr = document.getElementById('perm-octal').value;
        const mode = parseInt(octalStr, 8);
        if (isNaN(mode)) {
            alert('Invalid permission value');
            return;
        }

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('sftp_chmod', {
                sessionId: this.app.currentSessionId,
                path: this._permFile.path,
                mode,
            });
            document.getElementById('permissions-modal').style.display = 'none';
            await this.loadDirectory(this.currentPath);
        } catch (e) {
            alert(`Failed to set permissions: ${e}`);
        }
    }

    // ── Remote File Editing ──────────────────────────────────

    async editFile(remotePath, editorOverride = null) {
        if (!this.app.currentSessionId) return;

        const filename = remotePath.split('/').pop();
        this.app.setStatus('connected', `Opening ${filename}...`);

        try {
            const { invoke } = await import('@tauri-apps/api/core');

            // Get editor preference (override > stored > system default)
            const editorPath = editorOverride || this.app.getEditorConfig();

            // Download to temp and open with configured editor (handled by backend)
            const localPath = await invoke('sftp_edit_file', {
                sessionId: this.app.currentSessionId,
                remotePath,
                editorPath,
            });

            // Start watching for changes
            await invoke('sftp_watch_file', {
                sessionId: this.app.currentSessionId,
                localPath,
                remotePath,
            });

            this.app.setStatus('connected', `Editing ${filename} — changes will auto-sync`);
        } catch (e) {
            alert(`Failed to open file: ${e}`);
            this.app.setStatus('connected', 'Connected');
        }
    }

    async initSyncListener() {
        try {
            const { listen } = await import('@tauri-apps/api/event');
            await listen('file-sync-status', (event) => {
                const { status, file, error } = event.payload;
                const filename = file?.split('/').pop() || 'file';

                if (status === 'synced') {
                    this.showSyncToast(`✓ ${filename} synced`, 'success');
                    this.loadDirectory(this.currentPath);
                } else if (status === 'error') {
                    this.showSyncToast(`✗ Sync failed: ${error}`, 'error');
                } else if (status === 'watching') {
                    this.showSyncToast(`👁 Watching ${filename}`, 'watching');
                }
            });
        } catch (e) {
            console.error('Failed to init sync listener:', e);
        }
    }

    showSyncToast(message, type = 'info') {
        // Remove existing toast
        const existing = document.querySelector('.sync-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `sync-toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    }

    clear() {
        this.files = [];
        this.currentPath = '/';
        document.getElementById('sftp-path-display').textContent = '/';
        document.getElementById('file-list').innerHTML = `
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <p>Not connected</p>
        <p class="hint">Connect to browse files</p>
      </div>
    `;
    }

    // ── Helpers ──────────────────────────────────────────────

    formatPermissions(mode) {
        if (mode == null) return '';
        const m = mode & 0o777;
        const rwx = (n) => `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
        return rwx((m >> 6) & 7) + rwx((m >> 3) & 7) + rwx(m & 7);
    }

    getFileIconClass(name) {
        const ext = name.split('.').pop()?.toLowerCase();
        const codeExts = ['js', 'ts', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'yaml', 'yml', 'toml', 'xml', 'sh', 'bash'];
        const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'];
        const archiveExts = ['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'];
        const textExts = ['txt', 'md', 'log', 'csv', 'ini', 'cfg', 'conf'];

        if (codeExts.includes(ext)) return 'file-code';
        if (imageExts.includes(ext)) return 'file-image';
        if (archiveExts.includes(ext)) return 'file-archive';
        if (textExts.includes(ext)) return 'file-text';
        return 'file';
    }

    folderIcon() {
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
    }

    fileIcon(name) {
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    }

    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── State Management ─────────────────────────────────────

    getState() {
        return {
            path: this.currentPath,
            history: [...this.history],
            historyIndex: this.historyIndex
        };
    }

    async setState(state, sessionId) {
        if (!state) return;

        this.currentPath = state.path || '/';
        this.history = state.history || [];
        this.historyIndex = typeof state.historyIndex === 'number' ? state.historyIndex : -1;

        // Only load if this matches current session (should be guaranteed by caller)
        if (this.app.currentSessionId === sessionId) {
            await this.loadDirectory(this.currentPath);
        }
    }
}
