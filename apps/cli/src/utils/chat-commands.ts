import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveWorkspaceRoot } from "./helpers";

export type ChatCommandState = {
	enableTools: boolean;
	autoApproveTools: boolean;
	cwd: string;
	workspaceRoot: string;
	toolsLocked?: boolean;
	threadMuted?: boolean;
};

export type ForkSessionResult = {
	forkedFromSessionId: string;
	newSessionId: string;
	/**
	 * Present when the source session had valid compaction state that was
	 * re-anchored onto the forked session, so the UI can surface why the
	 * next request is smaller than the canonical history.
	 */
	carriedWorkingContext?: {
		workingContextMessages: number;
		canonicalMessages: number;
	};
};

export type MuteCommandInput = {
	target?: string;
};

export type ChatCommandContext = {
	enabled: boolean;
	botUserName?: string;
	requireBotMention?: boolean;
	host?: ChatCommandHost;
	getState: () => Promise<ChatCommandState> | ChatCommandState;
	setState: (next: ChatCommandState) => Promise<void> | void;
	reply: (text: string) => Promise<void> | void;
	submitPrompt?: (prompt: string) => Promise<void> | void;
	reset?: () => Promise<void> | void;
	abort?: () => Promise<void> | void;
	stop?: () => Promise<void> | void;
	mute?: (
		input: MuteCommandInput,
	) => Promise<string | undefined> | string | undefined;
	unmute?: (
		input: MuteCommandInput,
	) => Promise<string | undefined> | string | undefined;
	describe?: () => Promise<string> | string;
	fork?: () =>
		| Promise<ForkSessionResult | undefined>
		| ForkSessionResult
		| undefined;
	schedule?: {
		create?: (input: {
			name: string;
			cronPattern: string;
			prompt: string;
		}) => Promise<string> | string;
		list?: () => Promise<string> | string;
		delete?: (scheduleId: string) => Promise<string> | string;
		trigger?: (scheduleId: string) => Promise<string> | string;
	};
};

type ParsedChatCommand = {
	input: string;
	trimmed: string;
	command: string;
	args: string[];
	state: ChatCommandState;
};

export type ChatCommandDefinition = {
	names: string[];
	isAvailable?: (context: ChatCommandContext) => boolean;
	run: (
		parsed: ParsedChatCommand,
		context: ChatCommandContext,
	) => Promise<void> | void;
};

export class ChatCommandHost {
	private readonly definitions: ChatCommandDefinition[];

	constructor(definitions: ChatCommandDefinition[] = []) {
		this.definitions = [...definitions];
	}

	register(
		_kind: "command",
		definition: ChatCommandDefinition,
	): ChatCommandHost {
		this.definitions.push(definition);
		return this;
	}

	getDefinitions(): readonly ChatCommandDefinition[] {
		return this.definitions;
	}

	clone(): ChatCommandHost {
		return new ChatCommandHost(this.definitions);
	}

	async handle(input: string, context: ChatCommandContext): Promise<boolean> {
		if (!context.enabled) {
			return false;
		}

		const trimmed = input.trim();
		if (!trimmed.startsWith("/")) {
			return false;
		}

		const [commandRaw, ...args] = trimmed.split(/\s+/);
		if (
			context.requireBotMention &&
			!isCommandAddressedToBot(commandRaw, context.botUserName)
		) {
			return false;
		}
		const command = normalizeCommandName(
			commandRaw.toLowerCase(),
			context.botUserName,
		);
		const parsed: ParsedChatCommand = {
			input,
			trimmed,
			command,
			args,
			state: await context.getState(),
		};
		const matched = this.definitions.find((definition) =>
			definition.names.includes(parsed.command),
		);
		if (!matched) {
			return false;
		}
		if (matched.isAvailable && !matched.isAvailable(context)) {
			return false;
		}
		await matched.run(parsed, context);
		return true;
	}
}

export function normalizeCommandName(
	command: string,
	botUserName?: string,
): string {
	const botMention = command.match(/^(\/[^@\s]+)@[a-z0-9_.-]+$/i);
	if (!botMention) {
		return command;
	}
	const expectedBotName = botUserName?.replace(/^@+/, "").trim().toLowerCase();
	if (!expectedBotName) {
		return command;
	}
	const suffix = command.slice(botMention[1].length + 1).toLowerCase();
	return suffix === expectedBotName ? botMention[1] : command;
}

export function isCommandAddressedToBot(
	command: string,
	botUserName?: string,
): boolean {
	const expectedBotName = botUserName?.replace(/^@+/, "").trim().toLowerCase();
	if (!expectedBotName) {
		return false;
	}
	const match = command.match(/^\/[^@\s]+@([a-z0-9_.-]+)$/i);
	return match?.[1]?.toLowerCase() === expectedBotName;
}

