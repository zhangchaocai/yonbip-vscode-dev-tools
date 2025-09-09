import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 项目配置接口
 */
export interface ProjectConfig {
    name: string;
    version: string;
    description: string;
    author: string;
    type: 'yonbip' | 'standard';
    modules: string[];
    dependencies: string[];
}

/**
 * 补丁信息接口
 */
export interface PatchInfo {
    name: string;
    version: string;
    description: string;
    files: string[];
    outputPath: string;
    includeSource: boolean;
    includeResources: boolean;
    includeConfig: boolean;
}

/**
 * 项目管理服务
 */
export class ProjectService {
    private context: vscode.ExtensionContext;
    private outputChannel: vscode.OutputChannel;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('YonBIP 项目管理');
    }

    /**
     * 创建YonBIP项目
     */
    public async createYonBipProject(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showWarningMessage('请先打开一个工作区文件夹');
            return;
        }

        const projectInfo = await this.getProjectInfo();
        if (!projectInfo) {
            return;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在创建YonBIP项目...',
                cancellable: false
            }, async (progress) => {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                const projectPath = path.join(workspaceRoot, projectInfo.name);

                progress.report({ increment: 20, message: '创建项目目录结构...' });
                await this.createProjectStructure(projectPath, projectInfo);

                progress.report({ increment: 40, message: '生成项目配置文件...' });
                await this.generateProjectFiles(projectPath, projectInfo);

                progress.report({ increment: 70, message: '创建示例代码...' });
                await this.createSampleCode(projectPath, projectInfo);

                progress.report({ increment: 100, message: '完成项目初始化...' });

                vscode.window.showInformationMessage(
                    `YonBIP项目 "${projectInfo.name}" 创建成功！`,
                    '打开项目'
                ).then(choice => {
                    if (choice === '打开项目') {
                        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath));
                    }
                });
            });

        } catch (error: any) {
            vscode.window.showErrorMessage(`创建项目失败: ${error.message}`);
            this.outputChannel.appendLine(`错误详情: ${error.stack}`);
        }
    }

    /**
     * 导出补丁包
     */
    public async exportPatch(selectedPath?: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('请先打开一个工作区');
            return;
        }

        try {
            const patchInfo = await this.getPatchInfo();
            if (!patchInfo) {
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在导出补丁包...',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 20, message: '收集文件...' });
                
                const files = await this.collectPatchFiles(
                    selectedPath || workspaceFolder.uri.fsPath, 
                    patchInfo
                );

                progress.report({ increment: 60, message: '创建补丁包...' });
                
                const outputPath = await this.createPatchZip(files, patchInfo);

                progress.report({ increment: 100, message: '导出完成' });

                vscode.window.showInformationMessage(
                    `补丁包导出成功: ${outputPath}`,
                    '打开文件夹'
                ).then(choice => {
                    if (choice === '打开文件夹') {
                        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputPath));
                    }
                });
            });

        } catch (error: any) {
            vscode.window.showErrorMessage(`导出补丁包失败: ${error.message}`);
            this.outputChannel.appendLine(`错误详情: ${error.stack}`);
        }
    }

    /**
     * 获取项目信息
     */
    private async getProjectInfo(): Promise<ProjectConfig | undefined> {
        const name = await vscode.window.showInputBox({
            prompt: '请输入项目名称',
            validateInput: (value) => {
                if (!value.trim()) return '项目名称不能为空';
                if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {
                    return '项目名称只能包含字母、数字、下划线和连字符，且必须以字母开头';
                }
                return null;
            }
        });

        if (!name) return undefined;

        const version = await vscode.window.showInputBox({
            prompt: '请输入项目版本',
            value: '1.0.0',
            validateInput: (value) => {
                if (!/^\d+\.\d+\.\d+$/.test(value)) {
                    return '版本号格式应为: x.y.z (如: 1.0.0)';
                }
                return null;
            }
        });

        if (!version) return undefined;

        const description = await vscode.window.showInputBox({
            prompt: '请输入项目描述 (可选)',
            value: `${name} YonBIP高级版项目`
        }) || '';

        const author = await vscode.window.showInputBox({
            prompt: '请输入作者名称 (可选)',
            value: process.env.USER || process.env.USERNAME || 'Developer'
        }) || 'Developer';

        const projectType = await vscode.window.showQuickPick([
            { label: 'yonbip', description: 'YonBIP高级版项目', detail: '包含完整的YonBIP框架结构' },
            { label: 'standard', description: '标准Java项目', detail: '标准的Maven项目结构' }
        ], {
            placeHolder: '选择项目类型'
        });

        if (!projectType) return undefined;

        return {
            name,
            version,
            description,
            author,
            type: projectType.label as 'yonbip' | 'standard',
            modules: [],
            dependencies: []
        };
    }

    /**
     * 创建项目目录结构
     */
    private async createProjectStructure(projectPath: string, config: ProjectConfig): Promise<void> {
        const structure = config.type === 'yonbip' ? [
            'src/main/java',
            'src/main/resources',
            'src/main/resources/META-INF',
            'src/main/resources/lang',
            'src/test/java',
            'client/src/main/java',
            'public/src/main/java',
            'lib',
            'config',
            'script',
            'docs'
        ] : [
            'src/main/java',
            'src/main/resources',
            'src/test/java',
            'src/test/resources',
            'lib',
            'docs'
        ];
        
        for (const dir of structure) {
            const fullPath = path.join(projectPath, dir);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
            }
        }
    }

    /**
     * 生成项目配置文件
     */
    private async generateProjectFiles(projectPath: string, config: ProjectConfig): Promise<void> {
        // 生成pom.xml
        const pomContent = this.generatePomXml(config);
        fs.writeFileSync(path.join(projectPath, 'pom.xml'), pomContent, 'utf-8');

        // 生成README.md
        const readmeContent = this.generateReadme(config);
        fs.writeFileSync(path.join(projectPath, 'README.md'), readmeContent, 'utf-8');

        // 生成.gitignore
        const gitignoreContent = this.generateGitignore();
        fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignoreContent, 'utf-8');

        if (config.type === 'yonbip') {
            // 生成YonBIP特有文件
            const moduleContent = this.generateModuleXml(config);
            fs.writeFileSync(path.join(projectPath, 'src/main/resources/META-INF/module.xml'), moduleContent, 'utf-8');
        }
    }

    /**
     * 生成pom.xml
     */
    private generatePomXml(config: ProjectConfig): string {
        return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>${config.type === 'yonbip' ? 'com.yonyou' : 'com.example'}</groupId>
    <artifactId>${config.name}</artifactId>
    <version>${config.version}</version>
    <packaging>jar</packaging>

    <name>${config.name}</name>
    <description>${config.description}</description>

    <properties>
        <maven.compiler.source>8</maven.compiler.source>
        <maven.compiler.target>8</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <dependencies>
        ${config.type === 'yonbip' ? `<dependency>
            <groupId>com.yonyou</groupId>
            <artifactId>yonbip-framework</artifactId>
            <version>2023.1.0</version>
            <scope>provided</scope>
        </dependency>` : ''}
        
        <dependency>
            <groupId>junit</groupId>
            <artifactId>junit</artifactId>
            <version>4.13.2</version>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.8.1</version>
                <configuration>
                    <source>8</source>
                    <target>8</target>
                    <encoding>UTF-8</encoding>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`;
    }

    /**
     * 生成README.md
     */
    private generateReadme(config: ProjectConfig): string {
        return `# ${config.name}

${config.description}

## 项目信息

- **项目类型**: ${config.type === 'yonbip' ? 'YonBIP高级版' : '标准Java'}项目
- **版本**: ${config.version}
- **作者**: ${config.author}

## 开发环境

- Java 8+
- Maven 3.6+
${config.type === 'yonbip' ? '- YonBIP平台 2023.1.0+' : ''}

## 构建和运行

\`\`\`bash
# 编译项目
mvn clean compile

# 运行测试
mvn test

# 打包项目
mvn package
\`\`\`

## 许可证

版权所有 © ${new Date().getFullYear()} ${config.author}
`;
    }

    /**
     * 生成.gitignore
     */
    private generateGitignore(): string {
        return `# Compiled class file
*.class
*.log
*.jar
*.war

# Maven
target/
.mvn/

# IDE
.idea/
*.iml
.vscode/
.classpath
.project
.settings/

# OS
.DS_Store
Thumbs.db

# YonBIP specific
hotwebs/
webapps/
logs/
temp/
`;
    }

    /**
     * 生成module.xml
     */
    private generateModuleXml(config: ProjectConfig): string {
        return `<?xml version="1.0" encoding="UTF-8"?>
<module name="${config.name}" version="${config.version}">
    <description>${config.description}</description>
    <author>${config.author}</author>
</module>`;
    }

    /**
     * 创建示例代码
     */
    private async createSampleCode(projectPath: string, config: ProjectConfig): Promise<void> {
        const packagePath = config.type === 'yonbip' ? 
            `com/yonyou/${config.name.toLowerCase()}` : 
            `com/example/${config.name.toLowerCase()}`;

        const mainDir = path.join(projectPath, 'src/main/java', packagePath);
        fs.mkdirSync(mainDir, { recursive: true });

        const mainContent = config.type === 'yonbip' ? 
            this.generateYonBipSample(config) : 
            this.generateStandardSample(config);

        fs.writeFileSync(path.join(mainDir, 'Main.java'), mainContent, 'utf-8');
    }

    /**
     * 生成YonBIP示例代码
     */
    private generateYonBipSample(config: ProjectConfig): string {
        return `package com.yonyou.${config.name.toLowerCase()};

/**
 * ${config.description} - YonBIP示例
 * 
 * @author ${config.author}
 * @version ${config.version}
 */
public class Main {
    
    public static void main(String[] args) {
        System.out.println("Welcome to ${config.name}!");
        System.out.println("YonBIP高级版项目启动成功");
    }
}`;
    }

    /**
     * 生成标准示例代码
     */
    private generateStandardSample(config: ProjectConfig): string {
        return `package com.example.${config.name.toLowerCase()};

/**
 * ${config.description} - 标准Java示例
 * 
 * @author ${config.author}
 * @version ${config.version}
 */
public class Main {
    
    public static void main(String[] args) {
        System.out.println("Hello, ${config.name}!");
        System.out.println("${config.description}");
    }
}`;
    }

    /**
     * 获取补丁信息
     */
    private async getPatchInfo(): Promise<PatchInfo | undefined> {
        const name = await vscode.window.showInputBox({
            prompt: '请输入补丁包名称',
            value: `patch_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
            validateInput: (value) => !value.trim() ? '补丁包名称不能为空' : null
        });

        if (!name) return undefined;

        const version = await vscode.window.showInputBox({
            prompt: '请输入补丁版本',
            value: '1.0.0',
            validateInput: (value) => {
                if (!/^\d+\.\d+\.\d+$/.test(value)) {
                    return '版本号格式应为: x.y.z (如: 1.0.0)';
                }
                return null;
            }
        });

        if (!version) return undefined;

        const description = await vscode.window.showInputBox({
            prompt: '请输入补丁描述 (可选)',
            value: `${name} 补丁包`
        }) || '';

        return {
            name,
            version,
            description,
            files: [],
            outputPath: '',
            includeSource: true,
            includeResources: true,
            includeConfig: false
        };
    }

    /**
     * 收集补丁文件
     */
    private async collectPatchFiles(basePath: string, patchInfo: PatchInfo): Promise<string[]> {
        const files: string[] = [];
        
        const scanDir = (dirPath: string) => {
            if (!fs.existsSync(dirPath)) return;
            
            const items = fs.readdirSync(dirPath);
            
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                const stat = fs.statSync(fullPath);
                
                if (stat.isDirectory()) {
                    // 跳过一些目录
                    if (item === 'node_modules' || item === '.git' || item === 'target') {
                        continue;
                    }
                    scanDir(fullPath);
                } else {
                    const ext = path.extname(item).toLowerCase();
                    const shouldInclude = 
                        (patchInfo.includeSource && ['.java', '.js', '.ts'].includes(ext)) ||
                        (patchInfo.includeResources && ['.xml', '.properties', '.json'].includes(ext)) ||
                        (patchInfo.includeConfig && ['.yml', '.yaml', '.conf'].includes(ext));
                    
                    if (shouldInclude) {
                        files.push(fullPath);
                    }
                }
            }
        };

        scanDir(basePath);
        return files;
    }

    /**
     * 创建补丁ZIP文件
     */
    private async createPatchZip(files: string[], patchInfo: PatchInfo): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('未找到工作区');
        }

        const outputDir = path.join(workspaceFolder.uri.fsPath, 'patches');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputPath = path.join(outputDir, `${patchInfo.name}_${patchInfo.version}.zip`);
        
        // 这里应该使用archiver库创建ZIP文件
        // 由于简化，我们创建一个简单的文件列表
        const manifestContent = `补丁包信息:
名称: ${patchInfo.name}
版本: ${patchInfo.version}
描述: ${patchInfo.description}
创建时间: ${new Date().toISOString()}
文件列表:
${files.map(f => `- ${f}`).join('\n')}
`;

        fs.writeFileSync(outputPath.replace('.zip', '_manifest.txt'), manifestContent, 'utf-8');
        
        this.outputChannel.appendLine(`补丁清单已生成: ${outputPath.replace('.zip', '_manifest.txt')}`);
        
        return outputPath.replace('.zip', '_manifest.txt');
    }

    /**
     * 显示输出通道
     */
    public showOutput(): void {
        this.outputChannel.show();
    }
}