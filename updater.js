const { autoUpdater } = require('electron-updater');
const { UPDATE_SERVER_URL } = require('./oss-config');

let mainWindow = null;
let isDownloading = false;

// ========== 更新检查时间常量 ==========
const UPDATE_CHECK_TIMEOUT = 15000; // 检查更新超时时间（毫秒）
const UPDATE_CHECK_DEFAULT_DELAY = 3000; // 启动时检查更新的默认延迟（毫秒）

/**
 * 初始化更新器
 * @param {BrowserWindow} win - 主窗口实例
 */
function initUpdater(win) {
  mainWindow = win;

  // 设置更新服务器地址（阿里云 OSS）
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: UPDATE_SERVER_URL
  });

  // 禁用自动下载，手动控制
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = true;

  // 检查更新时
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] 正在检查更新...');
    if (mainWindow) {
      mainWindow.webContents.send('checking-for-update');
    }
  });

  // 发现新版本
  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] 发现新版本:', info.version);
    if (mainWindow) {
      // 通知前端发现新版本，由前端控制按钮显示为"立即下载"
      mainWindow.webContents.send('update-available', info);
    }
  });

  // 没有新版本
  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] 当前已是最新版本');
    if (mainWindow) {
      // 通知前端无更新，loading ring 结束
      mainWindow.webContents.send('update-not-available');
    }
  });

  // 下载进度
  autoUpdater.on('download-progress', (progress) => {
    // 通知前端下载进度
    if (mainWindow) {
      mainWindow.webContents.send('update-download-progress', progress.percent);
    }
  });

  // 下载完成
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] 更新下载完成');
    isDownloading = false;
    if (mainWindow) {
      // 通知前端下载完成，按钮变为"立即安装"
      mainWindow.webContents.send('update-downloaded', info);
    }
  });

  // 更新错误
  autoUpdater.on('error', (err) => {
    console.error('[Updater] 更新错误:', err);
    isDownloading = false;
    if (mainWindow) {
      // 出错时也通知前端停止 loading
      mainWindow.webContents.send('update-error', err.message);
    }
  });
}

/**
 * 检查更新
 */
function checkForUpdates() {
  if (isDownloading) return;
  console.log('[Updater] 触发检查更新');

  // 手动通知前端进入检查状态，确保 UI 立即响应
  if (mainWindow) {
    mainWindow.webContents.send('checking-for-update');
  }

  // 设置超时
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('检查更新超时，请稍后重试'));
    }, UPDATE_CHECK_TIMEOUT);
  });

  Promise.race([
    autoUpdater.checkForUpdates(),
    timeoutPromise
  ]).catch(err => {
    console.error('[Updater] 检查更新失败:', err);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', err.message);
    }
  });
}

/**
 * 开始下载更新
 */
function downloadUpdate() {
  if (isDownloading) return;
  isDownloading = true;
  console.log('[Updater] 开始下载更新');
  autoUpdater.downloadUpdate().catch(err => {
     isDownloading = false;
     console.error('[Updater] 下载失败:', err);
     if (mainWindow) mainWindow.webContents.send('update-error', err.message);
  });
}

/**
 * 退出并安装
 */
function quitAndInstall() {
  console.log('[Updater] 退出并安装');
  autoUpdater.quitAndInstall();
}

/**
 * 启动时自动检查更新（延迟执行）
 * @param {number} delay - 延迟时间（毫秒），默认 UPDATE_CHECK_DEFAULT_DELAY
 */
function autoCheckOnStartup(delay = UPDATE_CHECK_DEFAULT_DELAY) {
  setTimeout(() => {
    checkForUpdates();
  }, delay);
}

module.exports = {
  initUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  autoCheckOnStartup
};