function tokenizeArgs(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let escaping = false;
	for (const char of input) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else {
				current += char;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (current) {
		tokens.push(current);
	}
	return tokens;
}

function parseFlagValues(tokens: string[]): {
	positionals: string[];
	flags: Record<string, string>;
} {
	const positionals: string[] = [];
	const flags: Record<string, string> = {};
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token.startsWith("--")) {
			positionals.push(token);
			continue;
		}
		const key = token.slice(2).trim().toLowerCase();
		const value = tokens[index + 1];
		if (!key || !value || value.startsWith("--")) {
			flags[key] = "";
			continue;
		}
		flags[key] = value;
		index += 1;
	}
	return { positionals, flags };
}

function scheduleUsage(): string {
	return [
		"用法:",
		'/schedule create "<name>" --cron "<pattern>" --prompt "<text>"',
		"/schedule list",
		"/schedule trigger <schedule-id>",
		"/schedule delete <schedule-id>",
	].join("\n");
}

function parseBooleanValue(
	value: string | undefined,
	current: boolean,
): boolean | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}
	if (normalized === "on" || normalized === "true" || normalized === "1") {
		return true;
	}
	if (normalized === "off" || normalized === "false" || normalized === "0") {
		return false;
	}
	if (normalized === "toggle") {
		return !current;
	}
	return undefined;
}

function usage(text: string): string {
	return `用法: ${text}`;
}

