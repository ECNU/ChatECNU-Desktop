const { contextBridge, ipcRenderer } = require('electron');
const XLSX = require('xlsx');

// 获取设置
let tableExportEnabled = true;
ipcRenderer.invoke('get-settings').then(settings => {
  tableExportEnabled = settings.tableExport !== false;
});

// 监听设置变化
ipcRenderer.on('settings-changed', (event, settings) => {
  tableExportEnabled = settings.tableExport !== false;
  // 通知页面更新
  window.postMessage({ type: 'table-export-setting', enabled: tableExportEnabled }, '*');
});

// 通过 contextBridge 暴露安全的 API
contextBridge.exposeInMainWorld('tableExporter', {
  isEnabled: () => tableExportEnabled,
  exportToExcel: async (tableHtml) => {
    try {
      const container = document.createElement('div');
      container.innerHTML = tableHtml;
      const table = container.querySelector('table');
      if (!table) return { success: false, message: '未找到表格' };
      
      // 弹出保存对话框
      const defaultName = `表格导出_${new Date().toISOString().slice(0,10)}.xlsx`;
      const filePath = await ipcRenderer.invoke('show-save-dialog', defaultName);
      
      if (!filePath) {
        return { success: false, message: '已取消' };
      }
      
      const wb = XLSX.utils.table_to_book(table);
      XLSX.writeFile(wb, filePath);
      return { success: true, message: '导出成功' };
    } catch (e) {
      console.error('导出失败:', e);
      return { success: false, message: e.message };
    }
  }
});

// 注入 UI 脚本（表格导出按钮）
window.addEventListener('DOMContentLoaded', () => {
  // 根据设置决定是否注入
  if (!tableExportEnabled) {
    console.log('[TableExporter] 表格导出功能已禁用');
    return;
  }

  const script = document.createElement('script');
  script.textContent = `
    (function() {
      let featureEnabled = true;

      // 监听设置变化
      window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'table-export-setting') {
          featureEnabled = e.data.enabled;
          const btn = document.getElementById('__table_export_btn__');
          if (btn) {
            btn.style.display = featureEnabled ? 'none' : 'none'; // 隐藏按钮
            if (!featureEnabled) btn.remove();
          }
        }
      });

      function init() {
        if (!document.body) {
          setTimeout(init, 100);
          return;
        }

        // 创建导出按钮
        const exportBtn = document.createElement('button');
        exportBtn.id = '__table_export_btn__';
        exportBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>导出';
        exportBtn.style.cssText = 'position:fixed;z-index:2147483647;padding:6px 12px;background:linear-gradient(135deg,#1a73e8,#1557b0);color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;display:none;box-shadow:0 2px 8px rgba(0,0,0,0.25);font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;transition:all 0.15s ease;line-height:1;';
        document.body.appendChild(exportBtn);

        // Hover 效果
        exportBtn.onmouseenter = () => { exportBtn.style.background = 'linear-gradient(135deg,#1557b0,#0d47a1)'; };
        exportBtn.onmouseleave = () => { exportBtn.style.background = 'linear-gradient(135deg,#1a73e8,#1557b0)'; };

        let currentTable = null;
        let hideTimeout = null;
        let isExporting = false;

        function updateBtnPosition(table) {
          const rect = table.getBoundingClientRect();
          let top = rect.top - 32;
          let left = rect.right - 70;
          if (top < 5) top = rect.top + 5;
          if (left < 5) left = 5;
          if (left + 70 > window.innerWidth) left = window.innerWidth - 75;
          exportBtn.style.top = top + 'px';
          exportBtn.style.left = left + 'px';
        }

        document.addEventListener('mouseover', (e) => {
          if (isExporting) return;
          const table = e.target.closest('table');
          if (table) {
            if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
            if (table !== currentTable) {
              currentTable = table;
              updateBtnPosition(table);
            }
            exportBtn.style.display = 'block';
          }
        }, true);

        document.addEventListener('mouseout', (e) => {
          const fromTable = e.target.closest('table');
          const toTable = e.relatedTarget?.closest?.('table');
          const toBtn = e.relatedTarget === exportBtn || exportBtn.contains(e.relatedTarget);
          if ((fromTable === currentTable || e.target === exportBtn) && !toTable && !toBtn) {
            hideTimeout = setTimeout(() => {
              if (!isExporting) { exportBtn.style.display = 'none'; currentTable = null; }
            }, 300);
          }
        }, true);

        exportBtn.addEventListener('mouseenter', () => {
          if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
        });

        exportBtn.addEventListener('mouseleave', (e) => {
          const toTable = e.relatedTarget?.closest?.('table');
          if (!toTable && !isExporting) {
            hideTimeout = setTimeout(() => {
              exportBtn.style.display = 'none';
              currentTable = null;
            }, 300);
          }
        });

        // 导出功能
        exportBtn.addEventListener('click', async () => {
          if (!currentTable || !window.tableExporter || isExporting) return;
          
          isExporting = true;
          const originalHtml = exportBtn.innerHTML;
          exportBtn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;vertical-align:middle;margin-right:4px;"></span>导出中...';
          
          // 添加旋转动画
          if (!document.getElementById('__export_spin_style__')) {
            const style = document.createElement('style');
            style.id = '__export_spin_style__';
            style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
            document.head.appendChild(style);
          }
          
          const result = await window.tableExporter.exportToExcel(currentTable.outerHTML);
          
          if (result.success) {
            exportBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><polyline points="20 6 9 17 4 12"/></svg>已导出';
            exportBtn.style.background = 'linear-gradient(135deg,#34a853,#1e8e3e)';
          } else if (result.message !== '已取消') {
            exportBtn.innerHTML = '导出失败';
            exportBtn.style.background = '#d93025';
          }
          
          setTimeout(() => {
            exportBtn.innerHTML = originalHtml;
            exportBtn.style.background = 'linear-gradient(135deg,#1a73e8,#1557b0)';
            isExporting = false;
          }, 1500);
        });

        console.log('[TableExporter] 表格导出功能已加载');
      }

      init();
    })();
  `;
  document.head.appendChild(script);
});