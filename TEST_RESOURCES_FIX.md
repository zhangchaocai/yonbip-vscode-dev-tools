# 测试 Resources/Conf 目录加载修复 (保守版)

## 问题描述
用友高级版项目启动时，页面登录报错，原因是无法加载到 `${homePath}/resources/conf` 下的配置文件，特别是 `login.properties` 等文件。

## 修复策略 v2 (保守版)
为了避免类加载冲突，采用了更保守的修复策略：

1. **分离添加时机**: 在所有jar包添加完成后，才添加resources目录
2. **精确目录添加**: 只添加 `resources` 主目录和 `resources/conf` 子目录
3. **避免递归扫描**: 不再递归添加resources下的所有子目录，减少类加载冲突风险
4. **移除重复条目**: 从libDirs数组中移除重复的resources条目

## 技术细节
```typescript
// 在所有jar包添加完成后，保守地添加resources目录（避免类加载冲突）
const resourcesDir = path.join(config.homePath, 'resources');
if (fs.existsSync(resourcesDir)) {
    // 只添加resources主目录和conf子目录，不递归添加所有子目录
    classpathEntries.push(resourcesDir);
    
    // 特别添加conf目录，确保配置文件能被加载
    const confDir = path.join(resourcesDir, 'conf');
    if (fs.existsSync(confDir)) {
        classpathEntries.push(confDir);
    }
}
```

## 测试步骤

### 1. 检查修复是否生效
重新启动HOME服务，在输出日志中确认看到：
```
📁 添加resources目录: ${homePath}/resources
📁 特别添加resources/conf目录: ${homePath}/resources/conf
✅ 类路径中包含resources相关目录 2 个:
   - ${homePath}/resources
   - ${homePath}/resources/conf
```

### 2. 验证端口占用
确保没有其他进程占用8077和8080端口：
```bash
lsof -i :8077 -i :8080
```

### 3. 检查启动日志
如果仍有问题，查看以下日志文件：
- 主要错误: `/Users/zhangchaocai/Documents/home/20230824/nclogs/server/serverstart-log.log`
- 详细日志: `/Users/zhangchaocai/Documents/home/20230824/nclogs/server/nc-log.log`

### 4. 验证登录功能
1. 等待服务启动完成
2. 访问登录页面
3. 尝试登录，确认不再出现配置文件加载错误

## 预期改进
相比之前的版本，这个保守修复：
- ✅ 减少了类加载冲突的可能性
- ✅ 保持了与IDEA插件的兼容性
- ✅ 确保配置文件能正确加载
- ✅ 降低了启动失败的风险

## 排查问题
如果仍然有问题：

1. **检查端口冲突**: 确保8077和8080端口未被占用
2. **检查类路径**: 确认日志中显示resources目录已添加
3. **检查文件权限**: 确保Java进程有权限读取resources目录
4. **对比IDEA插件**: 可以同时启动IDEA插件版本进行对比测试

## 技术说明
这个保守策略参考了IDEA插件的 `RESOURCES_LIBRARY` 实现，但采用了更安全的加载时机和范围，确保既能解决配置文件加载问题，又不会引入新的类加载冲突。