import { fstatSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import type { ToolPolicy } from "@cline/core";

import { registerDisposable } from "@cline/shared";
import type { Command } from "commander";
import { registerHistoryCommand } from "./commands/history-command";
import {
	CommanderError,
	commanderToParsedArgs,
	createProgram,
} from "./commands/program";
import {
	autoUpdateOnStartup,
	getPreferredKanbanInstaller,
} from "./commands/update";
import { CLI_DEFAULT_CHECKPOINT_CONFIG } from "./runtime/defaults";
import type { TuiStartupTarget } from "./tui/types";
import { getCliBuildInfo } from "./utils/common";
import {
	buildCliCompactionConfig,
	CLI_COMPACTION_MODE_EXPECTED_TEXT,
} from "./utils/compaction-mode";
import {
	refreshCliFeatureFlagsInBackground,
	setCliFeatureFlagsAccountContext,
} from "./utils/feature-flags";
import {
	configureSandboxEnvironment,
	normalizeAutoApproveArgs,
	resolveWorkspaceRoot,
} from "./utils/helpers";
import {
	c,
	installStreamErrorGuards,
	setCurrentOutputMode,
	writeErr,
	writeln,
} from "./utils/output";
import {
	ensureOAuthProviderApiKey,
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeProviderId,
} from "./utils/provider-auth";
import { resolveCliReasoning } from "./utils/reasoning";
import {
	resolveStartupCompactionMode,
	resolveStartupMode,
	resolveStartupToolAutoApprove,
} from "./utils/startup-settings";
import { rewriteTeamPrompt, TEAM_COMMAND_USAGE } from "./utils/team-command";
import {
	captureCliExtensionActivated,
	getCliTelemetryService,
	identifyTelemetryAccount,
} from "./utils/telemetry";
import type { Config } from "./utils/types";
import { runConnectWizard } from "./wizards/connect";
import { runMcpWizard } from "./wizards/mcp";
import { runScheduleWizard } from "./wizards/schedule";

export function stdinHasPipedInput(): boolean {
	if (process.stdin.isTTY) return false;
	try {
		const stats = fstatSync(0);
		return stats.isFIFO() || stats.isFile();
	} catch {
		return false;
	}
}

async function createProviderSettingsManager() {
	const { ProviderSettingsManager } = await import("@cline/core");
	return new ProviderSettingsManager();
}

async function loadCliRuntimeModules() {
	const [coreServer, prompt, runAgentModule] = await Promise.all([
		import("@cline/core"),
		import("./runtime/prompt"),
		import("./runtime/run-agent"),
	]);
	return {
		coreServer,
		resolveSystemPrompt: prompt.resolveSystemPrompt,
		runAgent: runAgentModule.runAgent,
	};
}

async function loadInteractiveRuntimeModule() {
	const { runInteractive } = await import("./runtime/run-interactive");
	return runInteractive;
}

/**
 * Two-pass approach for --config: a quick scan of process.argv extracts the
 * config directory before commander parses, because setClineDir() must run
 * before any code that reads the home/config directory.
 *
 * Recognizes both Commander spellings:
 *   --config <dir>
 *   --config=<dir>
 *
 * Exported for unit testing; callers in this file should use this rather
 * than reimplementing the scan.
 */
export function resolveConfigDirArg(argv: string[]): string | undefined {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--config") {
			const value = argv[i + 1]?.trim();
			return value ? value : undefined;
		}
		if (arg?.startsWith("--config=")) {
			const value = arg.slice("--config=".length).trim();
			return value ? value : undefined;
		}
	}
	return undefined;
}

