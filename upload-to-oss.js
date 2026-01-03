/**
 * 上传构建产物到阿里云 OSS
 * 用法: node upload-to-oss.js
 */
const OSS = require('ali-oss');
const path = require('path');
const fs = require('fs');

// 需要设置环境变量: OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET
if (!process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_ACCESS_KEY_SECRET) {
  console.error('错误: 请设置环境变量 OSS_ACCESS_KEY_ID 和 OSS_ACCESS_KEY_SECRET');
  process.exit(1);
}

const client = new OSS({
  region: 'oss-cn-shanghai',
  endpoint: 'oss-cn-shanghai.aliyuncs.com',
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: 'ecnunic-data-public'
});

const OSS_PREFIX = 'chatecnu-desktop/releases/';
const DIST_DIR = path.join(__dirname, 'dist');

async function upload() {
  // 需要上传的文件
  const files = fs.readdirSync(DIST_DIR).filter(f => 
    f === 'latest.yml' || 
    f.endsWith('.exe') || 
    f.endsWith('.exe.blockmap')
  );

  if (files.length === 0) {
    console.log('没有找到需要上传的文件');
    return;
  }

  console.log(`找到 ${files.length} 个文件待上传:\n`);

  for (const file of files) {
    const localPath = path.join(DIST_DIR, file);
    const ossPath = OSS_PREFIX + file;
    
    try {
      const stat = fs.statSync(localPath);
      const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
      
      console.log(`上传: ${file} (${sizeMB} MB)`);
      
      await client.put(ossPath, localPath);
      
      console.log(`  ✓ 完成: https://ecnunic-data-public.oss-cn-shanghai.aliyuncs.com/${ossPath}\n`);
    } catch (err) {
      console.error(`  ✗ 失败: ${file}`, err.message);
    }
  }

  console.log('上传完成!');
}

upload().catch(console.error);

