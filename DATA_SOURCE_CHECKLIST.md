# VSCode插件数据源配置检查清单

## 问题分析
VSCode插件启动项目时无法连接数据源，而IDEA插件启动正常。经过详细分析，发现主要差异在于JVM参数、环境变量和系统属性的配置方式。

## 已完成的修复

### 1. JVM参数同步
✅ **已更新为与IDEA插件完全一致：**
- `-Dnc.exclude.modules=$IDEA_FIELD_EX_MODULES$`
- `-Dnc.runMode=develop`
- `-Dnc.server.location=$IDEA_FIELD_NC_HOME$`
- `-DEJBConfigDir=$IDEA_FIELD_NC_HOME$/ejbXMLs`
- `-Dorg.owasp.esapi.resources=$IDEA_FIELD_NC_HOME$/ierp/bin/esapi`
- `-DExtServiceConfigDir=$IDEA_FIELD_NC_HOME$/ejbXMLs`
- `-Duap.hotwebs=$IDEA_FIELD_HOTWEBS$`
- `-Dfile.encoding=UTF-8`
- `-Duser.timezone=GMT+8`

### 2. 环境变量同步
✅ **已更新为与IDEA插件完全一致：**
- `FIELD_NC_HOME`: 指向NC_HOME路径
- `FIELD_HOTWEBS`: "nccloud,fs,yonbip"
- `FIELD_EX_MODULES`: ""
- `IDEA_FIELD_NC_HOME`: 指向NC_HOME路径（兼容IDEA变量）
- `IDEA_FIELD_HOTWEBS`: "nccloud,fs,yonbip"（兼容IDEA变量）
- `IDEA_FIELD_EX_MODULES`: ""（兼容IDEA变量）

### 3. 数据源配置文件路径
✅ **已添加：**
- `-Dnc.prop.dir=[HOME_PATH]/ierp/bin`
- `-Dprop.dir=[HOME_PATH]/ierp/bin`

## 验证步骤

### 步骤1：验证配置文件存在
```bash
# 检查prop.xml文件是否存在
ls -la [你的NC_HOME路径]/ierp/bin/prop.xml

# 检查数据源配置文件
ls -la [你的NC_HOME路径]/ierp/bin/datasource*
```

### 步骤2：验证环境变量
启动VSCode插件后，在输出面板中检查以下信息：
- ✅ 所有JVM参数已正确设置
- ✅ 所有环境变量已正确传递
- ✅ 数据源配置文件路径已识别

### 步骤3：验证启动日志
检查启动日志中是否包含：
- ✅ `找到core.jar` 信息
- ✅ `主类: ufmiddle.start.tomcat.StartDirectServer` 或 `ufmiddle.start.wj.StartDirectServer`
- ✅ 数据源配置加载成功

### 步骤4：手动测试连接
如果仍然无法连接，可以尝试：

1. **手动验证prop.xml内容：**
```bash
# 查看prop.xml中的数据源配置
cat [你的NC_HOME路径]/ierp/bin/prop.xml | grep -A 10 -B 5 "datasource"
```

2. **检查数据库连接：**
```bash
# 使用prop.xml中的配置手动测试数据库连接
# 根据数据库类型使用相应命令
```

3. **检查端口监听：**
```bash
# 检查服务是否启动成功
netstat -an | grep 9999
```

## 常见问题排查

### 问题1：数据源配置文件缺失
如果缺少datasource配置文件：
1. 确保NC_HOME路径正确
2. 检查是否有权限访问相关目录
3. 尝试重新配置数据源

### 问题2：编码问题
如果遇到编码问题：
1. 确保使用UTF-8编码
2. 检查数据库字符集设置
3. 验证系统区域设置

### 问题3：端口冲突
如果端口被占用：
1. 修改配置文件中的端口号
2. 检查是否有其他进程占用
3. 重启VSCode插件

## 与IDEA插件的完全一致性验证

| 配置项 | IDEA插件 | VSCode插件（修复后） | 状态 |
|--------|----------|-------------------|------|
| JVM参数 | ✅ 完整配置 | ✅ 完全一致 | ✅ |
| 环境变量 | ✅ 变量替换 | ✅ 完全一致 | ✅ |
| 数据源路径 | ✅ /ierp/bin/prop.xml | ✅ /ierp/bin/prop.xml | ✅ |
| 编码设置 | ✅ UTF-8 | ✅ UTF-8 | ✅ |
| 时区设置 | ✅ GMT+8 | ✅ GMT+8 | ✅ |

## 下一步操作

1. **重启VSCode插件**
2. **检查启动日志**确认所有配置已生效
3. **测试数据源连接**
4. **如仍有问题，请提供具体的错误日志**

修复已完成，现在VSCode插件的JVM参数、环境变量和系统属性配置与IDEA插件完全一致。请重启VSCode插件并测试数据源连接。