# Packaging Instructions — BugMind AI Extension

To package the BugMind AI extension for distribution or submission to the Chrome Web Store, follow these steps:

## 1. Prepare the Build
Ensure you have the latest dependencies and run the production build:

```bash
cd extension
npm install
npm run build
```

The build output will be located in the `extension/dist` directory.

## 2. Verify Build Output
Check that the `extension/dist` folder contains the following structure:
- `manifest.json`
- `sidepanel.html`
- `assets/` (containing `sidepanel.js`, `sidepanel.css`, `background.js`, `content.js`, etc.)
- `icons/` (containing `icon128.png`)

## 3. Create the ZIP Archive
Create a ZIP archive of the **contents** of the `dist` directory (not the `dist` folder itself).

### On macOS/Linux:
```bash
cd extension/dist
zip -r ../bugmind-ai-extension.zip .
```

### On Windows:
1. Navigate to `extension/dist`.
2. Select all files and folders.
3. Right-click → Send to → Compressed (zipped) folder.
4. Rename it to `bugmind-ai-extension.zip`.

## 4. Exclusion Rules
Ensure the following are **NOT** included in the ZIP archive:
- `node_modules/`
- `.env` files
- `src/` (source code)
- `tsconfig.json`, `vite.config.ts`, etc.
- Any `.git` or `.github` folders

The ZIP should only contain the static assets required for the extension to run in the browser.
