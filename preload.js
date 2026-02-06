// preload.js - JSBridge 实现
const { contextBridge, ipcRenderer } = require('electron');

// 事件监听器存储
const listeners = new Map();

// 接收主进程发来的事件，触发对应回调
ipcRenderer.on('tx:event', (_, eventName, data) => {
  const callbacks = listeners.get(eventName);
  if (callbacks) {
    callbacks.forEach(cb => cb(data));
  }
});

// 暴露 _tx 对象给网页
contextBridge.exposeInMainWorld('_tx', {
  // 网页 → 客户端：告知客户端某个 key 的当前值
  status: (key, value) => {
    ipcRenderer.send('tx:status', key, value);
  },

  // 客户端 → 网页：注册事件监听
  on: (event, callback) => {
    if (!listeners.has(event)) {
      listeners.set(event, []);
    }
    listeners.get(event).push(callback);
  },

  // 移除事件监听（防止内存泄漏）
  off: (event, callback) => {
    const callbacks = listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }
});
