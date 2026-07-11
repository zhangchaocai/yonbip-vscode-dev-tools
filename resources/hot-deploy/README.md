# YonBIP 热部署使用指南

> 一套基于 JPDA / JDI 的 YonBIP NC 热部署方案，让你在调试时改完 Java 代码即可立即生效，
> 不再走"重新打补丁 → 重启 HOME → 重新登录"的循环。

## 一、工作原理

YonBIP NC HOME 服务在"调试模式"启动时，会附带 JPDA 参数：

```
-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=8888
```

这意味着 JVM 在 `8888`（或自定义）端口开了一个调试 socket。VS Code 可以用 JDI 客户端
连接过去并调用 `VirtualMachine.redefineClasses()` 把新的 class 字节码推送到运行中的 JVM，
这就是热加载。

> 标准 JDK 仅支持"方法体内修改"。若需要新增/删除字段或方法，需使用 [DCEVM](https://github.com/TravaOpenJDK/trava-jdk-11-dcevm)
> 或 HotswapAgent 补丁版 JDK。

## 二、文件结构

```
src/project/hot-deploy/
├── HotDeployService.ts       # 主服务：监听 / 编译 / 部署
└── HotDeployCommands.ts      # 命令注册

resources/hot-deploy/
├── HotDeployHelper.java      # JDI 热部署助手源码
├── hot-deploy-helper.jar     # 已编译的助手 JAR（构建产物）
└── build-helper.sh           # 重新编译助手的脚本
```

## 三、使用步骤

1. **以调试模式启动 HOME 服务**
   - 工具栏点击 🖥️ 按钮，或命令面板执行 "YonBIP/HOME: 调试启动HOME服务"
   - 确认服务启动成功（输出面板出现 `Server startup in` 字样）

2. **开启热部署监听**（三种方式任选其一）
   - 命令面板 → `YonBIP/热部署: 开启热部署监听`
   - 在 `settings.json` 设置 `yonbip.hotDeploy.enabled: true`（自动随 HOME 启动开启）
   - 右键 `.java` 文件 → YonBIP 文件操作 → 🔥 切换热部署开关

3. **修改并保存 Java 文件**
   - 状态栏左侧会显示当前状态：`空闲 / 监听中 / 编译中 / 部署中 / 异常`
   - 几秒后会自动编译并通过 JDI 推送到运行中的 JVM

4. **（可选）手动部署**
   - 右键当前 Java 文件 → ⚡ 热部署当前 Java 文件
   - 命令面板 → `YonBIP/热部署: 全量热部署`（推送 `build/classes` 下所有 class）

## 四、配置项（settings.json）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `yonbip.hotDeploy.enabled` | boolean | `false` | HOME 启动后自动开启热部署 |
| `yonbip.hotDeploy.mode` | enum | `auto` | `jdi` / `ncHotDeploy` / `auto`（JDI 失败回退 NC 拷贝） |
| `yonbip.hotDeploy.autoCompile` | boolean | `true` | 保存 .java 时自动 javac |
| `yonbip.hotDeploy.debounceMs` | number | `300` | 防抖窗口（毫秒）|

## 五、模式说明

### `jdi` 模式（默认推荐）

走 JPDA / JDI 推送 class 字节码。优点是真正的"运行时替换"，**无需重启任何东西**。
局限：
- 标准 JDK 只支持方法体内的修改（增删字段/方法会抛异常）
- 想要完整 hot reload 需要 DCEVM 补丁版 JDK
- 类必须已被加载（如果改的是从未被访问过的类，需要先访问一次触发类加载）

### `ncHotDeploy` 模式

把编译后的 .class 拷贝到 `${NC_HOME}/external/classes/` 下，并写入 `.reload` 哨兵文件，
适用于：
- HOME 是普通模式启动（非调试）
- 想新增类（NC 会重新扫描 external/classes）

### `auto` 模式

先尝试 `jdi`，失败（如目标 JVM 没有 JPDA）时自动回退到 `ncHotDeploy`。

## 六、常见问题

### Q: 状态显示"找不到类"
类还没有被目标 JVM 加载。访问一次这个类的对应接口/页面，触发类加载后再保存即可。

### Q: redefineClasses 报 schema 不匹配
说明你的改动超出了方法体范围。两种处理：
1. 改回方法体内（保留方法签名、字段集合），重新保存
2. 切到 `ncHotDeploy` 模式并重启对应 webapp

### Q: javac 找不到
请确保 `JAVA_HOME` 指向 JDK（不是 JRE）。VS Code 的 `java.configuration.runtimes` 也会被识别。

### Q: Windows 上提示找不到 `tools.jar`
JDK 9+ 已模块化，无需 tools.jar。插件会自动处理。

## 七、开发者手册

如果修改了 `HotDeployHelper.java`，需要重新编译打包：

```bash
cd resources/hot-deploy
./build-helper.sh
```

产物 `hot-deploy-helper.jar` 会被自动随插件发布（`.vscodeignore` 中 `resources/**` 保留）。

手动验证助手：

```bash
# 启动一个调试模式的小 JVM（端口 19999）
java -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=19999 -cp /tmp/v1 Demo

# 另一个终端执行热加载
java -cp resources/hot-deploy/hot-deploy-helper.jar HotDeployHelper 127.0.0.1 19999 /tmp/v2/Demo.class
```