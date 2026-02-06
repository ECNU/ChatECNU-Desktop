const { app, BrowserWindow, BrowserView, Tray, Menu, nativeImage, shell, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { version } = require('./package.json');
const { initUpdater, checkForUpdates, autoCheckOnStartup } = require('./updater');

// 配置存储
const store = new Store({
  defaults: {
    spriteMode: false,    // 暂时关闭
    minimizeToTray: true,
    uatMode: false,       // 暂时关闭
    uatActive: false
  }
});


// 应用标题
const APP_TITLE = `ChatECNU Desktop v${version}`;

// 判断是否为打包后的应用
const isPackaged = app.isPackaged;

// 命令行参数：--uat 强制启用 UAT 模式
const forceUat = process.argv.includes('--uat');

// ========== 窗口尺寸常量 ==========
const MAIN_WINDOW_WIDTH = 1280;
const MAIN_WINDOW_HEIGHT = 768;
const SETTINGS_WINDOW_WIDTH = 400;
const SETTINGS_WINDOW_HEIGHT = 150;

// ========== 标题栏常量 ==========
const TITLEBAR_HEIGHT = 40;

// ========== 颜色常量 ==========
const COLOR_UAT = '#bf360c';
const COLOR_DEFAULT = '#1a1a2e';
const COLOR_SYMBOL = '#ffffff';

// ========== URL 和域名常量 ==========
const URL_PRODUCTION = 'https://chat.ecnu.edu.cn';
const URL_UAT = 'http://59.78.189.137';
const ALLOWED_DOMAINS = [URL_PRODUCTION, 'https://sso.ecnu.edu.cn', URL_UAT];

// ========== 精灵窗口常量 ==========
const SPRITE_WINDOW_EDGE_OFFSET = 20;

// ========== 更新检查常量 ==========
const UPDATE_CHECK_STARTUP_DELAY = 3000; // 启动时检查更新的延迟（毫秒）

// 获取图标路径（打包后和开发时路径不同）
function getIconPath(filename) {
  if (isPackaged) {
    // 打包后：图标在 resources 目录
    return path.join(process.resourcesPath, filename);
  } else {
    // 开发时：图标在 build 目录
    return path.join(__dirname, 'build', filename);
  }
}

let mainWindow;
let view; // BrowserView 实例
let tray = null;
let isQuitting = false;
let spriteWindow = null; // 精灵模式悬浮球窗口
let settingsWindow = null; // 设置窗口

function createWindow() {
  // 图标路径
  const iconPath = getIconPath('chatecnu.ico');
  const isUatModeEnabled = store.get('uatMode') || forceUat; // UAT 功能是否启用
  const isUatActive = store.get('uatActive'); // UAT 环境是否激活
  const shouldUseUat = forceUat || (isUatModeEnabled && isUatActive); // 启动时是否使用 UAT
  
  // 创建主窗口（App Shell）
  mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    resizable: true,
    titleBarStyle: 'hidden', // 隐藏原生标题栏，但保留控制按钮
    titleBarOverlay: {
      color: shouldUseUat ? COLOR_UAT : COLOR_DEFAULT,
      symbolColor: COLOR_SYMBOL, // 控制按钮图标颜色
      height: TITLEBAR_HEIGHT // 强制高度，确保与前端 CSS 完全一致
    },
    icon: iconPath,
    title: APP_TITLE,
    webPreferences: {
      nodeIntegration: true, // 允许 Shell 使用 Node API
      contextIsolation: false,
    }
  });

  // 加载 App Shell (包含自定义标题栏)
  mainWindow.loadFile('index.html');

  // 移除默认菜单（防止 Ctrl+R 刷新等意外操作）
  Menu.setApplicationMenu(null);

  // 初始化图标传给 Shell
  mainWindow.webContents.on('did-finish-load', () => {
    // 读取图标并转换为 dataURL 发送给渲染进程
    const icon = nativeImage.createFromPath(iconPath);
    mainWindow.webContents.send('set-icon', icon.toDataURL());
    // 发送版本号
    mainWindow.webContents.send('set-version', version);
    // 同步最大化状态
    mainWindow.webContents.send('maximize-change', mainWindow.isMaximized());
    // 发送 UAT 模式信息
    mainWindow.webContents.send('set-uat-mode', { enabled: isUatModeEnabled, active: shouldUseUat });
  });

  // 创建 BrowserView 加载远程内容
  view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js') // 业务逻辑 preload
    }
  });
  
  mainWindow.setBrowserView(view);
  
  // 当前标题栏高度（默认为 TITLEBAR_HEIGHT，后续由前端动态更新）
  let currentTitlebarHeight = TITLEBAR_HEIGHT + 1; // +1 用于补偿边框

  // 设置 BrowserView 布局
  const updateViewBounds = () => {
    if (!mainWindow || !view) return;
    const contentBounds = mainWindow.getContentBounds();
    view.setBounds({ 
      x: 0, 
      y: currentTitlebarHeight, // 动态高度
      width: contentBounds.width, 
      height: contentBounds.height - currentTitlebarHeight 
    });
  };

  updateViewBounds();
  
  // 监听窗口大小变化
  mainWindow.on('resize', updateViewBounds);
  mainWindow.on('maximize', () => {
    updateViewBounds();
    mainWindow.webContents.send('maximize-change', true);
  });
  mainWindow.on('unmaximize', () => {
    updateViewBounds();
    mainWindow.webContents.send('maximize-change', false);
  });

  // 阻止网页修改窗口标题
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  // 允许的域名列表
  const isAllowedUrl = (url) => ALLOWED_DOMAINS.some(domain => url.startsWith(domain));

  // 禁止打开新窗口
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      view.webContents.loadURL(url);
    } else {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 拦截域外链接跳转
  view.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // 拦截键盘事件，禁用刷新快捷键
  view.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
      event.preventDefault();
    }
    if (input.key === 'F5') {
      event.preventDefault();
    }
  });

  // 加载目标网站
  const startUrl = shouldUseUat ? URL_UAT : URL_PRODUCTION;
  view.webContents.loadURL(startUrl);

  // 拦截窗口关闭事件
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      if (store.get('minimizeToTray')) {
        event.preventDefault();
        mainWindow.hide();
      } else {
        // 不最小化到托盘时，直接退出应用
        isQuitting = true;
        app.quit();
      }
    }
  });

  // 确保在自动更新退出时也能正确关闭窗口
  app.on('before-quit', () => {
    isQuitting = true;
  });

  // 窗口关闭时
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ========== JSBridge ==========
// 当前 web 版本（由前端上报）
let currentWebVersion = null;

