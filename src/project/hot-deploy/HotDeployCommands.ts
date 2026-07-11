import * as vscode from 'vscode';
import { NCHomeConfigService } from '../nc-home/config/NCHomeConfigService';
import { HomeService } from '../nc-home/HomeService';
import { HotDeployService, HotDeployMode } from './HotDeployService';

/**
 * 热部署命令注册
 *
 * 命令清单：
 *   yonbip.hotDeploy.start         - 开启热部署监听
 *   yonbip.hotDeploy.stop          - 停止热部署监听
 *   yonbip.hotDeploy.toggle        - 切换开启/关闭
 *   yonbip.hotDeploy.deployActive  - 部署当前编辑的 Java 文件
 *   yonbip.hotDeploy.deployAll     - 部署 build/classes 下全部 class
 *   yonbip.hotDeploy.status        - 查看状态
 *   yonbip.hotDeploy.setMode       - 切换部署模式（jdi / ncHotDeploy / auto）
 */
export class HotDeployCommands {
    public static registerCommands(
        context: vscode.ExtensionContext,
        configService: NCHomeConfigService,
        homeService: HomeService
    ): HotDeployService {
        const service = new HotDeployService(context, configService, homeService);

        context.subscriptions.push(
            vscode.commands.registerCommand('yonbip.hotDeploy.start', async () => {
                try {
                    await service.start();
                    vscode.window.showInformationMessage('YonBIP 热部署已开启');
                } catch (err: any) {
                    vscode.window.showErrorMessage(`开启热部署失败: ${err.message}`);
                }
            }),

            vscode.commands.registerCommand('yonbip.hotDeploy.stop', async () => {
                await service.stop();
                vscode.window.showInformationMessage('YonBIP 热部署已停止');
            }),

            vscode.commands.registerCommand('yonbip.hotDeploy.toggle', async () => {
                if (service.isWatching()) {
                    await service.stop();
                    vscode.window.showInformationMessage('YonBIP 热部署已停止');
                } else {
                    try {
                        await service.start();
                        vscode.window.showInformationMessage('YonBIP 热部署已开启');
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`开启热部署失败: ${err.message}`);
                    }
                }
            }),

            vscode.commands.registerCommand('yonbip.hotDeploy.deployActive', async () => {
                const result = await service.deployActiveEditor();
                if (result) {
                    if (result.success) {
                        vscode.window.showInformationMessage(
                            `热部署成功 (${result.mode})，${result.changedFiles.length} 个类，${result.durationMs}ms`
                        );
                    } else {
                        vscode.window.showErrorMessage(`热部署失败: ${result.message}`);
                    }
                }
            }),

            vscode.commands.registerCommand('yonbip.hotDeploy.deployAll', async () => {
                const result = await service.deployAll();
                if (result) {
                    if (result.success) {
                        vscode.window.showInformationMessage(
                            `全量热部署成功 (${result.mode})，${result.changedFiles.length} 个类，${result.durationMs}ms`
                        );
                    } else {
                        vscode.window.showErrorMessage(`全量热部署失败: ${result.message}`);
                    }
                }
            }),

            vscode.commands.registerCommand('yonbip.hotDeploy.status', () => {
                service.showStatus();
            }),

            vscode.commands.registerCommand('yonbip.hotDeploy.setMode', async () => {
                const pick = await vscode.window.showQuickPick<{ label: string; description: string; mode: HotDeployMode }>(
                    [
                        { label: '$(zap) JDI 热加载', description: '通过 JPDA 把 class 推送到运行中的 JVM，方法体内修改立即生效', mode: 'jdi' },
                        { label: '$(package) NC 热部署', description: '把 class 拷贝到 NC HOME/external/classes，配合 NC 热刷新', mode: 'ncHotDeploy' },
                        { label: '$(debug-restart) 自动', description: '优先 JDI，失败时自动回退到 NC 热部署', mode: 'auto' }
                    ],
                    { placeHolder: '选择热部署模式' }
                );
                if (pick) {
                    await vscode.workspace.getConfiguration().update(HotDeployService.CONFIG_MODE, pick.mode, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(`热部署模式已切换为: ${pick.mode}`);
                }
            })
        );

        context.subscriptions.push(service);
        return service;
    }
}