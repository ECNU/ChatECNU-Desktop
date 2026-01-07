/**
 * SVG 转多分辨率 ICO
 * 用法: node svg-to-ico.js [input.svg] [output.ico]
 */
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;
const fs = require('fs');
const path = require('path');

const sizes = [16, 24, 32, 48, 64, 96, 128, 256];

async function svgToIco(inputSvg, outputIco) {
  const tempDir = path.join(__dirname, '.temp-icons');
  
  // 创建临时目录
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  const pngFiles = [];

  console.log(`转换 ${inputSvg} -> ${outputIco}`);
  console.log(`分辨率: ${sizes.join(', ')}\n`);

  // SVG 转多个 PNG
  for (const size of sizes) {
    const pngPath = path.join(tempDir, `icon-${size}.png`);
    console.log(`  生成 ${size}x${size} PNG...`);
    
    await sharp(inputSvg)
      .resize(size, size, {
        fit: 'contain',      // 保持宽高比
        background: { r: 0, g: 0, b: 0, alpha: 0 }  // 透明背景填充
      })
      .png()
      .toFile(pngPath);
    
    pngFiles.push(pngPath);
  }

  // PNG 合并为 ICO
  console.log('\n  合并为 ICO...');
  const icoBuffer = await pngToIco(pngFiles);
  fs.writeFileSync(outputIco, icoBuffer);

  // 清理临时文件
  for (const f of pngFiles) {
    fs.unlinkSync(f);
  }
  fs.rmdirSync(tempDir);

  console.log(`\n✓ 完成: ${outputIco}`);
}

// 命令行参数
const inputSvg = process.argv[2] || path.join(__dirname, '../build/chatecnu.svg');
const outputIco = process.argv[3] || path.join(__dirname, '../build/favicon.ico');

svgToIco(inputSvg, outputIco).catch(err => {
  console.error('错误:', err.message);
  process.exit(1);
});

