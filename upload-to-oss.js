/**
 * 上传构建产物到阿里云 OSS
 * 用法: node upload-to-oss.js [--force]
 */
const OSS = require('ali-oss');
const forceUpload = process.argv.includes('--force') || process.argv.includes('-f');
const path = require('path');
const fs = require('fs');
const { OSS_CONFIG } = require('./oss-config');

// 需要设置环境变量: OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET
if (!process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_ACCESS_KEY_SECRET) {
  console.error('错误: 请设置环境变量 OSS_ACCESS_KEY_ID 和 OSS_ACCESS_KEY_SECRET');
  process.exit(1);
}

const client = new OSS({
  region: OSS_CONFIG.region,
  endpoint: OSS_CONFIG.endpoint,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: OSS_CONFIG.bucket
});

const OSS_PREFIX = OSS_CONFIG.prefix;
const DIST_DIR = path.join(__dirname, 'dist');

// 解析 latest.yml 获取版本号
function parseVersion(content) {
  const match = content.match(/^version:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

// 比较版本号 (返回 1: a>b, -1: a<b, 0: a=b)
function compareVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

async function upload() {
  // 检查是否有任意 latest*.yml 文件
  const distFiles = fs.readdirSync(DIST_DIR);
  const latestYmlFiles = distFiles.filter(f => f.match(/^latest.*\.yml$/));
  
  if (latestYmlFiles.length === 0) {
    console.log('错误: 未找到 dist/latest*.yml');
    return;
  }

  // 使用 latest.yml 或 latest-mac.yml 获取版本
  const primaryYml = latestYmlFiles.includes('latest.yml') ? 'latest.yml' : latestYmlFiles[0];
  const latestYmlPath = path.join(DIST_DIR, primaryYml);
  
  // 读取本地版本
  const localContent = fs.readFileSync(latestYmlPath, 'utf-8');
  const localVersion = parseVersion(localContent);
  console.log(`本地版本: ${localVersion}`);

  // 获取 OSS 版本
  let ossVersion = null;
  try {
    const result = await client.get(OSS_PREFIX + primaryYml);
    ossVersion = parseVersion(result.content.toString());
    console.log(`OSS 版本: ${ossVersion}`);
  } catch (e) {
    console.log('OSS 版本: 无');
    // 只对非404错误打印警告（404表示文件不存在，是正常情况）
    if (e.status !== 404) {
      console.warn('获取 OSS 版本失败:', e.message || e);
    }
  }

  // 比较版本
  if (!forceUpload && ossVersion && compareVersion(localVersion, ossVersion) <= 0) {
    console.log(`\n本地版本 ${localVersion} 不比 OSS 版本 ${ossVersion} 新，跳过上传`);
    console.log('提示: 使用 --force 参数强制上传');
    return;
  }

  console.log(`\n需要上传新版本 ${localVersion}\n`);

  // 上传文件列表：
  // - latest*.yml (自动更新元数据)
  // - .exe/.dmg/.blockmap (自动更新用)
  // - .zip (手动下载用)
  const files = distFiles.filter(f => 
    f.match(/^latest.*\.yml$/) ||
    (f.includes(localVersion) && (
      f.endsWith('.exe') || 
      f.endsWith('.dmg') || 
      f.endsWith('.blockmap') || 
      f.endsWith('.zip')
    ))
  );

  for (const file of files) {
    const localPath = path.join(DIST_DIR, file);
    const ossPath = OSS_PREFIX + file;
    const sizeMB = (fs.statSync(localPath).size / 1024 / 1024).toFixed(2);
    
    try {
      console.log(`上传: ${file} (${sizeMB} MB)`);
      await client.put(ossPath, localPath);
      console.log(`  ✓ 完成`);
    } catch (err) {
      console.error(`  ✗ 失败: ${err.message}`);
    }
  }

  console.log('\n上传完成!');
}

upload().catch(console.error);

