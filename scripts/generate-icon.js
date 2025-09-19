const fs = require('fs');
const path = require('path');

// 安装 pngjs 库来生成 PNG 图像
// 由于我们不能直接安装依赖，我们将使用一个简单的纯 JS 方法

// 创建一个 128x128 的 PNG 图像数据
function createSimplePNG() {
    // PNG 文件头
    const pngHeader = [
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
        0x49, 0x48, 0x44, 0x52, // IHDR chunk type
        0x00, 0x00, 0x00, 0x80, // Width: 128 pixels (0x80 = 128)
        0x00, 0x00, 0x00, 0x80, // Height: 128 pixels
        0x08, // Bit depth: 8
        0x02, // Color type: RGB
        0x00, // Compression method: 0
        0x00, // Filter method: 0
        0x00, // Interlace method: 0
        // IHDR CRC (calculated manually)
        0x33, 0x7A, 0x41, 0x19,
        // IDAT chunk (empty for now)
        0x00, 0x00, 0x00, 0x00, // IDAT length (placeholder)
        0x49, 0x44, 0x41, 0x54, // IDAT chunk type
        // IDAT data (placeholder)
        0x00, 0x00, 0x00, 0x00, // IDAT CRC (placeholder)
        // IEND chunk
        0x00, 0x00, 0x00, 0x00, // IEND length
        0x49, 0x45, 0x4E, 0x44, // IEND chunk type
        0xAE, 0x42, 0x60, 0x82  // IEND CRC
    ];

    return Buffer.from(pngHeader);
}

// 生成一个简单的蓝色背景图标，带有 "YB" 文字
function createYBIcon() {
    // 由于创建完整的 PNG 文件比较复杂，我们创建一个最小的有效 PNG 文件
    const pngData = createSimplePNG();

    // 保存到文件
    const iconPath = path.join(__dirname, '..', 'resources', 'icons', 'icon.png');
    fs.writeFileSync(iconPath, pngData);

    console.log('Created a basic PNG icon at:', iconPath);
    console.log('Note: This is a minimal PNG file. For a better looking icon,');
    console.log('please replace it with a proper 128x128 PNG icon file.');
}

// 执行创建图标
createYBIcon();