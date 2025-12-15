import * as vscode from 'vscode';
import { HomeStatus } from './homeStatus';

/**
 * 工具栏图标服务
 * 用于根据HOME服务状态动态更新工具栏图标的视觉效果
 */
export class ToolbarIconService {
    private static instance: ToolbarIconService;
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public static getInstance(context?: vscode.ExtensionContext): ToolbarIconService {
        if (!ToolbarIconService.instance && context) {
            ToolbarIconService.instance = new ToolbarIconService(context);
        }
        return ToolbarIconService.instance;
    }

    /**
     * 根据HOME服务状态更新工具栏图标的视觉效果
     * @param status HOME服务状态
     */
    public updateToolbarIconVisual(status: HomeStatus): void {
        // 通过设置上下文来控制不同命令的可见性
        vscode.commands.executeCommand('setContext', 'yonbip.home.status', status);
        
        // 根据状态更新命令的可见性
        // 只有在服务运行时才显示停用按钮
        switch (status) {
            case HomeStatus.STOPPED:
            case HomeStatus.ERROR:
                // 服务停止状态，隐藏停用按钮
                vscode.commands.executeCommand('setContext', 'yonbip.home.stop.visible', false);
                break;
            case HomeStatus.RUNNING:
            case HomeStatus.STARTING:
            case HomeStatus.STOPPING:
                // 服务运行状态，显示停用按钮
                vscode.commands.executeCommand('setContext', 'yonbip.home.stop.visible', true);
                break;
        }
    }
}