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
exports.OpenApiTokenUtils = void 0;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
class OpenApiTokenUtils {
    static async getToken(config) {
        const jarPath = path.join(__dirname, '../../resources/aes-crypto-tool/encryption-tool-1.0-SNAPSHOT.jar');
        const args = [
            '-jar',
            jarPath,
            `http://${config.ip}:${config.port}/`,
            config.accountCode,
            config.appId,
            config.appSecret,
            config.publicKey || '',
            'token',
            config.homeVersion == "2105及之后版本" ? "2105after" : "2105before"
        ];
        if (config.userPassword) {
            args.splice(6, 0, config.userPassword);
        }
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)('java', args);
            let output = '';
            let errorOutput = '';
            child.stdout.on('data', (data) => {
                output += data.toString();
            });
            child.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            child.on('close', (code) => {
                if (code === 0) {
                    try {
                        const result = JSON.parse(output);
                        resolve(result);
                    }
                    catch (parseError) {
                        resolve({ output });
                    }
                }
                else {
                    reject(new Error(`JAR工具执行失败: ${errorOutput}`));
                }
            });
        });
    }
}
exports.OpenApiTokenUtils = OpenApiTokenUtils;
//# sourceMappingURL=OpenApiTokenUtils.js.map