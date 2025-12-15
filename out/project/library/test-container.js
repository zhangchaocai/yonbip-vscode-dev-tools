#!/usr/bin/env node
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
const fs = __importStar(require("fs"));
const ClasspathContainerResolver_1 = require("./ClasspathContainerResolver");
if (process.argv.length < 3) {
    console.error('用法: node test-container.js <homePath>');
    process.exit(1);
}
const homePath = process.argv[2];
if (!fs.existsSync(homePath)) {
    console.error(`错误: HOME路径不存在: ${homePath}`);
    process.exit(1);
}
console.log(`测试类路径容器功能，HOME路径: ${homePath}`);
const resolver = new ClasspathContainerResolver_1.ClasspathContainerResolver(homePath);
const containerPaths = [
    "com.yonyou.studio.udt.core.container/Ant_Library",
    "com.yonyou.studio.udt.core.container/Product_Common_Library",
    "com.yonyou.studio.udt.core.container/Middleware_Library",
    "com.yonyou.studio.udt.core.container/Framework_Library",
    "com.yonyou.studio.udt.core.container/Module_Public_Library",
    "com.yonyou.studio.udt.core.container/Module_Client_Library",
    "com.yonyou.studio.udt.core.container/Module_Private_Library",
    "com.yonyou.studio.udt.core.container/Module_Lang_Library",
    "com.yonyou.studio.udt.core.container/Generated_EJB",
    "com.yonyou.studio.udt.core.container/NCCloud_Library"
];
containerPaths.forEach(containerPath => {
    console.log(`\n解析容器路径: ${containerPath}`);
    const paths = resolver.resolveContainerPath(containerPath);
    console.log(`找到 ${paths.length} 个条目:`);
    paths.slice(0, 5).forEach(p => console.log(`  ${p}`));
    if (paths.length > 5) {
        console.log(`  ... 还有 ${paths.length - 5} 个条目`);
    }
});
resolver.dispose();
console.log('\n测试完成');
//# sourceMappingURL=test-container.js.map