// 比较版本号，返回 1 (a > b), -1 (a < b), 0 (a == b)
function compareVersions(a, b) {
  const partsA = a.replace(/^v/, '').split('.').map(Number);
  const partsB = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

// 检查 web 版本更新
async function checkWebVersionUpdate(reportedVersion) {
  try {
    // 根据当前环境确定 API 地址（与 createWindow 逻辑保持一致）
    const shouldUseUat = forceUat || (store.get('uatMode') && store.get('uatActive'));
    const baseUrl = shouldUseUat ? URL_UAT : URL_PRODUCTION;
    const url = `${baseUrl}/api/version/latest?_t=${Date.now()}`;
    
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.code === 0 && result.data && result.data.version) {
      const serverVersion = result.data.version;
      // 比较：服务器版本 > 当前加载版本
      if (compareVersions(serverVersion, reportedVersion) > 0) {
        console.log(`[web-update] new version available: ${reportedVersion} -> ${serverVersion}`);
        // 通知主窗口显示提示
        if (mainWindow) {
          mainWindow.webContents.send('web-update-available', {
            current: reportedVersion,
            latest: serverVersion
          });
        }
      } else {
        console.log(`[web-update] up to date: ${reportedVersion}`);
      }
    }
  } catch (err) {
    console.error('[web-update] check failed:', err.message);
  }
}

// 网页通过 _tx.status(key, value) 告知客户端状态
ipcMain.on('tx:status', (event, key, value) => {
  console.log(`[tx:status] ${key}:`, value);
  
  // 处理 version 上报
  if (key === 'version' && value && value.frontend) {
    const reportedVersion = value.frontend.replace(/^v/, '');
    // 避免重复检查同一版本
    if (currentWebVersion !== reportedVersion) {
      currentWebVersion = reportedVersion;
      checkWebVersionUpdate(reportedVersion);
    }
  }
});

