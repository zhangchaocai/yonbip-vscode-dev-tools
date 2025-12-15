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
exports.ToolbarIconService = void 0;
const vscode = __importStar(require("vscode"));
const homeStatus_1 = require("./homeStatus");
class ToolbarIconService {
    static instance;
    context;
    constructor(context) {
        this.context = context;
    }
    static getInstance(context) {
        if (!ToolbarIconService.instance && context) {
            ToolbarIconService.instance = new ToolbarIconService(context);
        }
        return ToolbarIconService.instance;
    }
    updateToolbarIconVisual(status) {
        vscode.commands.executeCommand('setContext', 'yonbip.home.status', status);
        switch (status) {
            case homeStatus_1.HomeStatus.STOPPED:
            case homeStatus_1.HomeStatus.ERROR:
                vscode.commands.executeCommand('setContext', 'yonbip.home.stop.visible', false);
                break;
            case homeStatus_1.HomeStatus.RUNNING:
            case homeStatus_1.HomeStatus.STARTING:
            case homeStatus_1.HomeStatus.STOPPING:
                vscode.commands.executeCommand('setContext', 'yonbip.home.stop.visible', true);
                break;
        }
    }
}
exports.ToolbarIconService = ToolbarIconService;
//# sourceMappingURL=ToolbarIconService.js.map