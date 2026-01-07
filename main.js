const { app, BrowserWindow, BrowserView, Tray, Menu, nativeImage, shell, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { version } = require('./package.json');
const { initUpdater, checkForUpdates, autoCheckOnStartup } = require('./updater');

// 配置存储
const store = new Store({
  defaults: {
    tableExport: false,   // 暂时关闭
    spriteMode: false,    // 暂时关闭
    minimizeToTray: true,
    uatMode: false,       // 暂时关闭
    uatActive: false,
    meetingAssistant: false
  }
});


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
let spriteWindow = null; // 精灵模式悬浮球窗口
let settingsWindow = null; // 设置窗口

function createWindow() {
  // 图标路径
  const iconPath = getIconPath('chatecnu.ico');
  const isUatModeEnabled = store.get('uatMode'); // UAT 功能是否启用
  const isUatActive = store.get('uatActive'); // UAT 环境是否激活
  const shouldUseUat = isUatModeEnabled && isUatActive; // 启动时是否使用 UAT
  
  // 创建主窗口（App Shell）
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 768,
    resizable: true,
    titleBarStyle: 'hidden', // 隐藏原生标题栏，但保留控制按钮
    titleBarOverlay: {
      color: shouldUseUat ? '#bf360c' : '#1a1a2e',
      symbolColor: '#ffffff', // 控制按钮图标颜色
      height: 40 // 强制高度，确保与前端 CSS 完全一致
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
  
  // 当前标题栏高度（默认为 40，后续由前端动态更新）
  let currentTitlebarHeight = 41;

  // 设置 BrowserView 布局
  const updateViewBounds = () => {
    if (!mainWindow || !view) return;
    const bounds = mainWindow.getBounds();
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
  const allowedDomains = ['https://chat.ecnu.edu.cn', 'https://sso.ecnu.edu.cn', 'http://59.78.189.137'];
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
  const startUrl = shouldUseUat ? 'http://59.78.189.137' : 'https://chat.ecnu.edu.cn';
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
    const url = isUat ? 'http://59.78.189.137' : 'https://chat.ecnu.edu.cn';
    view.webContents.loadURL(url);
  }
  // 更新 titleBarOverlay 颜色
  if (mainWindow) {
    mainWindow.setTitleBarOverlay({
      color: isUat ? '#bf360c' : '#1a1a2e',
      symbolColor: '#ffffff',
      height: 40
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
    x: workX + screenWidth - SPRITE_SIZE - 20,
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

// 检查会议助手是否可用
function isMeetingAssistantAvailable() {
  return store.get('meetingAssistant') && store.get('uatMode') && store.get('uatActive');
}

// IPC: 悬浮球右键菜单
ipcMain.on('sprite-context-menu', () => {
  const meetingAvailable = isMeetingAssistantAvailable();
  
  const menuTemplate = [];
  
  // 只有在会议助手可用时才显示菜单项
  if (meetingAvailable) {
    menuTemplate.push({
      label: '会议助手',
      click: () => {
        createMeetingWindow();
      }
    });
    menuTemplate.push({ type: 'separator' });
  }
  
  menuTemplate.push({
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
  });
  menuTemplate.push({ type: 'separator' });
  menuTemplate.push({
    label: '退出',
    click: () => {
      isQuitting = true;
      app.quit();
    }
  });
  
  const menu = Menu.buildFromTemplate(menuTemplate);
  menu.popup({ window: spriteWindow });
});

// ========== 会议助手 ==========
const { MeetingAPI } = require('./meeting-api');
let meetingAPI = null;
let meetingRecorderActive = false;
let meetingWindow = null; // 独立会议助手窗口

// 创建独立会议助手窗口
function createMeetingWindow() {
  if (meetingWindow) {
    meetingWindow.focus();
    return;
  }

  const iconPath = getIconPath('chatecnu.ico');
  
  meetingWindow = new BrowserWindow({
    width: 380,
    height: 480,
    frame: false,
    resizable: false,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  meetingWindow.loadFile('meeting.html');

  meetingWindow.on('closed', () => {
    meetingWindow = null;
  });
}

// IPC: 检查会议助手是否可用
ipcMain.handle('meeting-assistant-available', () => {
  return isMeetingAssistantAvailable();
});

// IPC: 打开会议助手窗口
ipcMain.on('open-meeting-assistant', () => {
  if (isMeetingAssistantAvailable()) {
    createMeetingWindow();
  }
});

// IPC: 关闭会议助手窗口
ipcMain.on('close-meeting-window', () => {
  if (meetingWindow) {
    meetingWindow.close();
  }
});

// IPC: 设置会议窗口置顶
ipcMain.on('meeting-set-always-on-top', (event, alwaysOnTop) => {
  if (meetingWindow) {
    meetingWindow.setAlwaysOnTop(alwaysOnTop);
  }
});

// 广播录音状态到悬浮球
function broadcastRecordingState(isRecording) {
  if (spriteWindow) {
    spriteWindow.webContents.send('meeting-recording-state', isRecording);
  }
}

// IPC: 开始会议
ipcMain.handle('meeting-start', async () => {
  try {
    // 初始化 API（如果需要）
    if (!meetingAPI) {
      meetingAPI = new MeetingAPI();
    }
    
    // 创建会议
    const result = await meetingAPI.createMeeting('desktop-user', '桌面会议');
    meetingRecorderActive = true;
    
    // 广播状态到悬浮球
    broadcastRecordingState(true);
    
    console.log('[Meeting] 会议已创建:', result.meetingId);
    return { success: true, meetingId: result.meetingId };
  } catch (error) {
    console.error('[Meeting] 创建会议失败:', error);
    return { success: false, error: error.message };
  }
});

// IPC: 结束会议
ipcMain.handle('meeting-end', async () => {
  try {
    meetingRecorderActive = false;
    
    // 广播状态到悬浮球
    broadcastRecordingState(false);
    
    if (meetingAPI && meetingAPI.getMeetingId()) {
      const result = await meetingAPI.endMeeting();
      console.log('[Meeting] 会议已结束');
      return { success: true, finalSummary: result.finalSummary };
    }
    
    return { success: true };
  } catch (error) {
    console.error('[Meeting] 结束会议失败:', error);
    return { success: false, error: error.message };
  }
});

// IPC: 提交音频片段
ipcMain.handle('meeting-submit-audio', async (event, { audioData, sequence, timestamp }) => {
  try {
    if (!meetingAPI || !meetingAPI.getMeetingId()) {
      throw new Error('会议未创建');
    }
    
    // 将 base64 转换为 Blob（在主进程中需要使用 Buffer）
    const audioBuffer = Buffer.from(audioData, 'base64');
    
    // 这里需要使用 fetch 或 node-fetch 发送请求
    // 暂时返回模拟数据，实际实现需要对接后台
    console.log(`[Meeting] 音频片段 #${sequence} 已提交, 大小: ${audioBuffer.length} bytes`);
    
    // 发送 ASR 结果到所有会议相关窗口
    const asrResult = {
      speaker: '讲话人',
      transcript: `音频片段 #${sequence} 已处理`,
      summary: null
    };
    
    if (spriteWindow) {
      spriteWindow.webContents.send('meeting-asr-result', asrResult);
    }
    if (meetingWindow) {
      meetingWindow.webContents.send('meeting-asr-result', asrResult);
    }
    
    return { success: true };
  } catch (error) {
    console.error('[Meeting] 提交音频失败:', error);
    return { success: false, error: error.message };
  }
});

// ========== 设置窗口 ==========
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  const iconPath = getIconPath('chatecnu.ico');
  
  settingsWindow = new BrowserWindow({
    width: 400,
    height: 480,
    parent: mainWindow,
    modal: false,
    frame: false,
    resizable: false,
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
    tableExport: store.get('tableExport'),
    spriteMode: store.get('spriteMode'),
    minimizeToTray: store.get('minimizeToTray'),
    uatMode: store.get('uatMode'),
    meetingAssistant: store.get('meetingAssistant')
  };
});

// IPC: 保存设置
ipcMain.on('save-settings', (event, settings) => {
  store.set('tableExport', settings.tableExport);
  store.set('spriteMode', settings.spriteMode);
  store.set('minimizeToTray', settings.minimizeToTray);
  store.set('uatMode', settings.uatMode);
  
  // 会议助手必须在 UAT 模式下才能开启
  const meetingEnabled = settings.uatMode && settings.meetingAssistant;
  store.set('meetingAssistant', meetingEnabled);
  settings.meetingAssistant = meetingEnabled;
  
  // 通知主窗口更新设置
  if (mainWindow) {
    mainWindow.webContents.send('settings-changed', settings);
    
    // 如果关闭 UAT 功能，重置激活状态并恢复颜色
    if (!settings.uatMode) {
      store.set('uatActive', false);
      mainWindow.setTitleBarOverlay({
        color: '#1a1a2e',
        symbolColor: '#ffffff',
        height: 40
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
    autoCheckOnStartup(3000); // 延迟 3 秒检查更新
  }
});

  // 当所有窗口关闭时不退出，保持应用在后台运行（通过系统托盘）
  app.on('window-all-closed', () => {
    // 不自动退出，让应用在后台运行以保持会话
    // 用户可以通过托盘菜单的"退出"选项来真正退出应用
  });
}

