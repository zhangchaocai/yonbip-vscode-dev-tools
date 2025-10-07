# YonBIP Developer Tools - New Features

## Automatic JDK Configuration

The plugin now automatically configures JDK runtime settings in VS Code workspace settings based on the operating system:

### For macOS:
- First checks JAVA_HOME or JDK_HOME environment variables
- If not found, tries to use `/usr/libexec/java_home` command to get the default JDK path
- If still not found, checks common JDK installation paths:
  - `/Library/Java/JavaVirtualMachines/default/Contents/Home`
  - `/Library/Java/JavaVirtualMachines/jdk1.8.0_281.jdk/Contents/Home`
  - `/Library/Java/JavaVirtualMachines/jdk-11.jdk/Contents/Home`
  - `/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home`
  - `/System/Library/Java/JavaVirtualMachines/1.6.0.jdk/Contents/Home`
- Finally tries to use `which java` command to locate Java executable and infer JDK path
- Validates the found JDK path by checking if it contains the java executable

### For Windows:
- Uses `{USERPROFILE}\ufjdk` as the default JDK path
- If the default path is not valid, checks JAVA_HOME or JDK_HOME environment variables
- Validates the found JDK path by checking if it contains the java.exe executable

### Java Version Detection
The plugin now correctly detects the Java version and configures the appropriate runtime name:
- Java 1.8 ¡ú JavaSE-1.8
- Java 11 ¡ú JavaSE-11
- Java 17 ¡ú JavaSE-17
- Other versions ¡ú JavaSE-{version}

### Configuration Output
The JDK configuration is automatically added to `.vscode/settings.json` under `java.configuration.runtimes`:
```json
{
  "java.configuration.runtimes": [
    {
      "name": "JavaSE-17",
      "path": "/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home"
    },
    {
      "name": "JavaSE-1.8",
      "path": "/Library/Java/JavaVirtualMachines/zulu-8.jdk/Contents/Home"
    }
  ]
}
```

This enhancement improves the developer experience by automatically setting up the Java runtime environment without manual configuration and ensures compatibility between Java versions and runtime names.