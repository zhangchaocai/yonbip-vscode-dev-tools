/**
 * 性能分析脚本
 * 用于监控插件启动时间和关键性能指标
 */
const fs = require('fs');
const path = require('path');

// 记录启动时间
const startupTime = Date.now();

// 写入性能日志
function writePerformanceLog() {
    const performanceData = {
        startupTime: new Date().toISOString(),
        extensionLoadTime: Date.now() - startupTime,
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsage: process.memoryUsage()
    };

    const logDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, 'performance.log');
    const logEntry = `[${performanceData.startupTime}] Startup Time: ${performanceData.extensionLoadTime}ms\n`;

    fs.appendFileSync(logFile, logEntry);
}

// 导出性能监控模块
module.exports = {
    writePerformanceLog,
    startupTime
};

// 在进程退出时写入日志
process.on('exit', writePerformanceLog);
process.on('uncaughtException', writePerformanceLog);
process.on('unhandledRejection', writePerformanceLog);