function collectOption(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

// Shells strip quote characters before argv reaches us, so a prompt that was
// typed in quotes is only observable when it remains one argv token with spaces.
function promptArgLooksQuoted(arg: string | undefined): boolean {
	return !!arg && /\s/.test(arg);
}

function writePromptArgError(args: string[]): void {
	const renderedArgs = args.join(" ");
	writeErr(
		`未知命令或未加引号的提示词：${renderedArgs}\n提示词必须以单个带引号的参数传递，例如：cline "fix the tests"。使用 "cline --help" 查看可用命令和标志。`,
	);
}

function startupTargetTakesPrecedenceOverMigrationNotice(
	target: TuiStartupTarget | undefined,
): boolean {
	return target === "config" || target === "history";
}

export async function runCli(): Promise<void> {
	installStreamErrorGuards();
	autoUpdateOnStartup();

	const cliArgs = process.argv.slice(2);
	const isFullTTY =
		process.stdin.isTTY === true && process.stdout.isTTY === true;
	const configDir = resolveConfigDirArg(cliArgs);
	const { setClineDir, setHomeDir } = await import("@cline/shared/storage");
	if (configDir) {
		setClineDir(configDir);
	}
	setHomeDir(homedir());

	// Capture activation telemetry only after config/home directory selection
	// has been applied, so the telemetry singleton's persisted distinct-id
	// (and any other storage it touches) lands under the user-selected
	// `--config <dir>` rather than the default home/config location.
	captureCliExtensionActivated();

	const normalizedArgs = normalizeAutoApproveArgs(cliArgs);

	// Subcommand routing via Commander
	const ctx: {
		exitCode?: number;
		startupTarget?: TuiStartupTarget;
	} = {};
	const io = { writeln, writeErr };
	const program = createProgram();
	// Re-enable built-in help/version output for the routing program
	program.configureOutput({
		writeOut: (str: string) => process.stdout.write(str),
		writeErr: () => {},
	});
	// Default action handles non-subcommand args (e.g. prompt text)
	program.action(() => {});

	// Auth subcommand: defines its own options so commander parses them
	// directly. The short flags -p/-m intentionally shadow the root's -p (plan)
	// and -m (model); commander scopes options per-command so there is no
	// conflict.
	const authCmd = program
		.command("auth")
		.description("认证提供商并配置使用的模型")
		.argument("[provider]", "提供商 ID（-p 的位置简写）")
		.option("-p, --provider <id>", "提供商 ID")
		.option("-k, --apikey <key>", "API 密钥")
		.option("-m, --modelid <id>", "模型 ID")
		.option("-b, --baseurl <url>", "基础 URL")
		.option("--azure-api-version <version>", "Azure API 版本")
		.option("--config <dir>", "配置目录")
		.option("-c, --cwd <path>", "工作目录")
		.option(
			"--data-dir <dir>",
			"使用 <dir> 中的隔离本地状态，而不是 ~/.cline（启用沙盒模式）",
		)
		.option("-v, --verbose", "显示详细输出")
		.action(async (positionalProvider: string | undefined) => {
			const opts = authCmd.opts<{
				provider?: string;
				apikey?: string;
				modelid?: string;
				baseurl?: string;
				azureApiVersion?: string;
				config?: string;
				cwd?: string;
				dataDir?: string;
				verbose?: boolean;
			}>();
			// Honor --config inside the action as a defense-in-depth measure.
			// The early pre-pass in runCli() also calls setClineDir(), but only
			// for argv tokens it can spot before commander runs. Reapplying
			// here ensures opts.config (parsed by commander, including the
			// --config=<dir> form) is always respected before any provider
			// settings manager is constructed against ~/.cline.
			if (opts.config?.trim()) {
				const { setClineDir } = await import("@cline/shared/storage");
				setClineDir(opts.config.trim());
			}
			// Honor --data-dir before constructing the provider settings manager
			// so writes land under the chosen data dir instead of ~/.cline.
			configureSandboxEnvironment({
				enabled: !!opts.dataDir || process.env.CLINE_SANDBOX?.trim() === "1",
				cwd: opts.cwd ?? process.cwd(),
				explicitDir: opts.dataDir,
			});
			const { runAuthCommand } = await import("./commands/auth");
			const providerSettingsManager = await createProviderSettingsManager();
			ctx.exitCode = await runAuthCommand({
				providerSettingsManager,
				explicitProvider: opts.provider ?? positionalProvider,
				apikey: opts.apikey,
				modelid: opts.modelid,
				baseurl: opts.baseurl,
				azureApiVersion: opts.azureApiVersion,
				io,
			});
		});

	const createConfigRuntimeCommand = async () => {
		const { createConfigCommand } = await import("./commands/config");
		let configCmd: Command;
		configCmd = createConfigCommand(
			() => resolveWorkspaceRoot(program.opts().cwd ?? process.cwd()),
			() => {
				const outputMode =
					program.opts().json || configCmd.opts().json
						? ("json" as const)
						: ("text" as const);
				setCurrentOutputMode(outputMode);
				return outputMode;
			},
			io,
			(code) => {
				ctx.exitCode = code;
			},
			() => {
				ctx.startupTarget = "config";
			},
		);
		return configCmd;
	};

	program
		.command("config")
		.description("显示当前配置")
		.option("--json", "以 JSON 输出")
		.option("--config <dir>", "配置目录")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.action(async (_opts: unknown, cmd: Command) => {
			const realCmd = await createConfigRuntimeCommand();
			await realCmd.parseAsync(cmd.args, { from: "user" });
		});

	const pluginCmd = program
		.command("plugin")
		.description("管理 Cline 插件")
		.action(() => {
			pluginCmd.help();
		});
	const pluginInstallCmd = pluginCmd
		.command("install")
		.alias("i")
		.description(
			"从官方关键字、npm、git、URL 或本地路径安装 Cline 插件",
		)
		.argument(
			"<source>",
			"官方关键字、npm 包、git URL、插件文件 URL 或本地插件路径",
		)
		.option("--npm", "将源视为 npm 包")
		.option("--git", "将源视为 git 仓库")
		.option("--force", "替换同一源的现有安装")
		.option("--json", "以 JSON 输出")
		.option("--cwd <path>", "安装到 <path>/.cline/plugins")
		.action(async (source: string) => {
			const opts = pluginInstallCmd.opts<{
				npm?: boolean;
				git?: boolean;
				force?: boolean;
				json?: boolean;
				cwd?: string;
			}>();
			const sourceTypes = [
				opts.npm ? ("npm" as const) : undefined,
				opts.git ? ("git" as const) : undefined,
			].filter((sourceType) => sourceType !== undefined);
			if (sourceTypes.length > 1) {
				writeErr("plugin install 仅接受一个源类型标志");
				ctx.exitCode = 1;
				return;
			}
			const { runPluginInstallCommand } = await import("./commands/plugin");
			ctx.exitCode = await runPluginInstallCommand({
				source,
				sourceType: sourceTypes[0],
				cwd: opts.cwd,
				force: opts.force === true,
				json: opts.json === true || program.opts().json === true,
				io,
			});
		});
	const pluginUninstallCmd = pluginCmd
		.command("uninstall")
		.alias("remove")
		.alias("rm")
		.description("按名称或路径卸载 Cline 插件")
		.argument("<name>", "插件包名称、已安装的 slug 或插件路径")
		.option("--json", "以 JSON 输出")
		.option(
			"--cwd <path>",
			"先搜索 <path>/.cline/plugins，再搜索全局插件",
		)
		.action(async (name: string) => {
			const opts = pluginUninstallCmd.opts<{
				json?: boolean;
				cwd?: string;
			}>();
			const { runPluginUninstallCommand } = await import("./commands/plugin");
			ctx.exitCode = await runPluginUninstallCommand({
				name,
				cwd: opts.cwd,
				json: opts.json === true || program.opts().json === true,
				io,
			});
		});
	const skillCmd = program
		.command("skill")
		.description("通过开放的 skills CLI（npx skills）管理 Cline Skills")
		.allowUnknownOption()
		.passThroughOptions()
		.argument("[args...]", "转发给 skills CLI 的参数")
		.addHelpText(
			"after",
			"\n通过 npx 转发到开放的 skills CLI。示例：\n" +
				"  cline skill add <owner/repo>       将技能添加到 Cline\n" +
				"  cline skill install <owner/repo>   add 的别名\n" +
				"  cline skill list                   列出已安装的技能\n" +
				"  cline skill remove                 移除已安装的技能\n" +
				"  cline skill uninstall               remove 的别名\n" +
				"\n除非你传入自己的 --agent，add/install 和 remove/uninstall 默认使用 '--agent cline'。\n" +
				"运行 'npx skills --help' 获取完整的命令参考。",
		)
		.action(async () => {
			const { runSkillCommand } = await import("./commands/skill");
			ctx.exitCode = await runSkillCommand(skillCmd.args, io);
		});

	const connectCmd = program
		.command("connect")
		.description("连接到外部频道")
		.argument("[channel]", "用于连接 Cline CLI 的频道")
		.option("--stop", "终止所有当前的频道连接")
		.option("--restart", "重启频道连接")
		.option(
			"--restart-instance <id>",
			"重启一个连接器实例（用于守护进程恢复）",
		)
		.option(
			"--cleanup-instance <id>",
			"回收一个已停止的连接器实例，保留自动启动（用于 hub 监管）",
		)
		.allowUnknownOption()
		.passThroughOptions()
		.addHelpText(
			"after",
			"\n运行 'connect <channel> --help' 查看频道特定的选项。",
		)
		.action(async (adapter: string | undefined) => {
			const {
				formatAdapterList,
				runCleanupConnectorInstance,
				runConnectAdapter,
				runRestartConnector,
				runStopAllConnectors,
				runStopConnector,
			} = await import("./commands/connect");
			const opts = connectCmd.opts();
			const exclusiveModes = [
				opts.stop,
				opts.restart || opts.restartInstance,
				opts.cleanupInstance,
			].filter(Boolean).length;
			if (exclusiveModes > 1) {
				io.writeErr(
					"connect 仅接受 --stop、--restart 或 --cleanup-instance 中的一个",
				);
				ctx.exitCode = 1;
			} else if (opts.cleanupInstance) {
				if (!adapter) {
					io.writeErr("connect --cleanup-instance 需要指定频道");
					ctx.exitCode = 1;
				} else {
					ctx.exitCode = await runCleanupConnectorInstance(
						adapter,
						opts.cleanupInstance,
						io,
					);
				}
			} else if (opts.stop) {
				if (adapter) {
					ctx.exitCode = await runStopConnector(adapter, io);
				} else {
					ctx.exitCode = await runStopAllConnectors(io);
				}
			} else if (opts.restart || opts.restartInstance) {
				if (!adapter) {
					io.writeErr("connect --restart 需要指定频道");
					ctx.exitCode = 1;
				} else {
					ctx.exitCode = await runRestartConnector(
						adapter,
						connectCmd.args.slice(1),
						io,
						opts.restartInstance,
					);
				}
			} else if (adapter) {
				// connectCmd.args = [adapter, ...passthroughFlags]. Pass only the
				// connector-specific flags (everything after the adapter name).
				ctx.exitCode = await runConnectAdapter(
					adapter,
					connectCmd.args.slice(1),
					io,
				);
			} else if (isFullTTY) {
				ctx.exitCode = await runConnectWizard();
			} else {
				writeln(`\n适配器：\n${formatAdapterList()}`);
				connectCmd.help();
			}
		});

	const mcpCmd = program
		.command("mcp")
		.description("管理 MCP 服务器")
		.action(async () => {
			if (isFullTTY) {
				ctx.exitCode = await runMcpWizard();
			} else {
				writeln(
					"MCP 向导需要 TTY。使用 cline config mcp 列出服务器。",
				);
			}
		});
	const mcpInstallCmd = mcpCmd
		.command("install")
		.alias("add")
		.description("打开 MCP 添加向导，并预填服务器字段")
		.argument("<name>", "MCP 服务器名称")
		.argument(
			"[targetArgs...]",
			"远程传输的 URL，或 -- 之后的命令和参数用于 stdio",
		)
		.option(
			"--transport <transport>",
			"stdio、sse、http、streamable-http 或 streamableHttp（默认：stdio）",
		)
		.option("--header <header>", "远程 MCP 请求头", collectOption, [])
		.option("--yes", "非交互式安装，不打开向导")
		.option("--json", "以 JSON 输出")
		.action(async (name: string, targetArgs: string[]) => {
			const opts = mcpInstallCmd.opts<{
				header?: string[];
				json?: boolean;
				transport?: string;
				yes?: boolean;
			}>();
			const { runMcpInstallCommand } = await import("./commands/mcp");
			ctx.exitCode = await runMcpInstallCommand({
				name,
				headers: opts.header,
				targetArgs,
				transport: opts.transport,
				json: opts.json === true || program.opts().json === true,
				yes: opts.yes === true,
				io,
			});
		});
	const mcpUninstallCmd = mcpCmd
		.command("uninstall")
		.alias("remove")
		.alias("rm")
		.description("Uninstall an MCP server by name")
		.argument("<name>", "MCP server name")
		.option("--json", "Output as JSON")
		.action(async (name: string) => {
			const opts = mcpUninstallCmd.opts<{
				json?: boolean;
			}>();
			const { runMcpUninstallCommand } = await import("./commands/mcp");
			ctx.exitCode = await runMcpUninstallCommand({
				name,
				json: opts.json === true || program.opts().json === true,
				io,
			});
		});

	const createDoctorRuntimeCommand = async () => {
		const { createDoctorCommand } = await import("./commands/doctor");
		return createDoctorCommand(io, (code) => {
			ctx.exitCode = code;
		});
	};

	program
		.command("doctor")
		.description("诊断并修复配置问题")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.addHelpText(
			"after",
			"\n命令：\n  fix  终止所有正在运行的进程\n  log  打开 CLI 日志文件\n",
		)
		.action(async (_opts: unknown, cmd: Command) => {
			const doctorCmd = await createDoctorRuntimeCommand();
			await doctorCmd.parseAsync(cmd.args, { from: "user" });
		});

	registerHistoryCommand({
		program,
		io,
		setExitCode: (code) => {
			ctx.exitCode = code;
		},
		setStartupTarget: (target) => {
			ctx.startupTarget = target;
		},
		isInteractiveTTY: () => isFullTTY,
	});

	program
		.command("hook")
		.description("处理来自 stdin 的 hook 负载")
		.allowUnknownOption()
		.allowExcessArguments()
		.action(async () => {
			const { runHookCommand } = await import("./commands/hook");
			ctx.exitCode = await runHookCommand(io);
		});

	const createScheduleRuntimeCommand = async () => {
		const { createScheduleCommand } = await import("./commands/schedule");
		return createScheduleCommand(io, (code) => {
			ctx.exitCode = code;
		});
	};
	const createHubRuntimeCommand = async () => {
		const { createHubCommand } = await import("./commands/hub");
		return createHubCommand(io, (code) => {
			ctx.exitCode = code;
		});
	};

	program
		.command("schedule")
		.description("管理计划任务")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.action(async (_opts: unknown, cmd: Command) => {
			if (cmd.args.length === 0 && isFullTTY) {
				ctx.exitCode = await runScheduleWizard();
				return;
			}
			const scheduleCmd = await createScheduleRuntimeCommand();
			await scheduleCmd.parseAsync(cmd.args, { from: "user" });
		});
	program
		.command("hub")
		.description("管理本地 hub 守护进程")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.action(async (_opts: unknown, cmd: Command) => {
			const hubCmd = await createHubRuntimeCommand();
			await hubCmd.parseAsync(cmd.args, { from: "user" });
		});

	const dashboardCmd = program
		.command("dashboard")
		.description("启动 Cline Hub 仪表板并在浏览器中打开")
		.option("--config <dir>", "配置目录")
		.option("-c, --cwd <path>", "工作区根目录", process.cwd())
		.option(
			"--data-dir <dir>",
			"使用 <dir> 中的隔离本地状态，而不是 ~/.cline（启用沙盒模式）",
		)
		.option("--host <host>", "仪表板绑定主机")
		.option("--port <port>", "仪表板 HTTP/WebSocket 端口")
		.option("--public-url <url>", "公共仪表板 URL")
		.option("--room-secret <secret>", "浏览器访问的邀请密钥")
		.option("--no-open", "启动仪表板但不打开浏览器")
		.action(async () => {
			const opts = dashboardCmd.opts<{
				config?: string;
				cwd?: string;
				dataDir?: string;
				host?: string;
				port?: string;
				publicUrl?: string;
				roomSecret?: string;
				open?: boolean;
			}>();
			const { runDashboardCommand } = await import("./commands/dashboard");
			ctx.exitCode = await runDashboardCommand({
				configDir: opts.config,
				cwd: opts.cwd,
				dataDir: opts.dataDir,
				host: opts.host,
				port: opts.port,
				publicUrl: opts.publicUrl,
				roomSecret: opts.roomSecret,
				openBrowser: opts.open !== false,
				io,
			});
		});

	const updateCmd = program
		.command("update")
		.description("检查更新并在可用时安装")
		.allowUnknownOption()
		.allowExcessArguments()
		.option("-v, --verbose", "显示详细输出")
		.option("--config <dir>", "配置目录")
		.action(async () => {
			const { checkForUpdates } = await import("./commands/update");
			ctx.exitCode = await checkForUpdates({
				verbose: updateCmd.opts().verbose === true,
			});
		});

	program
		.command("version")
		.description("显示 Cline CLI 版本号")
		.action(async () => {
			const { showVersion } = await import("./commands/help");
			showVersion();
			ctx.exitCode = 0;
		});

	program
		.command("kanban")
		.description("运行看板应用")
		.action(async () => {
			const { launchKanban } = await import("./commands/kanban");
			ctx.exitCode = await launchKanban({
				preferredInstaller: getPreferredKanbanInstaller(),
			});
		});

	try {
		await program.parseAsync(normalizedArgs, { from: "user" });
	} catch (err: unknown) {
		if (err instanceof CommanderError) {
			if (err.exitCode !== 0) {
				writeErr(err.message);
				process.exitCode = err.exitCode;
				return;
			}
			return;
		}
		throw err;
	}

	if (ctx.exitCode !== undefined) {
		process.exitCode = ctx.exitCode;
		return;
	}

	const rootOpts = program.opts<{
		kanban?: boolean;
		tui?: boolean;
		update?: boolean;
		verbose?: boolean;
	}>();
	if (rootOpts.update) {
		if (rootOpts.kanban || rootOpts.tui || program.args.length > 0) {
			writeErr("使用 --update 时不要包含提示词或任务标志。");
			process.exitCode = 1;
			return;
		}
		const { checkForUpdates } = await import("./commands/update");
		process.exitCode = await checkForUpdates({
			verbose: rootOpts.verbose === true,
		});
		return;
	}
	if (rootOpts.kanban) {
		if (rootOpts.tui) {
			writeErr("只能使用 --kanban 或 --tui 之一，不能同时使用。");
			process.exitCode = 1;
			return;
		}
		if (program.args.length > 0) {
			writeErr("使用 --kanban 时不要包含提示词。");
			process.exitCode = 1;
			return;
		}
		const { launchKanban } = await import("./commands/kanban");
		process.exitCode = await launchKanban({
			preferredInstaller: getPreferredKanbanInstaller(),
		});
		return;
	}

	// Default flow: no subcommand matched, or fall-through from config/history.
	let args = commanderToParsedArgs(program);

	let startupTarget = ctx.startupTarget;
	let resumeSessionId: string | undefined;
	if (args.id !== undefined) {
		const sessionId = args.id.trim();
		if (!sessionId) {
			writeErr("--id 需要 <session-id>");
			process.exitCode = 1;
			return;
		}
		resumeSessionId = sessionId;
		startupTarget = "chat";
		process.env.CLINE_HOOK_AGENT_RESUME = "1";
	} else {
		delete process.env.CLINE_HOOK_AGENT_RESUME;
	}
	if (startupTarget) {
		args = {
			...args,
			interactive: true,
			prompt: undefined,
		};
	}

	if (args.invalidThinkingLevel) {
		writeErr(
			`无效的思考级别 "${args.invalidThinkingLevel}"（期望 "none"、"low"、"medium"、"high" 或 "xhigh"）`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidCompactionMode) {
		writeErr(
			`无效的压缩模式 "${args.invalidCompactionMode}"（期望 ${CLI_COMPACTION_MODE_EXPECTED_TEXT}）`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidAutoApprove) {
		writeErr(
			`无效的自动批准值 "${args.invalidAutoApprove}"（期望 "true" 或 "false"）`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidTimeoutSeconds) {
		writeErr(
			`无效的超时时间 "${args.invalidTimeoutSeconds}"（期望整数 >= 1）`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidRetries) {
		writeln(
			`${c.dim}[警告] 忽略无效的 --retries 值 "${args.invalidRetries}"（期望整数 >= 1）${c.reset}`,
		);
	}
	if (args.hooksDir?.trim()) {
		process.env.CLINE_HOOKS_DIR = args.hooksDir.trim();
	}
	if (args.prompt && !args.interactive) {
		if (program.args.length > 1 || !promptArgLooksQuoted(program.args[0])) {
			writePromptArgError(program.args);
			process.exitCode = 1;
			return;
		}
	}
	setCurrentOutputMode(args.outputMode);

	if (args.outputMode === "json" && (args.interactive || !args.prompt)) {
		writeErr(
			"JSON 输出模式需要提示词参数或管道 stdin（不支持交互模式）",
		);
		process.exitCode = 1;
		return;
	}

	// ACP mode: mutually exclusive with interactive/piped modes.
	// Enters the Agent Client Protocol stdio transport and never falls through.
	if (args.acpMode) {
		const { runAcpMode } = await import("./acp/index");
		// Only an explicit `--auto-approve true` (or `--yolo`) enables
		// auto-approval in ACP mode; We do not respect the default to
		// avoid accidental auto-approval in ACP mode.
		await runAcpMode({ autoApproveTools: args.autoApproveOverride === true });
		return;
	}

	if (args.worktree) {
		if (
			!args.prompt &&
			!resumeSessionId &&
			!stdinHasPipedInput() &&
			!isFullTTY
		) {
			writeErr("--worktree 不带提示词时需要交互式终端。");
			process.exitCode = 1;
			return;
		}
		if (resumeSessionId) {
			const { getSessionRow } = await import("./session/session");
			const session = await getSessionRow(resumeSessionId);
			if (!session) {
				writeErr(`找不到会话：${resumeSessionId}`);
				process.exitCode = 1;
				return;
			}
		}
		const { createTaskWorktree } = await import("./utils/worktree");
		const sourceCwd = args.cwd ?? process.cwd();
		const result = await createTaskWorktree({ cwd: sourceCwd });
		if (!result.success || !result.path) {
			writeErr(`--worktree 失败：${result.message}`);
			process.exitCode = 1;
			return;
		}
		writeln(`已在 ${result.path} 创建 worktree`);
		args = {
			...args,
			cwd: result.path,
		};
	}

	const cwd = args.cwd ?? process.cwd();
	const workspaceRoot = resolveWorkspaceRoot(cwd);
	// Sandbox mode is enabled implicitly whenever --data-dir is provided, or
	// when CLINE_SANDBOX=1 is set in the environment (in which case the data
	// dir falls back to $CLINE_SANDBOX_DATA_DIR or /tmp/cline-sandbox).
	const sandboxEnabled =
		!!args.dataDir || process.env.CLINE_SANDBOX?.trim() === "1";
	const sandboxDataDir = configureSandboxEnvironment({
		enabled: sandboxEnabled,
		cwd,
		explicitDir: args.dataDir,
	});

	// Keep command-style subcommands on a narrow path. Runtime-only imports pull
	// in provider resolution, config services, and session startup wiring that
	// should only load when the CLI is actually starting an agent session.
	const providerSettingsManager = await createProviderSettingsManager();
	const {
		coreServer,
		coreServer: { createUserInstructionConfigService },
		resolveSystemPrompt,
		runAgent,
	} = await loadCliRuntimeModules();

	// General settings toggled in the TUI /settings panel persist to the
	// global settings file; explicit CLI flags take precedence over the
	// persisted values, which in turn override the built-in defaults.
	const persistedGlobalSettings = coreServer.readGlobalSettings();
	const defaultToolAutoApprove = true;
	const effectiveToolAutoApprove = resolveStartupToolAutoApprove(
		args,
		persistedGlobalSettings,
		defaultToolAutoApprove,
	);
	const toolPolicies: Record<string, ToolPolicy> = {
		"*": {
			autoApprove: effectiveToolAutoApprove,
		},
	};
	const effectiveMode = resolveStartupMode(args, persistedGlobalSettings);
	const effectiveCompactionMode = resolveStartupCompactionMode(
		args,
		persistedGlobalSettings,
	);

	// Register the SDK early logger as early as possible — before any
	// provider settings reads — so the full startup sequence is captured.
	// These components operate before/outside ClineCore sessions, so the
	// session-scoped logger can't reach them.
	const { createCliLoggerAdapter } = await import("./logging/adapter");
	const loggerAdapter = createCliLoggerAdapter({
		runtime: "cli",
		component: "main",
	});
	coreServer.setSdkLogger(loggerAdapter.core);

	const userInstructionService = createUserInstructionConfigService({
		skills: {
			workspacePath: workspaceRoot,
			includePluginSkills: true,
			cwd,
		},
		rules: { workspacePath: workspaceRoot },
		workflows: { workspacePath: workspaceRoot },
	});
	await userInstructionService.start().catch(() => {});
	let userInstructionServiceDisposed = false;
	const stopUserInstructionService = () => {
		if (userInstructionServiceDisposed) {
			return;
		}
		userInstructionServiceDisposed = true;
		userInstructionService.stop();
	};
	registerDisposable(stopUserInstructionService);
	try {
		const persistedClineAccountId = providerSettingsManager
			.getProviderSettings("cline")
			?.auth?.accountId?.trim();
		if (persistedClineAccountId) {
			setCliFeatureFlagsAccountContext({ id: persistedClineAccountId });
		}
		refreshCliFeatureFlagsInBackground();
		const lastUsedProviderSettings =
			providerSettingsManager.getLastUsedProviderSettings({
				isClinePassEnabled: true,
			});
		const provider = normalizeProviderId(
			args.provider?.trim() || lastUsedProviderSettings?.provider || "cline",
		);
		let selectedProviderSettings =
			providerSettingsManager.getProviderSettings(provider);

		// Apply locally persisted Cline account identity so subsequent events
		// (task.*, workspace.initialized) carry user_id when available.
		// Note: user.extension_activated fires anonymously earlier in startup
		// and cannot be retroactively updated; this is by design for
		// lightweight subcommand and pre-auth CLI flows. See CLINE-2406.
		if (provider === "cline") {
			const savedAuth = selectedProviderSettings?.auth;
			if (savedAuth?.accountId) {
				identifyTelemetryAccount({
					id: savedAuth.accountId,
					provider: "cline",
					organizationId: savedAuth.organizationId,
					organizationName: savedAuth.organizationName,
					memberId: savedAuth.memberId,
				});
			}
		}

		const persistedApiKey = getPersistedProviderApiKey(
			provider,
			selectedProviderSettings,
		);
		const providedApiKey = args.key?.trim() || undefined;
		let apiKey = providedApiKey || persistedApiKey || undefined;

		const isYoloMode = args.mode === "yolo";
		const isZenMode = args.mode === "zen";

		// In headless mode (yolo / json / piped stdin without --tui),
		// don't attempt browser-based OAuth. Authentication may still resolve at
		// runtime from environment-based provider auth or persisted OAuth tokens.
		const isHeadless =
			isYoloMode ||
			isZenMode ||
			args.outputMode === "json" ||
			(!process.stdin.isTTY && !args.interactive);
		const isInteractive = (args.interactive || !args.prompt) && !isHeadless;

		if (!apiKey && isOAuthProvider(provider) && !isHeadless && !isInteractive) {
			const oauthResult = await ensureOAuthProviderApiKey({
				providerId: provider,
				currentApiKey: apiKey,
				existingSettings: selectedProviderSettings,
				providerSettingsManager,
				io: { writeln, writeErr },
			});
			selectedProviderSettings =
				oauthResult?.selectedProviderSettings ?? selectedProviderSettings;
			apiKey = oauthResult?.apiKey ?? apiKey;
		}

		let knownModels: Config["knownModels"];
		try {
			const persistedProviderConfig = providerSettingsManager.getProviderConfig(
				provider,
				{
					includeKnownModels: false,
				},
			);
			const catalogOptions = isInteractive
				? {
						loadLatestOnInit: true,
						loadPrivateOnAuth: true,
						failOnError: false,
					}
				: undefined;
			const resolvedProviderConfig = await coreServer.resolveProviderConfig(
				provider,
				catalogOptions,
				persistedProviderConfig,
			);
			knownModels = resolvedProviderConfig?.knownModels;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			writeln(
				`${c.dim}[模型目录] 目录解析失败（${message}）${c.reset}`,
			);
		}
		const knownModelIds = knownModels ? Object.keys(knownModels) : [];
		const resolvedReasoning = resolveCliReasoning({
			thinking: args.thinking,
			thinkingExplicitlySet: args.thinkingExplicitlySet,
			reasoningEffort: args.reasoningEffort,
			persistedReasoning: selectedProviderSettings?.reasoning,
		});
		const cliBuildInfo = getCliBuildInfo();
		const { createCliLoggerAdapter } = await import("./logging/adapter");
		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "main",
		});
		loggerAdapter.core.log("CLI run started", {
			interactive: args.interactive === true,
			hasPrompt: !!args.prompt?.trim(),
			cwd,
		});

		const config: Config = {
			providerId: provider,
			modelId:
				args.model ??
				selectedProviderSettings?.model ??
				knownModelIds[0] ??
				"anthropic/claude-sonnet-4.6",
			apiKey: apiKey ?? "",
			knownModels,
			systemPrompt: await resolveSystemPrompt({
				cwd,
				explicitSystemPrompt: args.systemPrompt,
				providerId: provider,
				mode: effectiveMode,
			}),
			execution: {
				maxConsecutiveMistakes: args.retries ?? 3,
			},
			checkpoint: CLI_DEFAULT_CHECKPOINT_CONFIG,
			compaction: buildCliCompactionConfig(effectiveCompactionMode),
			timeoutSeconds: args.timeoutSeconds,
			sandbox: sandboxEnabled,
			sandboxDataDir,
			verbose: args.verbose,
			thinking: resolvedReasoning.thinking,
			reasoningEffort: resolvedReasoning.reasoningEffort,
			outputMode: args.outputMode,
			mode: effectiveMode,
			logger: loggerAdapter.core,
			loggerConfig: loggerAdapter.runtimeConfig,
			telemetry: getCliTelemetryService(loggerAdapter.core),
			defaultToolAutoApprove,
			toolPolicies,
			enableSpawnAgent: !isYoloMode,
			enableAgentTeams: !isYoloMode,
			enableTools: true,
			cwd,
			workspaceRoot,
			extensionContext: {
				client: {
					name: "cline-cli",
					version: cliBuildInfo.version,
					platform: "cli",
					platformVersion: cliBuildInfo.version,
					isMultiRoot: false,
				},
				workspace: {
					rootPath: workspaceRoot,
					cwd,
					workspaceName: basename(cwd),
					ide: "Terminal Shell",
					platform: process.platform,
				},
				logger: loggerAdapter.core,
			},
			teamName: !isYoloMode ? args.teamName?.trim() || undefined : undefined,
		};
		try {
			// For OAuth providers, don't write the resolved key into apiKey;
			// the token lives in auth.accessToken and apiKey is reserved for
			// migrated/manual keys.
			const persistApiKey =
				// Persist explicit `-k/--key` even for OAuth-capable providers.
				providedApiKey
					? { apiKey: providedApiKey }
					: apiKey && !isOAuthProvider(provider)
						? { apiKey }
						: {};
			providerSettingsManager.saveProviderSettings({
				...(selectedProviderSettings ?? {}),
				provider,
				model: config.modelId,
				...persistApiKey,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			writeln(
				`${c.dim}[提供商设置] 保存选择失败（${message}）${c.reset}`,
			);
		}
		// Check for piped input (skip when stdin is not a real pipe/file, e.g. headless CI).
		// Guard `isTTY` first so we never block on fd 0 when stdin is a terminal (and avoid
		// redundant fstat work). `stdinHasPipedInput` also checks `isTTY`, but callers may hit
		// inconsistent state in tests or embedded hosts.
		if (!process.stdin.isTTY && stdinHasPipedInput() && !args.interactive) {
			const chunks: Buffer[] = [];
			for await (const chunk of process.stdin) {
				chunks.push(chunk as Buffer);
			}
			const pipedInput = Buffer.concat(chunks).toString("utf-8").trim();

			if (pipedInput) {
				const prompt = args.prompt
					? `${args.prompt}\n\n${pipedInput}`
					: pipedInput;
				const rewrittenTeamPrompt = rewriteTeamPrompt(prompt);
				if (rewrittenTeamPrompt.kind === "usage") {
					writeln(TEAM_COMMAND_USAGE);
					return;
				}
				const pipedEffectivePrompt =
					rewrittenTeamPrompt.kind === "rewritten"
						? rewrittenTeamPrompt.prompt
						: prompt;
				if (isZenMode) {
					const { runZen } = await import("./runtime/run-zen");
					await runZen(pipedEffectivePrompt, config, userInstructionService);
					return;
				}
				await runAgent(pipedEffectivePrompt, config, userInstructionService);
				return;
			}
		}

		// Interactive mode: zen is incompatible because there is no terminal UI
		// to surface results and nothing waits for the background task.
		if (args.interactive || !args.prompt) {
			if (isZenMode) {
				writeErr(
					args.interactive
						? "--zen 不兼容交互模式。"
						: "--zen 需要提示词。",
				);
				process.exitCode = 1;
				return;
			}
			const runInteractive = await loadInteractiveRuntimeModule();
			const initialClineProviderSettings =
				provider === "cline" ? selectedProviderSettings : undefined;
			let initialNotice:
				| import("./kanban-migration/notice").CliMigrationNotice
				| undefined;
			let markInitialNoticeShown:
				| ((
						notice: import("./kanban-migration/notice").CliMigrationNotice,
				  ) => void)
				| undefined;
			if (
				!startupTargetTakesPrecedenceOverMigrationNotice(startupTarget) &&
				isFullTTY
			) {
				const { getClineCliMigrationNotice, markClineCliMigrationNoticeShown } =
					await import("./kanban-migration/notice");
				initialNotice = getClineCliMigrationNotice(undefined, process.env, {
					activeProviderId: provider,
				});
				if (initialNotice) {
					markInitialNoticeShown = () => {
						markClineCliMigrationNoticeShown();
					};
				}
			}
			await runInteractive(config, userInstructionService, resumeSessionId, {
				initialPrompt: args.prompt,
				clineApiBaseUrl: initialClineProviderSettings?.baseUrl,
				clineProviderSettings: initialClineProviderSettings,
				startupTarget,
				initialNotice,
				onInitialNoticeShown: markInitialNoticeShown,
			});
			return;
		}

		// Single prompt mode
		const rewrittenTeamPrompt = rewriteTeamPrompt(args.prompt);
		if (rewrittenTeamPrompt.kind === "usage") {
			writeln(TEAM_COMMAND_USAGE);
			return;
		}
		const effectivePrompt =
			rewrittenTeamPrompt.kind === "rewritten"
				? rewrittenTeamPrompt.prompt
				: args.prompt;

		// Zen mode: dispatch the task to the background hub and exit. The CLI
		// does not stay connected to stream output; completion is delivered via
		// the hub's existing ui.notify broadcast (picked up by the menubar app
		// when installed).
		if (isZenMode) {
			const { runZen } = await import("./runtime/run-zen");
			await runZen(effectivePrompt, config, userInstructionService);
			return;
		}

		await runAgent(effectivePrompt, config, userInstructionService);
		// Exit once agent is done in non-interactive mode
		return;
	} finally {
		stopUserInstructionService();
	}
}
