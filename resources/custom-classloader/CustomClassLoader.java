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
        String separator = System.getProperty("path.separator");
        String[] entries = classpath.split(separator);
        for (String entry : entries) {
            addClasspathEntry(entry);
        }
    }
    
    private void addClasspathEntry(String entry) throws Exception {
        File file = new File(entry);
        if (file.exists()) {
            addURL(file.toURI().toURL());
        } else if (entry.endsWith("/*")) {
            // 处理通配符路径，如 lib/*
            String dirPath = entry.substring(0, entry.length() - 2); // 移除 "/*"
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