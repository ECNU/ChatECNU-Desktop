/**
 * OSS 配置（共享配置，避免重复）
 * 优先从环境变量读取，否则使用默认值
 */

// 在 Node.js 环境中加载 .env（Electron 主进程或脚本）
if (typeof require !== 'undefined') {
  try {
    require('dotenv').config();
  } catch (e) {
    // dotenv 不存在时忽略（可能在生产环境）
  }
}

const OSS_CONFIG = {
  region: process.env.OSS_REGION || 'oss-cn-shanghai',
  endpoint: process.env.OSS_ENDPOINT || 'oss-cn-shanghai.aliyuncs.com',
  bucket: process.env.OSS_BUCKET || 'ecnunic-data-public',
  prefix: process.env.OSS_PREFIX || 'chatecnu-desktop/releases/'
};

// 构建完整的更新服务器 URL
const UPDATE_SERVER_URL = process.env.UPDATE_SERVER_URL || 
  `https://${OSS_CONFIG.bucket}.${OSS_CONFIG.endpoint}/${OSS_CONFIG.prefix}`;

module.exports = {
  OSS_CONFIG,
  UPDATE_SERVER_URL
};
