import java.io.File;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.List;

/**
 * 自定义类加载器，用于处理超长类路径问题
 * 通过动态加载jar文件来避免命令行参数超长的问题
 */
public class CustomClassLoader extends URLClassLoader {
    
    public CustomClassLoader(String classpath) throws Exception {
        super(new URL[0]); // 初始化空的URL数组
        addClasspathEntries(classpath);
    }
    
    public CustomClassLoader(String[] classpathEntries) throws Exception {
        super(new URL[0]); // 初始化空的URL数组
        for (String entry : classpathEntries) {
            addClasspathEntry(entry);
        }
    }
    
    private void addClasspathEntries(String classpath) throws Exception {
        // 在Windows环境下，路径分隔符处理需要特别注意
        String separator = System.getProperty("path.separator");
        
        // 预处理类路径字符串，处理可能的转义字符
        String processedClasspath = classpath.replace("\\\\", "\\");
        
        // 使用正则表达式分割，处理包含路径分隔符的特殊情况
        String[] entries;
        if (System.getProperty("os.name").toLowerCase().contains("windows")) {
            // Windows环境下需要特殊处理包含空格的路径
            entries = processedClasspath.split(separator + "(?![^\"]*\")");
        } else {
            entries = processedClasspath.split(separator);
        }
        
        for (String entry : entries) {
            // 移除可能的引号
            entry = entry.trim();
            if (entry.startsWith("\"") && entry.endsWith("\"")) {
                entry = entry.substring(1, entry.length() - 1);
            }
            addClasspathEntry(entry);
        }
    }
    
    private void addClasspathEntry(String entry) throws Exception {
        // 处理Windows路径分隔符
        String normalizedEntry = entry.replace("\\", "/");
        File file = new File(normalizedEntry);
        
        if (file.exists()) {
            addURL(file.toURI().toURL());
        } else if (normalizedEntry.endsWith("/*")) {
            // 处理通配符路径，如 lib/*
            String dirPath = normalizedEntry.substring(0, normalizedEntry.length() - 2); // 移除 "/*"
            File dir = new File(dirPath);
            if (dir.exists() && dir.isDirectory()) {
                File[] jarFiles = dir.listFiles(new java.io.FilenameFilter() {
                    @Override
                    public boolean accept(File dir, String name) {
                        return name.toLowerCase().endsWith(".jar");
                    }
                });
                if (jarFiles != null) {
                    for (File jarFile : jarFiles) {
                        addURL(jarFile.toURI().toURL());
                    }
                }
            }
        } else if (normalizedEntry.endsWith("*.jar") || normalizedEntry.contains("*")) {
            // 处理其他通配符模式
            String parentDir = new File(normalizedEntry).getParent();
            if (parentDir != null) {
                File dir = new File(parentDir);
                if (dir.exists() && dir.isDirectory()) {
                    File[] allFiles = dir.listFiles(new java.io.FilenameFilter() {
                        @Override
                        public boolean accept(File dir, String name) {
                            return name.toLowerCase().endsWith(".jar");
                        }
                    });
                    if (allFiles != null) {
                        for (File jarFile : allFiles) {
                            addURL(jarFile.toURI().toURL());
                        }
                    }
                }
            }
        }
    }
    
    public static void main(String[] args) {
        if (args.length < 2) {
            System.err.println("Usage: CustomClassLoader <classpath> <main-class> [main-class-args]");
            System.exit(1);
        }
        
        String classpath = args[0];
        String mainClassName = args[1];
        
        try {
            CustomClassLoader classLoader = new CustomClassLoader(classpath);
            Thread.currentThread().setContextClassLoader(classLoader);
            
            Class<?> mainClass = classLoader.loadClass(mainClassName);
            java.lang.reflect.Method mainMethod = mainClass.getMethod("main", String[].class);
            
            String[] mainArgs = new String[args.length - 2];
            System.arraycopy(args, 2, mainArgs, 0, mainArgs.length);
            
            mainMethod.invoke(null, (Object) mainArgs);
            
        } catch (Exception e) {
            System.err.println("Error in CustomClassLoader: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }
}