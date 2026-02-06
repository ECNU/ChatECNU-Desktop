const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const sizes = [16, 32, 48, 64, 128, 256, 512];
const sourceIcon = path.join(__dirname, '../build/icon.png');
const outputDir = path.join(__dirname, '../build/icons');

async function generateIcons() {
    // 创建输出目录
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    for (const size of sizes) {
        const outputPath = path.join(outputDir, `${size}x${size}.png`);
        await sharp(sourceIcon)
            .resize(size, size)
            .png()
            .toFile(outputPath);
        console.log(`Generated: ${size}x${size}.png`);
    }

    console.log('All Linux icons generated successfully!');
}

generateIcons().catch(console.error);
