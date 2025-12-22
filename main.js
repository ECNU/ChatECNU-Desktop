const { app, BrowserWindow, BrowserView, Tray, Menu, nativeImage, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const { version } = require('./package.json');
const { initUpdater, checkForUpdates, autoCheckOnStartup } = require('./updater');

// 应用标题
const APP_TITLE = `ChatECNU Desktop v${version}`;

// 判断是否为打包后的应用
const isPackaged = app.isPackaged;

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

function createWindow() {
  // 图标路径
  const iconPath = getIconPath('favicon.ico');
  
  // 创建主窗口（App Shell）
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 768,
    resizable: true,
    titleBarStyle: 'hidden', // 隐藏原生标题栏，但保留控制按钮
    titleBarOverlay: {
      color: '#1a1a2e', // 标题栏背景色
      symbolColor: '#ffffff', // 控制按钮图标颜色
      height: 38 // 与 index.html 中的标题栏高度一致
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

  // 初始化图标传给 Shell
  mainWindow.webContents.on('did-finish-load', () => {
    // 读取图标并转换为 dataURL 发送给渲染进程
    const icon = nativeImage.createFromPath(iconPath);
    mainWindow.webContents.send('set-icon', icon.toDataURL());
    // 同步最大化状态
    mainWindow.webContents.send('maximize-change', mainWindow.isMaximized());
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
  
  // 设置 BrowserView 布局（避开标题栏高度 38px）
  const updateViewBounds = () => {
    const bounds = mainWindow.getBounds();
    // 注意：BrowserView 的 bounds 是相对于窗口内容区域的
    // Windows 上无边框窗口的内容区域就是整个窗口
    const contentBounds = mainWindow.getContentBounds();
    view.setBounds({ 
      x: 0, 
      y: 38, // 标题栏高度
      width: contentBounds.width, 
      height: contentBounds.height - 38 
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
  const allowedDomains = ['https://chat.ecnu.edu.cn', 'https://sso.ecnu.edu.cn'];
  const isAllowedUrl = (url) => allowedDomains.some(domain => url.startsWith(domain));

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

  // 加载目标网站
  view.webContents.loadURL('https://chat.ecnu.edu.cn');

  // 拦截窗口关闭事件
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
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

// IPC: 显示保存对话框（需要将 mainWindow 传给 dialog）
ipcMain.handle('show-save-dialog', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出表格',
    defaultPath: defaultName,
    filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }]
  });
  return result.filePath;
});

// IPC: 检查更新
ipcMain.on('check-for-updates', () => checkForUpdates(true));

// IPC: 下载更新
ipcMain.on('download-update', () => {
  const { downloadUpdate } = require('./updater');
  downloadUpdate();
});

// IPC: 安装更新
ipcMain.on('install-update', () => {
  const { quitAndInstall } = require('./updater');
  // 关键修复：移除所有阻止窗口关闭的监听器
  if (mainWindow) {
    mainWindow.removeAllListeners('close');
    mainWindow.close();
  }
  quitAndInstall();
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
  const trayIconPath = getIconPath('favicon.ico');
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
        isQuitting = true;
        app.quit();
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
    autoCheckOnStartup(3000); // 延迟 3 秒检查更新
  }
});

  // 当所有窗口关闭时不退出，保持应用在后台运行（通过系统托盘）
  app.on('window-all-closed', () => {
    // 不自动退出，让应用在后台运行以保持会话
    // 用户可以通过托盘菜单的"退出"选项来真正退出应用
  });
}