// 向网页发送事件（供主进程其他模块调用）
function emitToWeb(eventName, data) {
  if (view && view.webContents) {
    view.webContents.send('tx:event', eventName, data);
  }
}

// IPC: 检查更新
ipcMain.on('check-for-updates', () => checkForUpdates(true));

// IPC: 刷新页面
ipcMain.on('reload-page', () => {
  if (view && view.webContents) {
    view.webContents.reload();
  }
});

// IPC: 切换环境
ipcMain.on('switch-env', (event, isUat) => {
  // 保存 UAT 激活状态
  store.set('uatActive', isUat);
  
  if (view && view.webContents) {
    const url = isUat ? URL_UAT : URL_PRODUCTION;
    view.webContents.loadURL(url);
  }
  // 更新 titleBarOverlay 颜色
  if (mainWindow) {
    mainWindow.setTitleBarOverlay({
      color: isUat ? COLOR_UAT : COLOR_DEFAULT,
      symbolColor: COLOR_SYMBOL,
      height: TITLEBAR_HEIGHT
    });
  }
});

// IPC: 下载更新
ipcMain.on('download-update', () => {
  const { downloadUpdate } = require('./updater');
  downloadUpdate();
});

// IPC: 安装更新
ipcMain.on('install-update', () => {
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'question',
    title: '安装更新',
    message: '即将安装新版本并重启应用',
    detail: '请确保您的工作内容已保存。是否继续？',
    buttons: ['立即安装', '取消'],
    defaultId: 0,
    cancelId: 1
  });

  if (choice === 0) {
    const { quitAndInstall } = require('./updater');
    // 关键修复：移除所有阻止窗口关闭的监听器
    if (mainWindow) {
      mainWindow.removeAllListeners('close');
      mainWindow.close();
    }
    quitAndInstall();
  }
});

// ========== 精灵模式（悬浮球）==========
const SPRITE_SIZE = 64;

