import com.sun.jdi.Bootstrap;
import com.sun.jdi.ReferenceType;
import com.sun.jdi.VirtualMachine;
import com.sun.jdi.VirtualMachineManager;
import com.sun.jdi.connect.AttachingConnector;
import com.sun.jdi.connect.Connector;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * YonBIP NC 热部署助手
 *
 * 通过 JPDA / JDI 连接到运行中的 YonBIP HOME 服务，将本地编译后的 .class
 * 文件通过 redefineClasses 推送到远端 JVM，实现 Java 代码的即时生效。
 *
 * 使用方式：
 *   java -cp <tools.jar/classpath> HotDeployHelper <host> <jdwpPort> <classFile> [<classFile> ...]
 *
 * 退出码：
 *   0 - 全部成功
 *   1 - 参数错误
 *   2 - 连接失败
 *   3 - 重定义失败
 *
 * 依赖：
 *   - JDK 8+ : 需将 lib/tools.jar 加入 classpath（JDK 9+ 已模块化）
 *   - 运行中的 JVM 必须以 -agentlib:jdwp=...,server=y,suspend=n 启动
 */
public class HotDeployHelper {

    private static final String CONNECTOR_NAME = "com.sun.jdi.SocketAttach";

    public static void main(String[] args) throws Exception {
        if (args.length < 3) {
            System.err.println("[HotDeployHelper] 用法: java HotDeployHelper <host> <jdwpPort> <classFile> [<classFile> ...]");
            System.err.println("[HotDeployHelper] 例:   java HotDeployHelper 127.0.0.1 8888 build/classes/com/example/Foo.class");
            System.exit(1);
        }

        String host = args[0];
        int port;
        try {
            port = Integer.parseInt(args[1]);
        } catch (NumberFormatException nfe) {
            System.err.println("[HotDeployHelper] 无效的端口号: " + args[1]);
            System.exit(1);
            return;
        }

        List<File> classFiles = new ArrayList<>();
        for (int i = 2; i < args.length; i++) {
            File f = new File(args[i]);
            if (!f.exists() || !f.isFile()) {
                System.err.println("[HotDeployHelper] class 文件不存在: " + args[i]);
                System.exit(1);
                return;
            }
            classFiles.add(f);
        }

        log("准备连接 JDPA " + host + ":" + port + "，待热加载类数量: " + classFiles.size());

        VirtualMachine vm = null;
        try {
            vm = attach(host, port);
            log("已附加到目标 JVM，版本: " + vm.version());

            // 构造 redefineClasses 请求
            Map<ReferenceType, byte[]> map = new HashMap<>();
            int resolved = 0;
            int unresolved = 0;
            for (File classFile : classFiles) {
                String fqcn = toFqcn(classFile);
                if (fqcn == null) {
                    log("跳过无法解析类名的文件: " + classFile.getAbsolutePath());
                    continue;
                }
                List<ReferenceType> types = vm.classesByName(fqcn);
                if (types == null || types.isEmpty()) {
                    log("[警告] 目标 JVM 中找不到类: " + fqcn + "（类可能还未被加载，需先访问一次触发加载）");
                    unresolved++;
                    continue;
                }
                ReferenceType rt = types.get(0);
                byte[] bytes = Files.readAllBytes(classFile.toPath());
                map.put(rt, bytes);
                resolved++;
            }

            if (map.isEmpty()) {
                log("[失败] 没有任何可重定义的类（JVM 中未找到对应 Class）");
                System.exit(3);
                return;
            }

            log("提交 redefineClasses 请求，共 " + map.size() + " 个类...");
            try {
                // JDK 9+: VirtualMachine 直接提供 redefineClasses 方法
                // 注意：canRedefineClasses() 返回 false 时表示该 JVM 不支持 schema 变化（仅方法体可换）
                if (!vm.canRedefineClasses()) {
                    log("[警告] 目标 JVM 报告 canRedefineClasses=false，仅支持方法体内修改（无 DCEVM）");
                }
                vm.redefineClasses(map);
                log("[成功] 已热加载 " + map.size() + " 个类（unresolved=" + unresolved + "）");
                System.exit(0);
            } catch (Exception e) {
                log("[失败] redefineClasses 抛出异常: " + e.getMessage());
                throw e;
            }
        } catch (Exception e) {
            log("[失败] 热加载异常: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            e.printStackTrace(System.err);
            System.exit(3);
        } finally {
            if (vm != null) {
                try {
                    vm.dispose();
                } catch (Exception ignore) {
                    // ignore
                }
            }
        }
    }

    private static VirtualMachine attach(String host, int port) throws Exception {
        VirtualMachineManager vmm = Bootstrap.virtualMachineManager();
        AttachingConnector connector = null;
        for (AttachingConnector c : vmm.attachingConnectors()) {
            if (CONNECTOR_NAME.equals(c.name())) {
                connector = c;
                break;
            }
        }
        if (connector == null) {
            throw new IllegalStateException("未找到 SocketAttach 连接器，请确认 classpath 中包含 tools.jar（JDK 8）或 jdk.jdi 模块（JDK 9+）");
        }
        Map<String, Connector.Argument> arguments = connector.defaultArguments();
        arguments.get("hostname").setValue(host);
        arguments.get("port").setValue(String.valueOf(port));
        arguments.get("timeout").setValue(String.valueOf(15000));
        return connector.attach(arguments);
    }

    /**
     * 从 .class 文件路径反推完全限定类名。
     * 例：build/classes/com/example/Foo.class -> com.example.Foo
     * 例：/tmp/v1/Demo.class -> Demo （没有 packages 路径，目录名是 v1 不是包名）
     *
     * 启发策略：优先匹配 "classes" 根目录标记；匹配不到时，只在父目录名看起来
     * 像 Java 标识符（全部小写或下划线分词）时把它当作包名片段，否则视为 default package。
     */
    private static String toFqcn(File classFile) {
        String path = classFile.getAbsolutePath();
        path = path.replace(File.separatorChar, '/');

        // 1) 优先匹配 "classes" 输出根目录
        String[] markers = {"/build/classes/", "/classes/", "/target/classes/", "/WEB-INF/classes/", "/bin/"};
        for (String marker : markers) {
            int i = path.indexOf(marker);
            if (i >= 0) {
                String tail = path.substring(i + marker.length());
                if (!tail.endsWith(".class")) {
                    return null;
                }
                tail = tail.substring(0, tail.length() - 6);
                return tail.replace('/', '.');
            }
        }

        // 2) 没有命中标记目录；尝试从包路径式目录（a/b/c/Demo.class）反推
        //    通过逐级向上找与类名相同的 .java 文件来定位包根
        String name = classFile.getName();
        if (!name.endsWith(".class")) {
            return null;
        }
        String simpleName = name.substring(0, name.length() - 6);
        File dir = classFile.getParentFile();
        // 默认假设 default package
        String pkg = "";
        // 限制反推深度
        File cur = dir;
        for (int depth = 0; depth < 8 && cur != null; depth++) {
            File javaCandidate = new File(cur, simpleName + ".java");
            if (javaCandidate.exists()) {
                // 找到 java 源文件了，从这里开始往上拼包名
                StringBuilder sb = new StringBuilder();
                File p = dir;
                while (p != null && !p.equals(cur)) {
                    sb.insert(0, p.getName() + ".");
                    p = p.getParentFile();
                }
                pkg = sb.length() > 0 ? sb.substring(0, sb.length() - 1) : "";
                break;
            }
            cur = cur.getParentFile();
        }
        return (pkg.isEmpty() ? "" : pkg + ".") + simpleName;
    }

    private static void log(String msg) {
        System.out.println("[HotDeployHelper] " + msg);
    }
}