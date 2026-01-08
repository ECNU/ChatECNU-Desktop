/**
 * 打包后处理：将安装程序压缩为 zip
 * 用法: node post-build.js [win|mac]
 */
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const DIST_DIR = path.join(__dirname, 'dist');
const platform = process.argv[2] || 'win';

// 读取 package.json 获取版本
const pkg = require('./package.json');
const version = pkg.version;
const productName = pkg.build?.productName || pkg.name;

// 根据平台定义文件匹配规则
const PLATFORM_CONFIG = {
  win: {
    pattern: (f) => f.endsWith('.exe') && f.includes(version),
    suffix: '-win',
    latestYml: 'latest.yml'
  },
  mac: {
    pattern: (f) => f.endsWith('.dmg') && f.includes(version),
    suffix: '-mac',
    latestYml: 'latest-mac.yml'
  }
};

// 压缩单个文件到 zip
function zipFile(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', resolve);
    archive.on('error', reject);
    
    archive.pipe(output);
    archive.file(srcPath, { name: path.basename(srcPath) });
    archive.finalize();
  });
}

async function main() {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    console.error(`错误: 不支持的平台 "${platform}"，支持: win, mac`);
    process.exit(1);
  }

  const files = fs.readdirSync(DIST_DIR);
  const installerFiles = files.filter(config.pattern);

  if (installerFiles.length === 0) {
    console.error(`错误: 未找到版本 ${version} 的 ${platform} 安装程序`);
    process.exit(1);
  }

  console.log(`平台: ${platform}`);
  console.log(`找到安装程序: ${installerFiles.join(', ')}\n`);

  // 压缩每个安装程序
  for (const installerFile of installerFiles) {
    let arch = '';
    if (installerFile.includes('arm64')) arch = '-arm64';
    else if (installerFile.includes('x64')) arch = '-x64';

    const zipName = `${productName}-${version}${config.suffix}${arch}.zip`;
    const installerPath = path.join(DIST_DIR, installerFile);
    const zipPath = path.join(DIST_DIR, zipName);

    console.log(`压缩: ${installerFile} -> ${zipName}`);
    await zipFile(installerPath, zipPath);
    console.log('✓ 压缩完成');
  }

  // 更新 latest.yml
  const latestPath = path.join(DIST_DIR, config.latestYml);
  if (fs.existsSync(latestPath)) {
    let content = fs.readFileSync(latestPath, 'utf-8');

    for (const installerFile of installerFiles) {
      let arch = '';
      if (installerFile.includes('arm64')) arch = '-arm64';
      else if (installerFile.includes('x64')) arch = '-x64';

      const zipName = `${productName}-${version}${config.suffix}${arch}.zip`;
      const zipPath = path.join(DIST_DIR, zipName);

      if (!content.includes(zipName) && fs.existsSync(zipPath)) {
        const zipStats = fs.statSync(zipPath);
        const key = arch ? `zip${arch.replace('-', '_')}` : 'zip';
        content += `\n${key}: ${zipName}\n${key}Size: ${zipStats.size}\n`;
      }
    }

    fs.writeFileSync(latestPath, content);
    console.log(`✓ 更新 ${config.latestYml}`);
  }

  console.log('\n后处理完成!');
}

main().catch(err => {
  console.error('错误:', err.message);
  process.exit(1);
});
