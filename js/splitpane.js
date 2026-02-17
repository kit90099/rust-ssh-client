/**
 * RustSSH — Split Pane (Sidebar Resize)
 * Allows the user to resize the sidebar by dragging the handle.
 */

export function initSplitPane() {
    const sidebar = document.getElementById('sidebar');
    const handle = document.getElementById('sidebar-resize-handle');

    if (!sidebar || !handle) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const diff = e.clientX - startX;
        const newWidth = Math.min(
            Math.max(startWidth + diff, parseInt(getComputedStyle(sidebar).minWidth)),
            parseInt(getComputedStyle(sidebar).maxWidth)
        );

        sidebar.style.width = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
}
