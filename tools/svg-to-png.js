/**
 * SVG 转 PNG (用于 Mac/Linux 图标)
 * 用法: node svg-to-png.js [input.svg] [output.png] [size]
 */
const sharp = require('sharp');
const path = require('path');

async function svgToPng(inputSvg, outputPng, size = 512) {
    console.log(`转换 ${inputSvg} -> ${outputPng} (${size}x${size})`);

    await sharp(inputSvg)
        .resize(size, size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(outputPng);

    console.log(`✓ 完成: ${outputPng}`);
}

const inputSvg = process.argv[2] || path.join(__dirname, '../build/chatecnu.svg');
const outputPng = process.argv[3] || path.join(__dirname, '../build/icon.png');
const size = parseInt(process.argv[4]) || 512;

svgToPng(inputSvg, outputPng, size).catch(err => {
    console.error('错误:', err.message);
    process.exit(1);
});