function formatHelp(state: ChatCommandState): string {
	return [
		"Cline 连接器命令:",
		"/help 或 /start - 显示此帮助",
		"/new 或 /clear - 开始新会话",
		"/whereami - 显示线程、cwd、工具和 yolo 状态",
		"/tools [on|off|toggle] - 允许仓库/文件/shell 工具",
		"/yolo [on|off|toggle] - 自动批准工具使用",
		"/cwd <path> - 更改工作目录",
		"/schedule create/list/trigger/delete - 管理定时工作流",
		"/abort - 停止当前任务",
		"/mute [target] - 忽略此线程或目标，直到 /unmute",
		"/unmute [target] - 恢复处理此线程或目标",
		"/exit - 停止此连接器",
		"",
		`当前状态: tools=${state.enableTools ? "on" : "off"}, yolo=${state.autoApproveTools ? "on" : "off"}, muted=${state.threadMuted ? "true" : "false"}`,
		state.toolsLocked
			? "工具控制已被锁定，因为此连接器以 --no-tools 启动。"
			: undefined,
		"发送普通文本以提问或分配任务。",
		"当工具开启时，我可以检查文件、编辑代码、运行命令/测试，并帮助准备 PR。",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

export function createChatCommandHost(): ChatCommandHost {
	return new ChatCommandHost();
}

function createDefaultChatCommandHost(): ChatCommandHost {
	return createChatCommandHost()
		.register("command", {
			names: ["/help", "/start"],
			run: async ({ state }, context) => {
				await context.reply(formatHelp(state));
			},
		})
		.register("command", {
			names: ["/clear", "/new"],
			isAvailable: (context) => typeof context.reset === "function",
			run: async (_parsed, context) => {
				await context.reset?.();
				await context.reply("已开始新会话。");
			},
		})
		.register("command", {
			names: ["/abort"],
			isAvailable: (context) => typeof context.abort === "function",
			run: async (_parsed, context) => {
				await context.abort?.();
			},
		})
		.register("command", {
			names: ["/mute"],
			isAvailable: (context) => typeof context.mute === "function",
			run: async ({ args }, context) => {
				const target = args.join(" ").trim() || undefined;
				const reply = await context.mute?.({ target });
				await context.reply(
					reply ?? "线程已静音。在 /unmute 之前我会忽略这里的消息。",
				);
			},
		})
		.register("command", {
			names: ["/unmute"],
			isAvailable: (context) => typeof context.unmute === "function",
			run: async ({ args }, context) => {
				const target = args.join(" ").trim() || undefined;
				const reply = await context.unmute?.({ target });
				await context.reply(reply ?? "线程已取消静音。");
			},
		})
		.register("command", {
			names: ["/exit"],
			isAvailable: (context) => typeof context.stop === "function",
			run: async (_parsed, context) => {
				await context.reply("正在停止会话。");
				await context.stop?.();
			},
		})
		.register("command", {
			names: ["/whereami"],
			isAvailable: (context) => typeof context.describe === "function",
			run: async (_parsed, context) => {
				const description = await context.describe?.();
				if (description) {
					await context.reply(description);
				}
			},
		})
		.register("command", {
			names: ["/tools"],
			run: async ({ args, state }, context) => {
				const resolved = parseBooleanValue(args[0], state.enableTools);
				if (args[0] && resolved === undefined) {
					await context.reply(usage("/tools [on|off|toggle]"));
					return;
				}
				if (resolved === undefined) {
					await context.reply(`tools=${state.enableTools ? "on" : "off"}`);
					return;
				}
				await context.setState({ ...state, enableTools: resolved });
				await context.reply(`tools=${resolved ? "on" : "off"}`);
			},
		})
		.register("command", {
			names: ["/yolo"],
			run: async ({ args, state }, context) => {
				const resolved = parseBooleanValue(args[0], state.autoApproveTools);
				if (args[0] && resolved === undefined) {
					await context.reply(usage("/yolo [on|off|toggle]"));
					return;
				}
				if (resolved === undefined) {
					await context.reply(`yolo=${state.autoApproveTools ? "on" : "off"}`);
					return;
				}
				await context.setState({ ...state, autoApproveTools: resolved });
				await context.reply(`yolo=${resolved ? "on" : "off"}`);
			},
		})
		.register("command", {
			names: ["/cwd"],
			run: async ({ args, state }, context) => {
				const rawPath = args.join(" ").trim();
				if (!rawPath) {
					await context.reply(
						`cwd=${state.cwd}\nworkspaceRoot=${state.workspaceRoot}`,
					);
					return;
				}
				const nextCwd = resolve(state.cwd, rawPath);
				const fileStat = await stat(nextCwd).catch(() => undefined);
				if (!fileStat?.isDirectory()) {
					await context.reply(`无效目录: ${nextCwd}`);
					return;
				}
				const workspaceRoot = resolveWorkspaceRoot(nextCwd);
				await context.setState({
					...state,
					cwd: nextCwd,
					workspaceRoot,
				});
				await context.reply(`cwd=${nextCwd}\nworkspaceRoot=${workspaceRoot}`);
			},
		})
		.register("command", {
			names: ["/team"],
			run: async ({ args }, context) => {
				const taskBody = args.join(" ").trim();
				if (!taskBody) {
					await context.reply(
						"用法: /team <任务描述>\n为给定任务启动一个代理团队。",
					);
					return;
				}
				// In the default host the /team command only shows usage.
				// The interactive runtime handles input transformation and
				// session-level enableTeams toggling before this host runs.
				await context.reply(
					"/team 命令必须直接作为提示输入，而不是通过聊天命令。",
				);
			},
		})
		.register("command", {
			names: ["/fork"],
			isAvailable: (context) => typeof context.fork === "function",
			run: async (_parsed, context) => {
				let result: ForkSessionResult | undefined;
				try {
					result = await context.fork?.();
				} catch (error) {
					await context.reply(
						error instanceof Error
							? error.message
							: "分叉失败: 无法从当前会话读取消息。",
					);
					return;
				}
				if (!result) {
					await context.reply(
						"分叉失败: 无法从当前会话读取消息。",
					);
					return;
				}
				await context.reply(
					`已将会话 ${result.forkedFromSessionId} 分叉到新会话 ${result.newSessionId}。这现在是活动会话。使用 /history 切换会话。`,
				);
			},
		})
		.register("command", {
			names: ["/schedule"],
			run: async ({ args }, context) => {
				if (!context.schedule) {
					await context.reply("此聊天中不支持计划任务。");
					return;
				}
				const subcommand = args[0]?.trim().toLowerCase();
				if (!subcommand || subcommand === "help") {
					await context.reply(scheduleUsage());
					return;
				}
				if (subcommand === "list") {
					if (!context.schedule.list) {
						await context.reply("此处不支持计划任务列表。");
						return;
					}
					await context.reply(await context.schedule.list());
					return;
				}
				if (subcommand === "trigger") {
					const scheduleId = args[1]?.trim();
					if (!scheduleId) {
						await context.reply(usage("/schedule trigger <schedule-id>"));
						return;
					}
					if (!context.schedule.trigger) {
						await context.reply("此处不支持计划任务触发。");
						return;
					}
					await context.reply(await context.schedule.trigger(scheduleId));
					return;
				}
				if (subcommand === "delete") {
					const scheduleId = args[1]?.trim();
					if (!scheduleId) {
						await context.reply(usage("/schedule delete <schedule-id>"));
						return;
					}
					if (!context.schedule.delete) {
						await context.reply("此处不支持计划任务删除。");
						return;
					}
					await context.reply(await context.schedule.delete(scheduleId));
					return;
				}
				if (subcommand === "create") {
					if (!context.schedule.create) {
						await context.reply("此处不支持计划任务创建。");
						return;
					}
					const parsed = parseFlagValues(tokenizeArgs(args.slice(1).join(" ")));
					const name =
						parsed.positionals.join(" ").trim() || parsed.flags.name?.trim();
					const cronPattern = parsed.flags.cron?.trim();
					const prompt = parsed.flags.prompt?.trim();
					if (!name || !cronPattern || !prompt) {
						await context.reply(scheduleUsage());
						return;
					}
					await context.reply(
						await context.schedule.create({ name, cronPattern, prompt }),
					);
					return;
				}
				await context.reply(scheduleUsage());
			},
		});
}

export const chatCommandHost = createDefaultChatCommandHost();

export async function maybeHandleChatCommand(
	input: string,
	context: ChatCommandContext,
): Promise<boolean> {
	return (context.host ?? chatCommandHost).handle(input, context);
}
