import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

// Enable window dragging from the custom titlebar
const dragRegion = document.querySelector('.titlebar-drag-region');
if (dragRegion) {
    dragRegion.addEventListener('mousedown', async (e) => {
        // Only drag on left-click directly on the drag region or title
        if (e.button !== 0) return;
        // Don't drag if clicking on interactive elements
        if (e.target.closest('button, input, select, a')) return;
        await appWindow.startDragging();
    });
}

document.getElementById('titlebar-minimize').addEventListener('click', () => {
    appWindow.minimize();
});

document.getElementById('titlebar-maximize').addEventListener('click', async () => {
    const isMaximized = await appWindow.isMaximized();
    if (isMaximized) {
        appWindow.unmaximize();
    } else {
        appWindow.maximize();
    }
});

document.getElementById('titlebar-close').addEventListener('click', () => {
    appWindow.close();
});
