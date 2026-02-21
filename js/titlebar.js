import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

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
