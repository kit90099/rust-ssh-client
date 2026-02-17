/**
 * RustSSH — Terminal Manager
 * Wraps xterm.js and bridges it to the Tauri SSH backend.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export class TerminalManager {
    constructor(app) {
        this.app = app;
        this.terminal = null;
        this.fitAddon = null;
        this.sessionId = null;
        this.resizeObserver = null;
    }

    init(sessionId, container) {
        this.sessionId = sessionId;

        // Create terminal instance
        this.terminal = new Terminal({
            fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
            fontSize: 14,
            lineHeight: 1.3,
            cursorBlink: true,
            cursorStyle: 'bar',
            theme: {
                background: '#0a0e1a',
                foreground: '#e8ecf4',
                cursor: '#00e5ff',
                cursorAccent: '#0a0e1a',
                selectionBackground: 'rgba(0, 229, 255, 0.2)',
                selectionForeground: '#e8ecf4',
                black: '#1a1e2e',
                red: '#ff4d6a',
                green: '#00e676',
                yellow: '#ffc107',
                blue: '#448aff',
                magenta: '#7c4dff',
                cyan: '#00e5ff',
                white: '#e8ecf4',
                brightBlack: '#4d5670',
                brightRed: '#ff6b84',
                brightGreen: '#33eb91',
                brightYellow: '#ffd54f',
                brightBlue: '#69a5ff',
                brightMagenta: '#a17fff',
                brightCyan: '#33ebff',
                brightWhite: '#ffffff',
            },
            allowProposedApi: true,
        });

        // Addons
        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(new WebLinksAddon());

        // Open terminal in specific container
        this.terminal.open(container);

        // Initial fit
        setTimeout(() => {
            this.fitAddon.fit();
        }, 50);

        // Handle user input → send to SSH backend
        this.terminal.onData(async (data) => {
            if (!this.sessionId) return;
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const bytes = new TextEncoder().encode(data);
                await invoke('ssh_write', {
                    sessionId: this.sessionId,
                    data: Array.from(bytes),
                });
            } catch (e) {
                console.error('SSH write error:', e);
            }
        });

        // Handle resize
        this.terminal.onResize(async ({ cols, rows }) => {
            if (!this.sessionId) return;
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('ssh_resize', {
                    sessionId: this.sessionId,
                    cols,
                    rows,
                });
            } catch (e) {
                console.error('SSH resize error:', e);
            }
        });

        // Auto-resize on container size change
        this.resizeObserver = new ResizeObserver(() => {
            if (this.fitAddon && this.terminal) {
                try {
                    this.fitAddon.fit();
                } catch (e) {
                    // ignore fit errors during transitions
                }
            }
        });
        this.resizeObserver.observe(container);

        // Focus terminal
        this.terminal.focus();
    }

    writeData(data) {
        if (this.terminal) {
            this.terminal.write(data);
        }
    }

    fit() {
        if (this.fitAddon) {
            try {
                this.fitAddon.fit();
            } catch (e) { }
        }
    }

    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (this.terminal) {
            this.terminal.dispose();
            this.terminal = null;
        }

        this.fitAddon = null;
        this.sessionId = null;
    }
}
