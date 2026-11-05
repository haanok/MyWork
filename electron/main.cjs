const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const chokidar = require('chokidar');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SETTINGS_FILE = 'settings.json';
const TRASH_DIR = '.customer-board-trash';
let mainWindow;
let vaultRoot = null;
let watcher = null;
let watchTimer;

const settingsPath = () => path.join(app.getPath('userData'), SETTINGS_FILE);

async function readSettings() {
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    if (typeof settings.customerRoot !== 'string') return;
    const resolved = await fs.realpath(settings.customerRoot);
    if ((await fs.stat(resolved)).isDirectory()) vaultRoot = resolved;
  } catch {
    vaultRoot = null;
  }
}

async function writeSettings() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  const temp = `${settingsPath()}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ customerRoot: vaultRoot }, null, 2), 'utf8');
  await fs.rename(temp, settingsPath());
}

function requireRoot() {
  if (!vaultRoot) throw new Error('Choose a customer folder before using the vault.');
  return vaultRoot;
}

function resolveRelative(relativePath) {
  const root = requireRoot();
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Invalid vault-relative path.');
  }
  const normalized = relativePath.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part === TRASH_DIR)) {
    throw new Error('Invalid vault-relative path.');
  }
  const absolute = path.resolve(root, ...parts);
  if (!absolute.startsWith(`${root}${path.sep}`) || path.extname(absolute).toLowerCase() !== '.md') {
    throw new Error('Only Markdown files inside the selected customer folder are available.');
  }
  return absolute;
}

async function assertSafeParent(absolute) {
  const root = requireRoot();
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const realParent = await fs.realpath(path.dirname(absolute));
  if (!realParent.startsWith(`${root}${path.sep}`) && realParent !== root) {
    throw new Error('The path resolves outside the selected customer folder.');
  }
  try {
    if ((await fs.lstat(absolute)).isSymbolicLink()) throw new Error('Symbolic links cannot be edited.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function listMarkdown() {
  const root = requireRoot();
  const files = [];

  async function visit(directory, relativeDirectory = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, relativePath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
        const [content, stat] = await Promise.all([fs.readFile(absolute, 'utf8'), fs.stat(absolute)]);
        files.push({ path: relativePath, content, modifiedAt: stat.mtime.toISOString() });
      }
    }
  }

  await visit(root);
  return files;
}

async function chooseCustomerRoot() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the folder that contains customer folders',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  vaultRoot = await fs.realpath(result.filePaths[0]);
  await writeSettings();
  await startWatcher();
  return vaultRoot;
}

async function startWatcher() {
  if (watcher) await watcher.close();
  if (!vaultRoot) return;
  watcher = chokidar.watch(vaultRoot, {
    ignoreInitial: true,
    ignored: (filePath) => {
      const relative = path.relative(vaultRoot, filePath);
      return relative.split(path.sep).some((part) => part.startsWith('.'));
    },
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
  });
  watcher.on('all', (eventName, changedPath) => {
    if (path.extname(changedPath).toLowerCase() !== '.md') return;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('vault:changed');
      }
    }, 350);
  });
}

ipcMain.handle('vault:choose-root', chooseCustomerRoot);
ipcMain.handle('vault:get-root', () => vaultRoot);
ipcMain.handle('vault:list-markdown', listMarkdown);
ipcMain.handle('vault:write-markdown', async (_event, relativePath, content) => {
  if (typeof content !== 'string') throw new Error('Markdown content must be text.');
  const absolute = resolveRelative(relativePath);
  await assertSafeParent(absolute);
  const temp = `${absolute}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, absolute);
});
ipcMain.handle('vault:trash-markdown', async (_event, relativePath) => {
  const root = requireRoot();
  const source = resolveRelative(relativePath);
  const realSource = await fs.realpath(source);
  if (!realSource.startsWith(`${root}${path.sep}`)) throw new Error('The note is outside the selected customer folder.');
  const trash = path.join(root, TRASH_DIR);
  await fs.mkdir(trash, { recursive: true });
  const target = path.join(trash, `${Date.now()}-${crypto.randomUUID()}-${path.basename(source)}`);
  await fs.rename(source, target);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 850,
    minHeight: 620,
    backgroundColor: '#080b1b',
    title: 'Customer Board',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = app.isPackaged
      ? url.startsWith('file:')
      : url.startsWith('http://127.0.0.1:5173/');
    if (!allowed) event.preventDefault();
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    mainWindow.loadURL('http://127.0.0.1:5173');
  }
}

app.whenReady().then(async () => {
  await readSettings();
  await startWatcher();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  clearTimeout(watchTimer);
  if (watcher) void watcher.close();
});
