/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// OI-Code 用户初始化面板扩展主入口
import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import * as util from "util";

const exec = util.promisify(cp.exec);

interface OiCodeSettings {
    cpp?: { path: string };
    python?: { path: string };
    workspace?: { path: string };
}

class CompilerScanner {
    private async executeCommand(command: string): Promise<string[]> {
        try {
            const { stdout } = await exec(command);
            return stdout.trim().split(/\r?\n/).filter(p => p.trim());
        } catch (error) {
            console.error(`Error executing command "${command}":`, error);
            return [];
        }
    }

    private async getCompilerVersion(compilerPath: string): Promise<string> {
        try {
            const { stdout } = await exec(`"${compilerPath}" --version`);
            // Extract first line or relevant part of version
            return stdout.split('\n')[0].trim();
        } catch (e) {
            console.error(`Error getting version for ${compilerPath}:`, e);
            return "(无法获取版本)";
        }
    }

    public async scan(): Promise<{ gpp: { path: string, version: string }[], python: { path: string, version: string }[] }> {
        const isWindows = process.platform === 'win32';
        const cppCommands = isWindows ? ['where g++', 'where gcc', 'where clang', 'where clang++'] : ['which -a g++', 'which -a gcc', 'which -a clang', 'which -a clang++'];
        const pythonCommands = isWindows ? ['where python', 'where python3'] : ['which -a python', 'which -a python3'];

        let allCppPaths: string[] = [];
        for (const cmd of cppCommands) {
            allCppPaths = allCppPaths.concat(await this.executeCommand(cmd));
        }
        allCppPaths = [...new Set(allCppPaths)]; // Deduplicate

        let allPythonPaths: string[] = [];
        for (const cmd of pythonCommands) {
            allPythonPaths = allPythonPaths.concat(await this.executeCommand(cmd));
        }
        allPythonPaths = [...new Set(allPythonPaths)]; // Deduplicate

        const gppWithVersions = await Promise.all(allCppPaths.map(async p => ({
            path: p,
            version: await this.getCompilerVersion(p)
        })));

        const pythonWithVersions = await Promise.all(allPythonPaths.map(async p => ({
            path: p,
            version: await this.getCompilerVersion(p)
        })));

        return {
            gpp: gppWithVersions,
            python: pythonWithVersions
        };
    }
}

async function configureLanguage(type: 'cpp' | 'python', settings: OiCodeSettings, panel: vscode.WebviewPanel) {
    try {
        const scanner = new CompilerScanner();
        const quickPick = vscode.window.createQuickPick();
        quickPick.title = `配置 ${type === 'cpp' ? 'C++' : 'Python'} 环境`;
        quickPick.placeholder = `正在扫描可用的 ${type === 'cpp' ? 'g++' : 'Python'} ...`;
        quickPick.ignoreFocusOut = true;
        quickPick.show();

        const compilers = await scanner.scan();
        const pathsWithVersions = type === 'cpp' ? compilers.gpp : compilers.python;

        const items: vscode.QuickPickItem[] = pathsWithVersions.map(item => ({
            label: `${item.version} - ${item.path}`,
            description: "扫描到的路径",
            detail: item.path // Store original path in detail
        }));
        items.push({ label: `手动选择 ${type === 'cpp' ? "g++" : "Python"} 路径...`, iconPath: new vscode.ThemeIcon('folder-opened') });
        items.push({ label: `帮我下载并配置...`, iconPath: new vscode.ThemeIcon('cloud-download') });
        items.push({ label: "暂不配置", iconPath: new vscode.ThemeIcon('circle-slash') });

        quickPick.items = items;
        quickPick.placeholder = `请选择一个 ${type === 'cpp' ? 'g++ 编译器' : 'Python 解释器'}`;

        return new Promise<void>((resolve) => {
            quickPick.onDidAccept(async () => {
                const selection = quickPick.selectedItems[0];
                if (selection) {
                    if (selection.description === "扫描到的路径") {
                        settings[type] = { path: selection.detail || selection.label };
                        try {
                            vscode.window.showInformationMessage(`${type} 环境已设置为: ${settings[type]?.path}`);
                        } catch (e) {
                            console.error(e);
                        }
                    } else if (selection.label.startsWith("手动选择")) {
                        try {
                            const options: vscode.OpenDialogOptions = {
                                canSelectMany: false,
                                openLabel: "选择",
                                canSelectFiles: true,
                                canSelectFolders: false
                            };
                            const uris = await vscode.window.showOpenDialog(options);
                            if (uris && uris.length > 0) {
                                settings[type] = { path: uris[0].fsPath };
                                try {
                                    vscode.window.showInformationMessage(`${type} 环境已设置为: ${uris[0].fsPath}`);
                                } catch (e) {
                                    console.error(e);
                                }
                            }
                        } catch (e) {
                            vscode.window.showErrorMessage(`手动选择 ${type} 路径时出错: ${e}`);
                        }
                    } else if (selection.label.startsWith("帮我下载")) {
                        panel.webview.postMessage({ command: "initialization-output", output: `正在下载并配置 ${type === "cpp" ? "MinGW/Clang" : "Python"}...\n` });
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        const simulatedPath = type === "cpp" ? "C:\\MinGW\\bin\\g++.exe" : "/usr/bin/python";
                        settings[type] = { path: simulatedPath };
                        panel.webview.postMessage({ command: "initialization-output", output: `  - ${type === "cpp" ? "MinGW/Clang" : "Python"} 下载并配置完成。路径: ${simulatedPath}\n` });
                        try {
                            vscode.window.showInformationMessage(`已模拟下载并配置 ${type}。`);
                        } catch (e) {
                            console.error(e);
                        }
                    }
                }
                quickPick.dispose();
                resolve();
            });
            quickPick.onDidHide(() => {
                quickPick.dispose();
                resolve();
            });
        });
    } catch (e) {
        vscode.window.showErrorMessage(`配置 ${type} 环境时出错: ${e}`);
    }
}

