const fs = require('fs');
const path = require('path');

// 创建 icons 目录（如果不存在）
const iconsDir = path.join(__dirname, '..', 'resources', 'icons');
if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
}

// 生成简单的 PNG 图标
// 由于在纯 Node.js 中生成 PNG 比较复杂，我们创建一个最小的 PNG 文件
const pngHeader = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
    0x49, 0x48, 0x44, 0x52, // IHDR chunk type
    0x00, 0x00, 0x00, 0x80, // Width: 128 pixels
    0x00, 0x00, 0x00, 0x80, // Height: 128 pixels
    0x08, // Bit depth: 8
    0x06, // Color type: Truecolor with Alpha
    0x00, // Compression method: 0
    0x00, // Filter method: 0
    0x00, // Interlace method: 0
    0x00, 0x00, 0x00, 0x01, // IHDR CRC (placeholder)
    0x00, 0x00, 0x00, 0x00, // IDAT chunk length (placeholder)
    0x49, 0x44, 0x41, 0x54, // IDAT chunk type
    0x00, 0x00, 0x00, 0x00, // IDAT CRC (placeholder)
    0x00, 0x00, 0x00, 0x00  // IEND chunk
]);

// 创建一个简单的蓝色背景图标
const createSimpleIcon = () => {
    const iconPath = path.join(iconsDir, 'icon.png');

    // 写入基本的 PNG 结构
    fs.writeFileSync(iconPath, pngHeader);

    console.log('Created a basic PNG icon at:', iconPath);
    console.log('Note: This is a minimal PNG file. For a better looking icon,');
    console.log('please replace it with a proper 128x128 PNG icon file.');
};

createSimpleIcon();