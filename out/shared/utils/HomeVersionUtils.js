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
exports.HOME_VERSIONS = void 0;
exports.getHomeVersion = getHomeVersion;
exports.findClosestHomeVersion = findClosestHomeVersion;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.HOME_VERSIONS = [
    '1903', '1909', '2005', '2105', '2111',
    '2207', '2305', '2312', '2411', '2505'
];
function getHomeVersion(homePath) {
    try {
        const setupIniPath = path.join(homePath, 'ncscript', 'uapServer', 'setup.ini');
        if (!fs.existsSync(setupIniPath)) {
            return null;
        }
        const content = fs.readFileSync(setupIniPath, 'utf-8');
        const versionMatch = content.match(/^version\s*=\s*(.+)$/m);
        if (!versionMatch) {
            return null;
        }
        const versionLine = versionMatch[1];
        const versionPattern = /R\d+_(\d+)_\d+/;
        const versionParts = versionLine.match(versionPattern);
        if (versionParts && versionParts[1]) {
            const version = versionParts[1];
            return version;
        }
        else {
            return null;
        }
    }
    catch (error) {
        return null;
    }
}
function findClosestHomeVersion(version) {
    if (!version) {
        return null;
    }
    if (exports.HOME_VERSIONS.includes(version)) {
        return version;
    }
    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum)) {
        return null;
    }
    let closestVersion = null;
    let minDifference = Infinity;
    for (const enumVersion of exports.HOME_VERSIONS) {
        const enumVersionNum = parseInt(enumVersion, 10);
        if (isNaN(enumVersionNum)) {
            continue;
        }
        const difference = Math.abs(versionNum - enumVersionNum);
        if (difference < minDifference) {
            minDifference = difference;
            closestVersion = enumVersion;
        }
    }
    return closestVersion;
}
//# sourceMappingURL=HomeVersionUtils.js.map