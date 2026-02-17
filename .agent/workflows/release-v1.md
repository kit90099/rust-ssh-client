---
description: Steps to release RustSSH v1.0.0
---
# RustSSH v1.0.0 Release Workflow

Follow these steps to generate and verify the production installers for RustSSH.

1. **Update Versioning**
   - In `src-tauri/tauri.conf.json`, set `"version": "1.0.0"`.
   - In `src-tauri/Cargo.toml`, set `version = "1.0.0"`.

2. **Configure Bundling**
   - Ensure `tauri.conf.json` has the `bundle` section with targets `["nsis", "dmg"]`.

3. **Install Build Dependencies**
   - Ensure Wix Toolset or NSIS is installed on the system (required for Windows).
   - macOS builds must be performed on a macOS machine.

4. **Run Production Build**
   // turbo
   Execute the following command in the project root:
   ```bash
   npm run tauri build
   ```

5. **Verify Artifacts**
   - Windows: `src-tauri/target/release/bundle/nsis/RustSSH_1.0.0_x64-setup.exe`
   - macOS: `src-tauri/target/release/bundle/dmg/RustSSH_1.0.0_x64.dmg` (on macOS)

6. **Cleanup**
   - Delete temporary build artifacts if necessary.
