/**
 * dmdb 内部的 iconv-lite 依赖缺失 safer-buffer（Node.js 模块解析不会向上穿透
 * dmdb/node_modules/ 去顶层查找），因此需要把 safer-buffer 复制进 dmdb/node_modules/。
 * 在 `npm install` 和 `vsce package` 前会自动执行本脚本。
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const dmdbNodeModules = path.join(projectRoot, 'node_modules', 'dmdb', 'node_modules');
const saferBufferSrc = path.join(projectRoot, 'node_modules', 'safer-buffer');
const saferBufferDest = path.join(dmdbNodeModules, 'safer-buffer');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (fs.existsSync(saferBufferSrc) && !fs.existsSync(saferBufferDest)) {
  console.log('[copy-dmdb-deps] copying safer-buffer into dmdb/node_modules/');
  copyDir(saferBufferSrc, saferBufferDest);
  console.log('[copy-dmdb-deps] done.');
} else if (fs.existsSync(saferBufferDest)) {
  console.log('[copy-dmdb-deps] safer-buffer already present in dmdb/node_modules/, skipping.');
}
