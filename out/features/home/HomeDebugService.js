"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeDebugService = void 0;
const vscode = __importStar(require("vscode"));
class HomeDebugService {
    homeService;
    configService;
    constructor(context, configService, homeService) {
        this.configService = configService;
        this.homeService = homeService;
    }
    async debugHomeService(selectedPath) {
        try {
            const isRunning = await this.isHomeServiceRunning();
            if (isRunning) {
                await this.restartHomeService(selectedPath);
            }
            else {
                await this.startHomeService(selectedPath);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`调试启动HOME服务失败: ${error.message}`);
        }
    }
    async isHomeServiceRunning() {
        const status = this.homeService.getStatus();
        return status === 'running' || status === 'starting';
    }
    async restartHomeService(selectedPath) {
        await this.homeService.stopHomeService();
        await this.waitForServiceStop(5000);
        await this.startHomeService(selectedPath);
    }
    async waitForServiceStop(timeout) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const checkInterval = setInterval(() => {
                const status = this.homeService.getStatus();
                if (status === 'stopped' || Date.now() - startTime > timeout) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 500);
        });
    }
    async startHomeService(selectedPath) {
        await this.homeService.startHomeService(selectedPath);
    }
    getHomeService() {
        return this.homeService;
    }
}
exports.HomeDebugService = HomeDebugService;
//# sourceMappingURL=HomeDebugService.js.map