function getTheme(kind: vscode.ColorThemeKind): string {
    return (kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast) ? "dark" : "light";
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('oi-init.showWelcomePage', () => {
        const panel = vscode.window.createWebviewPanel(
            'oiInitWelcome', 'OI-Code 初始化', vscode.ViewColumn.One, { enableScripts: true }
        );

        const settings: OiCodeSettings = {};
        let initializationProcess: cp.ChildProcess | undefined;

        // Asynchronously load webview content
        getWebviewContent(context).then(htmlContent => {
            panel.webview.html = htmlContent;
        }).catch(e => {
            panel.webview.html = `<h1>Error: Could not load initialization page.</h1><p>${e}</p>`;
            console.error("Failed to load webview content", e);
        });

        const themeListener = vscode.window.onDidChangeActiveColorTheme(e => {
            panel.webview.postMessage({ command: 'set-theme', theme: getTheme(e.kind) });
        });

        panel.webview.onDidReceiveMessage(async message => {
            try {
                switch (message.command) {
                    case 'get-theme':
                        panel.webview.postMessage({ command: 'set-theme', theme: getTheme(vscode.window.activeColorTheme.kind) });
                        break;
                    case 'configure-languages':
                        const { languages } = message;
                        if (languages.includes('cpp')) await configureLanguage('cpp', settings, panel);
                        if (languages.includes('python')) await configureLanguage('python', settings, panel);
                        panel.webview.postMessage({ command: 'go-to-step', step: 2 }); // Advance to workspace selection
                        break;
                    case 'select-theme':
                        try { await vscode.commands.executeCommand('workbench.action.selectTheme'); } catch (e) { console.error(e); }
                        break;
                    case 'select-folder':
                        try {
                            const options: vscode.OpenDialogOptions = {
                                canSelectMany: false,
                                openLabel: '选择工作区文件夹',
                                canSelectFiles: false,
                                canSelectFolders: true,
                            };
                            const uris = await vscode.window.showOpenDialog(options);
                            if (uris && uris.length > 0) {
                                settings.workspace = { path: uris[0].fsPath };
                                try { vscode.window.showInformationMessage(`工作区已设置为: ${uris[0].fsPath}`); } catch (e) { console.error(e); }
                            }
                        } catch (e) {
                            vscode.window.showErrorMessage(`选择工作区文件夹时出错: ${e}`);
                        }
                        break;
                    case 'initialize':
                        console.log("Extension: Received initialize command.");
                        panel.webview.postMessage({ command: 'initialization-output', output: '开始初始化 OI-Code 环境...\n' });
                        panel.webview.postMessage({ command: 'initialization-progress', progress: 0 });

                        const totalTasks = 4; // Total number of distinct tasks
                        let completedTasks = 0;

                        const sendProgress = async (output: string, incrementTask: boolean = true) => {
                            console.log("Extension: Sending progress - ", output.trim());
                            panel.webview.postMessage({ command: 'initialization-output', output });
                            if (incrementTask) {
                                completedTasks++;
                            }
                            const progress = Math.min(100, Math.floor((completedTasks / totalTasks) * 100));
                            panel.webview.postMessage({ command: 'initialization-progress', progress });
                            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay for UI update
                        };

                        // Task 1: Set UI language to Chinese
                        await sendProgress('设置界面语言为中文...\n');
                        try {
                            await vscode.workspace.getConfiguration().update('locale', 'zh-cn', vscode.ConfigurationTarget.Global);
                            await sendProgress('界面语言设置完成。\n');
                        } catch (e) {
                            await sendProgress(`界面语言设置失败: ${e}\n`);
                            console.error("Failed to set locale", e);
                        }

                        // Task 2: Save compiler/interpreter settings and configure related extensions
                        await sendProgress('保存编译器/解释器设置并配置相关扩展...\n');
                        if (settings.cpp) {
                            try {
                                await vscode.workspace.getConfiguration().update('oi-code.cpp.compilerPath', settings.cpp.path, vscode.ConfigurationTarget.Global);
                                // For C++, we primarily rely on cpptools extension to pick up the compiler
                                // If a specific c_cpp_properties.json is needed, it's a more advanced step.
                                await sendProgress(`  - C++ 编译器路径: ${settings.cpp.path}（已保存到 OI-Code 设置）\n`);
                            } catch (e) {
                                await sendProgress(`  - C++ 编译器路径保存失败: ${e}\n`);
                                console.error("Failed to save C++ compiler path", e);
                            }
                        }
                        if (settings.python) {
                            try {
                                await vscode.workspace.getConfiguration().update('python.defaultInterpreterPath', settings.python.path, vscode.ConfigurationTarget.Global);
                                await sendProgress(`  - Python 解释器路径: ${settings.python.path}（已配置 Python 扩展）\n`);
                            } catch (e) {
                                await sendProgress(`  - Python 解释器路径保存失败: ${e}\n`);
                                console.error("Failed to save Python interpreter path", e);
                            }
                        }
                        await sendProgress('编译器/解释器设置保存完成。\n');

                        // Task 3: Install recommended extensions
                        await sendProgress('安装推荐扩展...\n');
                        const extensionsToInstall = ['ms-vscode.cpptools', 'ms-python.python'];
                        for (const extId of extensionsToInstall) {
                            try {
                                await sendProgress(`  - 正在安装 ${extId}...\n`);
                                await vscode.commands.executeCommand('workbench.extensions.installExtension', extId);
                                await sendProgress(`  - ${extId} 安装成功。\n`);
                            } catch (e) {
                                await sendProgress(`  - ${extId} 安装失败: ${e}\n`);
                                console.error(`Failed to install extension ${extId}`, e);
                            }
                        }
                        await sendProgress('推荐扩展安装完成。\n');

                        // Task 4: Finalizing
                        await sendProgress('正在完成初始化...\n');
                        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate work
                        await sendProgress('OI-Code 环境初始化完成！\n');

                        panel.webview.postMessage({ command: 'initialization-complete' });
                        break;
                    case 'open-workspace':
                        if (settings.workspace && settings.workspace.path) {
                            try {
                                const workspaceUri = vscode.Uri.file(settings.workspace.path);
                                await vscode.commands.executeCommand('vscode.openFolder', workspaceUri, true); // true to open in new window
                            } catch (e) {
                                vscode.window.showErrorMessage(`打开工作区时出错: ${e}`);
                            }
                        }
                        panel.dispose();
                        break;
                    case 'continue-config':
                        panel.dispose();
                        try { vscode.window.showInformationMessage('您可以继续在设置中配置 OI-Code。'); } catch (e) { console.error(e); }
                        break;
                    case 'cancel-initialization':
                        if (initializationProcess) {
                            initializationProcess.kill();
                            panel.webview.postMessage({ command: 'initialization-output', output: '初始化过程已取消。\n' });
                        }
                        panel.webview.postMessage({ command: 'initialization-complete' }); // Go to complete screen even if cancelled
                        break;
                }
            } catch (e) {
                vscode.window.showErrorMessage(`操作失败: ${e}`);
            }
        });
    }));

    const hasLaunchedBeforeKey = 'oi-ide.hasLaunchedBefore';
    if (!context.globalState.get<boolean>(hasLaunchedBeforeKey)) {
        try {
            vscode.commands.executeCommand('oi-init.showWelcomePage');
            context.globalState.update(hasLaunchedBeforeKey, true);
        } catch (e) {
            console.error("Failed to show welcome page", e);
        }
    }
}

async function getWebviewContent(context: vscode.ExtensionContext): Promise<string> {
    const htmlPath = vscode.Uri.file(path.join(context.extensionPath, 'src', 'init.html'));
    try {
        const content = await vscode.workspace.fs.readFile(htmlPath); // Use readFile (async)
        return content.toString();
    } catch (e) {
        console.error("Failed to read init.html", e);
        return `<h1>Error: Could not load initialization page.</h1><p>${e}</p>`;
    }
}

export function deactivate() { }
