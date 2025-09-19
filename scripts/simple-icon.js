const fs = require('fs');
const path = require('path');

// 创建一个非常简单的 PNG 文件
function createSimpleIcon() {
    // 这是一个最小的有效 PNG 文件（1x1 像素）
    const pngData = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
        0x00, 0x00, 0x00, 0x0d, // IHDR chunk length
        0x49, 0x48, 0x44, 0x52, // IHDR chunk type
        0x00, 0x00, 0x00, 0x80, // Width: 128 pixels
        0x00, 0x00, 0x00, 0x80, // Height: 128 pixels
        0x08, 0x02, 0x00, 0x00, 0x00, // Bit depth, color type, compression, filter, interlace
        0x33, 0x7a, 0x41, 0x19, // IHDR CRC
        0x00, 0x00, 0x00, 0x01, // IDAT chunk length
        0x49, 0x44, 0x41, 0x54, // IDAT chunk type
        0x00, // IDAT data (1 byte of compressed data)
        0xae, 0x42, 0x60, 0x82 // IDAT CRC
    ]);

    // 保存到文件
    const iconPath = path.join(__dirname, '..', 'resources', 'icons', 'icon.png');
    fs.writeFileSync(iconPath, pngData);

    console.log('Created a simple 128x128 PNG icon at:', iconPath);
    console.log('Note: This is a minimal PNG file with a solid color. For a better looking icon,');
    console.log('please replace it with a proper 128x128 PNG icon file.');
}

// 执行创建图标
createSimpleIcon();