function createSpriteWindow() {
  if (spriteWindow) {
    spriteWindow.show();
    return;
  }

  const iconPath = getIconPath('chatecnu.ico');
  // 使用主窗口所在的显示器
  const mainBounds = mainWindow ? mainWindow.getBounds() : { x: 0, y: 0 };
  const display = screen.getDisplayNearestPoint({ x: mainBounds.x, y: mainBounds.y });
  const { x: workX, y: workY, width: screenWidth, height: screenHeight } = display.workArea;

  spriteWindow = new BrowserWindow({
    width: SPRITE_SIZE,
    height: SPRITE_SIZE,
    x: workX + screenWidth - SPRITE_SIZE - SPRITE_WINDOW_EDGE_OFFSET,
    y: workY + Math.floor(screenHeight / 2),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  spriteWindow.loadFile('sprite.html');
  spriteWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 页面加载完成后发送图标
  spriteWindow.webContents.on('did-finish-load', () => {
    const icon = nativeImage.createFromPath(iconPath);
    spriteWindow.webContents.send('set-sprite-icon', icon.toDataURL());
  });

  spriteWindow.on('closed', () => {
    spriteWindow = null;
  });
}

// IPC: 进入精灵模式
ipcMain.on('enter-sprite-mode', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
  createSpriteWindow();
});

// IPC: 恢复主窗口
ipcMain.on('sprite-restore', () => {
  if (spriteWindow) {
    spriteWindow.close();
    spriteWindow = null;
  }
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// IPC: 获取悬浮球位置
ipcMain.handle('sprite-get-position', () => {
  if (!spriteWindow) return { x: 0, y: 0 };
  const [x, y] = spriteWindow.getPosition();
  return { x, y };
});

// IPC: 设置悬浮球位置
ipcMain.on('sprite-set-position', (event, x, y) => {
  if (spriteWindow) {
    spriteWindow.setPosition(x, y);
  }
});

// IPC: 悬浮球右键菜单
ipcMain.on('sprite-context-menu', () => {
  const menuTemplate = [
    {
      label: '恢复窗口',
      click: () => {
        if (spriteWindow) {
          spriteWindow.close();
          spriteWindow = null;
        }
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ];
  
  const menu = Menu.buildFromTemplate(menuTemplate);
  menu.popup({ window: spriteWindow });
});

// ========== 设置窗口 ==========
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  const iconPath = getIconPath('chatecnu.ico');
  
  settingsWindow = new BrowserWindow({
    width: SETTINGS_WINDOW_WIDTH,
    height: SETTINGS_WINDOW_HEIGHT,
    parent: mainWindow,
    modal: false,
    frame: false,
    resizable: false,
    useContentSize: true,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  settingsWindow.loadFile('settings.html');

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// IPC: 打开设置窗口
ipcMain.on('open-settings', () => {
  createSettingsWindow();
});

// IPC: 关闭设置窗口
ipcMain.on('close-settings', () => {
  if (settingsWindow) {
    settingsWindow.close();
  }
});

// IPC: 获取设置
ipcMain.handle('get-settings', () => {
  return {
    spriteMode: store.get('spriteMode'),
    minimizeToTray: store.get('minimizeToTray'),
    uatMode: store.get('uatMode')
  };
});

// IPC: 保存设置
ipcMain.on('save-settings', (event, settings) => {
  store.set('spriteMode', settings.spriteMode);
  store.set('minimizeToTray', settings.minimizeToTray);
  store.set('uatMode', settings.uatMode);
  
  // 通知主窗口更新设置
  if (mainWindow) {
    mainWindow.webContents.send('settings-changed', settings);
    
    // 如果关闭 UAT 功能，重置激活状态并恢复颜色
    if (!settings.uatMode) {
      store.set('uatActive', false);
      mainWindow.setTitleBarOverlay({
        color: COLOR_DEFAULT,
        symbolColor: COLOR_SYMBOL,
        height: TITLEBAR_HEIGHT
      });
    }
    
    // 更新 UAT 模式开关显示
    const isActive = settings.uatMode ? store.get('uatActive') : false;
    mainWindow.webContents.send('set-uat-mode', { enabled: settings.uatMode, active: isActive });
  }
  // 通知 BrowserView 更新设置
  if (view) {
    view.webContents.send('settings-changed', settings);
  }
});

// 单实例锁：禁止多开
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // 当第二个实例启动时，唤起已存在的窗口
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Electron 初始化完成并准备创建浏览器窗口时调用
  app.whenReady().then(() => {
  createWindow();

  // 创建系统托盘（Windows 会根据 DPI 自动选择合适的图标尺寸）
  const trayIconPath = getIconPath('chatecnu.ico');
  const trayIcon = nativeImage.createFromPath(trayIconPath);
  
  tray = new Tray(trayIcon);
  tray.setToolTip(APP_TITLE);
  
  // 创建右键菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      type: 'separator'
    },
    {
      label: '检查更新',
      click: () => {
        checkForUpdates(true);
      }
    },
    {
      type: 'separator'
    },
    {
      label: '退出',
      click: () => {
        // 退出前确认，避免误操作丢失数据
        const choice = dialog.showMessageBoxSync(mainWindow, {
          type: 'question',
          title: '退出应用',
          message: '确定要退出应用吗？',
          detail: '退出前请确保您的工作内容已保存。',
          buttons: ['退出', '取消'],
          defaultId: 0,
          cancelId: 1
        });
        
        if (choice === 0) {
          isQuitting = true;
          app.quit();
        }
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  
  // 双击托盘图标显示窗口
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('activate', () => {
    // 在 macOS 上，当单击 dock 图标并且没有其他窗口打开时，
    // 通常在应用程序中重新创建一个窗口
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // 初始化更新器（仅在打包后启用）
  if (isPackaged) {
    initUpdater(mainWindow);
    autoCheckOnStartup(UPDATE_CHECK_STARTUP_DELAY);
  }
});

  // 当所有窗口关闭时不退出，保持应用在后台运行（通过系统托盘）
  app.on('window-all-closed', () => {
    // 不自动退出，让应用在后台运行以保持会话
    // 用户可以通过托盘菜单的"退出"选项来真正退出应用
  });
}

