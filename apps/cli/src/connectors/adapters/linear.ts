import type { ChatStartSessionRequest } from "@cline/core";
import {
	createUserInstructionConfigService,
	HubSessionClient,
} from "@cline/core";
import type { ConnectLinearOptions, LinearConnectorState } from "@cline/shared";
import { type Adapter, Chat, ConsoleLogger, type Thread } from "chat";
import type { Command } from "commander";
import type { CliLoggerAdapter } from "../../logging/adapter";
import { createCliLoggerAdapter } from "../../logging/adapter";
import {
	ensureCliHubServer,
	parseHubEndpointOverride,
	resolveDefaultCliRpcAddress,
} from "../../utils/hub-runtime";
import { createWorkspaceChatCommandHost } from "../../utils/plugin-chat-commands";
import { ConnectorBase } from "../base";
import {
	createChatSdkLogger,
	enqueueThreadTurn,
	startConnectorWebhookServer,
} from "../chat-runtime";
import { isProcessRunning } from "../common";
import {
	type ActiveConnectorTurn,
	handleConnectorUserTurn,
	maybeHandleConnectorApprovalReply,
} from "../connector-host";
import { dispatchConnectorHook } from "../hooks";
import {
	type PendingConnectorApproval,
	truncateConnectorText,
} from "../runtime-turn";
import {
	buildConnectorStartRequest,
	readSessionReplyText,
	stopConnectorSessions,
} from "../session-runtime";
import { InMemoryStateAdapter } from "../stores/memory-state";
import { startConnectorTaskUpdateRelay } from "../task-updates";
import {
	type ConnectorBindingStore,
	type ConnectorThreadState,
	clearBindingSessionIds,
	findBindingForDeliveryTarget,
	findBindingForThread,
	loadThreadState,
	persistMergedThreadState,
	readBindings,
	resolveThreadTurnQueueKey,
} from "../thread-bindings";
import type {
	ConnectCommandDefinition,
	ConnectIo,
	ConnectRunContext,
	ConnectStopResult,
} from "../types";
import { getConnectorSystemPrompt } from "./prompts";

const LINEAR_SYSTEM_RULES = [
	"Keep answers compact and optimized for Linear issue comments unless the user asks for detail.",
	"Prefer short paragraphs and concise lists suitable for issue threads.",
	"When tools are disabled, explain limits briefly and ask the user to enable tools if required.",
].join("\n");

const LINEAR_FIRST_CONTACT_MESSAGE = [
	"连接成功。",
	"你的聊天记录已隔离到此 Linear 身份。",
	"如需投递线程详情，请使用 /whereami 查询。",
].join("\n");

type LinearThreadState = ConnectorThreadState;

type LinearAdapterModule = {
	createLinearAdapter: (config?: Record<string, unknown>) => unknown;
};

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

async function importLinearAdapterModule(): Promise<LinearAdapterModule> {
	const dynamicImport = Function("specifier", "return import(specifier);") as (
		specifier: string,
	) => Promise<unknown>;
	const mod = (await dynamicImport(
		"@chat-adapter/linear",
	)) as Partial<LinearAdapterModule>;
	if (typeof mod.createLinearAdapter !== "function") {
		throw new Error(
			"@chat-adapter/linear 未导出 createLinearAdapter()",
		);
	}
	return { createLinearAdapter: mod.createLinearAdapter };
}

async function stopSessionsForUser(
	state: LinearConnectorState,
): Promise<number> {
	return stopConnectorSessions({
		rpcAddress: state.rpcAddress,
		rpcMatcher: (metadata) =>
			metadata?.transport === "linear" && metadata?.userName === state.userName,
		localMatcher: (metadata) =>
			metadata?.transport === "linear" && metadata?.userName === state.userName,
	});
}

async function buildLinearStartRequest(
	options: ConnectLinearOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<ChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options: {
			...options,
			apiKey: options.apiProviderKey,
		},
		io,
		loggerConfig,
		systemRules: LINEAR_SYSTEM_RULES,
	});
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveLinearParticipant(
	rawMessage: unknown,
): { key: string; label?: string } | undefined {
	const raw = asRecord(rawMessage);
	const data = asRecord(raw?.data);
	const actor =
		asRecord(raw?.actor) ??
		asRecord(data?.actor) ??
		asRecord(data?.user) ??
		asRecord(asRecord(data?.comment)?.user);
	const userId =
		readString(actor?.id) ||
		readString(data?.userId) ||
		readString(asRecord(data?.comment)?.userId);
	const email = readString(actor?.email)?.toLowerCase();
	const name =
		readString(actor?.displayName) ||
		readString(actor?.name) ||
		readString(actor?.label);
	const label = name || email || userId;
	if (userId) {
		return {
			key: `linear:user:${userId}`,
			label,
		};
	}
	if (email) {
		return {
			key: `linear:email:${email}`,
			label,
		};
	}
	return undefined;
}

async function persistLinearThreadContext(input: {
	thread: Thread<LinearThreadState>;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	rawMessage: unknown;
	errorLabel: string;
}): Promise<void> {
	const participant = resolveLinearParticipant(input.rawMessage);
	if (!participant) {
		return;
	}
	const currentState = await loadThreadState(
		input.thread,
		input.bindingsPath,
		input.baseStartRequest,
	);
	if (
		currentState.participantKey === participant.key &&
		currentState.participantLabel === participant.label
	) {
		return;
	}
	await persistMergedThreadState(
		input.thread,
		input.bindingsPath,
		{
			...currentState,
			participantKey: participant.key,
			participantLabel: participant.label,
		},
		input.errorLabel,
	);
}

async function deliverScheduledResult(input: {
	bot: Chat;
	client: HubSessionClient;
	logger: CliLoggerAdapter;
	bindingsPath: string;
	userName: string;
	scheduleId: string;
	executionId: string;
	sessionId?: string;
	status: string;
	errorMessage?: string;
	hookCommand?: string;
}): Promise<void> {
	const schedule = await input.client.getSchedule(input.scheduleId);
	const delivery = schedule?.metadata?.delivery as
		| Record<string, unknown>
		| undefined;
	if (!delivery || delivery.adapter !== "linear") {
		return;
	}
	const targetUser =
		typeof delivery.userName === "string" ? delivery.userName.trim() : "";
	if (targetUser && targetUser !== input.userName) {
		return;
	}
	const threadId =
		typeof delivery.threadId === "string" ? delivery.threadId.trim() : "";
	const bindingKey =
		typeof delivery.bindingKey === "string" ? delivery.bindingKey.trim() : "";
	const participantKey =
		typeof delivery.participantKey === "string"
			? delivery.participantKey.trim()
			: "";
	if (!threadId && !bindingKey && !participantKey) {
		return;
	}
	const bindings = readBindings<LinearThreadState>(input.bindingsPath);
	const match = findBindingForDeliveryTarget(bindings, {
		bindingKey,
		threadId,
		participantKey,
	});
	const binding = match?.binding;
	if (!binding?.serializedThread) {
		return;
	}
	await dispatchConnectorHook(
		input.hookCommand,
		{
			adapter: "linear",
			botUserName: input.userName,
			event: "schedule.delivery.started",
			payload: {
				threadId: match?.key || threadId,
				scheduleId: input.scheduleId,
				executionId: input.executionId,
				sessionId: input.sessionId,
				status: input.status,
			},
			ts: new Date().toISOString(),
		},
		input.logger,
	);
	const thread = JSON.parse(
		binding.serializedThread,
		input.bot.reviver(),
	) as Thread<LinearThreadState>;
	let body = "";
	if (input.status === "success" && input.sessionId) {
		const text = await readSessionReplyText(input.client, input.sessionId);
		body = text?.trim()
			? text
			: `计划 "${schedule?.name ?? input.scheduleId}" 已完成，但未找到助手回复文本。`;
	} else {
		body = `计划 "${schedule?.name ?? input.scheduleId}" ${input.status}。${input.errorMessage ? `\n\n${input.errorMessage}` : ""}`;
	}
	await thread.post(body);
}

class LinearConnector extends ConnectorBase<
	ConnectLinearOptions,
	LinearConnectorState
> {
	constructor() {
		super("linear", "基于 RPC 运行时会话的 Linear webhook 桥接器");
	}

	protected override createCommand(): Command {
		return (
			super
				.createCommand()
				.usage("--base-url <PUBLIC_BASE_URL> [options]")
				.option("--user-name <name>", "Linear 机器人显示名称")
				.option("--api-key <key>", "Linear 个人 API 密钥")
				.option("--client-id <id>", "Linear OAuth 客户端 ID")
				.option("--client-secret <secret>", "Linear OAuth 客户端密钥")
				.option("--access-token <token>", "预先获取的 Linear 访问令牌")
				.option("--webhook-secret <secret>", "Linear webhook 签名密钥")
				.option("--provider <id>", "覆盖提供商")
				.option("--model <id>", "覆盖模型")
				.option("--provider-api-key <key>", "覆盖提供商 API 密钥")
				.option("--system <prompt>", "覆盖系统提示词")
				.option("--cwd <path>", "运行时的工作区 / 工作目录")
				.option("--mode <act|plan>", "代理模式", "act")
				.option("-i, --interactive", "在前台保持连接器运行")
				.option("--no-tools", "为 Linear 会话禁用工具")
				// Retained so existing invocations and persisted autostart arguments
				// keep parsing; tools are on unless --no-tools is passed.
				.option("--enable-tools", "启用工具（默认）")
				.option(
					"--hook-command <command>",
					"为连接器事件运行 shell 命令",
				)
				.option(
					"--rpc-address <host:port>",
					"RPC 地址",
					process.env.CLINE_RPC_ADDRESS?.trim() ||
						resolveDefaultCliRpcAddress(),
				)
				.option("--host <host>", "Webhook 监听主机")
				.option("--port <port>", "Webhook 监听端口")
				.option("--base-url <url>", "用于 webhook 配置的公共基础 URL")
				.addHelpText(
					"after",
					[
						"",
						"环境变量：",
						"  LINEAR_API_KEY             个人 API 密钥",
						"  LINEAR_CLIENT_ID           OAuth 客户端 ID",
						"  LINEAR_CLIENT_SECRET       OAuth 客户端密钥",
						"  LINEAR_ACCESS_TOKEN        预先获取的访问令牌",
						"  LINEAR_WEBHOOK_SECRET      Webhook 签名密钥",
						"  LINEAR_BOT_USERNAME        机器人显示名称（默认：linear-bot）",
					].join("\n"),
				)
		);
	}

	protected override readOptions(command: Command): ConnectLinearOptions {
		const opts = command.opts<{
			userName?: string;
			apiKey?: string;
			clientId?: string;
			clientSecret?: string;
			accessToken?: string;
			webhookSecret?: string;
			cwd?: string;
			model?: string;
			provider?: string;
			providerApiKey?: string;
			system?: string;
			mode?: string;
			interactive?: boolean;
			enableTools?: boolean;
			tools?: boolean;
			rpcAddress?: string;
			hookCommand?: string;
			port?: string;
			host?: string;
			baseUrl?: string;
		}>();
		const apiKey = opts.apiKey?.trim() || process.env.LINEAR_API_KEY?.trim();
		const clientId =
			opts.clientId?.trim() || process.env.LINEAR_CLIENT_ID?.trim();
		const clientSecret =
			opts.clientSecret?.trim() || process.env.LINEAR_CLIENT_SECRET?.trim();
		const accessToken =
			opts.accessToken?.trim() || process.env.LINEAR_ACCESS_TOKEN?.trim();
		const webhookSecret =
			opts.webhookSecret?.trim() || process.env.LINEAR_WEBHOOK_SECRET?.trim();
		if (!webhookSecret) {
			throw new Error(
				"connect linear 需要 --webhook-secret <secret> 或 LINEAR_WEBHOOK_SECRET",
			);
		}
		if (!apiKey && !accessToken && !(clientId && clientSecret)) {
			throw new Error(
				"connect linear 需要 LINEAR_API_KEY、LINEAR_ACCESS_TOKEN，或同时提供 LINEAR_CLIENT_ID 和 LINEAR_CLIENT_SECRET",
			);
		}
		const parsedPort =
			this.parseOptionalInteger(opts.port, "port") ??
			Number.parseInt(process.env.PORT ?? "8787", 10);
		const port = Number.isFinite(parsedPort) ? parsedPort : 8787;
		return {
			userName:
				opts.userName?.trim() ||
				process.env.LINEAR_BOT_USERNAME?.trim() ||
				"linear-bot",
			apiKey,
			clientId,
			clientSecret,
			accessToken,
			webhookSecret,
			cwd: opts.cwd || process.cwd(),
			model: opts.model,
			provider: opts.provider,
			apiProviderKey: opts.providerApiKey,
			systemPrompt: opts.system,
			mode: this.parseMode(opts.mode),
			interactive: Boolean(opts.interactive),
			enableTools: opts.tools !== false,
			rpcAddress:
				opts.rpcAddress?.trim() ||
				process.env.CLINE_RPC_ADDRESS?.trim() ||
				resolveDefaultCliRpcAddress(),
			hookCommand:
				opts.hookCommand?.trim() ||
				process.env.CLINE_CONNECT_HOOK_COMMAND?.trim(),
			port,
			host: opts.host?.trim() || process.env.HOST?.trim() || "0.0.0.0",
			baseUrl:
				opts.baseUrl?.trim() ||
				process.env.BASE_URL?.trim() ||
				`http://127.0.0.1:${port}`,
		};
	}

	private resolveConnectorStatePath(userName: string): string {
		return this.resolveConnectorPath(`${this.sanitizeKey(userName)}.json`);
	}

	private resolveBindingsPath(userName: string): string {
		return this.resolveConnectorPath(
			`${this.sanitizeKey(userName)}.threads.json`,
		);
	}

	private listConnectorStatePaths(): string[] {
		return this.listJsonStatePaths([".threads.json"]);
	}

	private readConnectorState(
		statePath: string,
	): LinearConnectorState | undefined {
		return this.readStateFile(
			statePath,
			(value): value is LinearConnectorState =>
				Boolean(
					value &&
						typeof value === "object" &&
						typeof (value as LinearConnectorState).pid === "number" &&
						typeof (value as LinearConnectorState).userName === "string",
				),
		);
	}

	private writeConnectorState(
		statePath: string,
		state: LinearConnectorState,
	): void {
		this.writeStateFile(statePath, state);
	}

	private async stopLinearConnectorInstance(
		statePath: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return this.stopManagedProcess({
			io,
			statePath,
			readState: (path) => this.readConnectorState(path),
			describeStoppedProcess: (state) =>
				`[linear] 已停止 pid=${state.pid} user=${state.userName}`,
			getPid: (state) => state.pid,
			stopSessions: stopSessionsForUser,
			clearBindings: (state) => {
				clearBindingSessionIds<LinearThreadState>(
					this.resolveBindingsPath(state.userName),
				);
			},
		});
	}

	override async stopAll(io: ConnectIo): Promise<ConnectStopResult> {
		return this.stopAllFromStatePaths(
			io,
			this.listConnectorStatePaths(),
			(statePath, stopIo) =>
				this.stopLinearConnectorInstance(statePath, stopIo),
		);
	}

	override async stopInstance(
		instanceId: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return await this.stopLinearConnectorInstance(
			this.resolveConnectorStatePath(instanceId),
			io,
		);
	}

	protected override instanceIdFromOptions(
		options: ConnectLinearOptions,
	): string | undefined {
		return options.userName;
	}

	protected override async runWithOptions(
		options: ConnectLinearOptions,
		rawArgs: string[],
		io: ConnectIo,
		context: ConnectRunContext,
	): Promise<number> {
		context.setPersistenceInstanceId(options.userName);
		const statePath = this.resolveConnectorStatePath(options.userName);
		const bindingsPath = this.resolveBindingsPath(options.userName);
		const staleState = this.removeStaleState(
			statePath,
			(path) => this.readConnectorState(path),
			(state) => state.pid,
		);
		if (staleState) {
			clearBindingSessionIds<LinearThreadState>(bindingsPath);
		}
		const backgroundExitCode = await this.maybeRunInBackground({
			rawArgs,
			io,
			interactive: options.interactive,
			childEnvVar: "CLINE_LINEAR_CONNECT_CHILD",
			statePath,
			readState: (path) => this.readConnectorState(path),
			isRunning: (state) => isProcessRunning(state.pid),
			formatAlreadyRunningMessage: (state) =>
				`[linear] 连接器已在运行 pid=${state.pid} rpc=${state.rpcAddress} url=${state.baseUrl}`,
			formatBackgroundStartMessage: (pid) =>
				`[linear] 正在后台启动连接器 pid=${pid} user=${options.userName}`,
			foregroundHint:
				"[linear] 使用 `cline connect linear -i ...` 在前台运行",
			launchFailureMessage: "无法在后台启动 Linear 连接器",
		});
		if (backgroundExitCode !== undefined) {
			return backgroundExitCode;
		}

		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "linear-connect",
		});
		const logger = createChatSdkLogger(loggerAdapter);
		const consoleLogger = new ConsoleLogger("info", "linear-connect");
		let linearAdapter: unknown;
		try {
			const { createLinearAdapter } = await importLinearAdapterModule();
			const linearConfig: Record<string, unknown> = {
				webhookSecret: options.webhookSecret,
				userName: options.userName,
				logger: consoleLogger,
			};
			if (options.apiKey) {
				linearConfig.apiKey = options.apiKey;
			}
			if (options.clientId) {
				linearConfig.clientId = options.clientId;
			}
			if (options.clientSecret) {
				linearConfig.clientSecret = options.clientSecret;
			}
			if (options.accessToken) {
				linearConfig.accessToken = options.accessToken;
			}
			linearAdapter = createLinearAdapter(linearConfig);
		} catch (error) {
			io.writeErr(
				`加载 @chat-adapter/linear 失败：${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}

		const bot = new Chat({
			userName: options.userName,
			adapters: { linear: linearAdapter as Adapter },
			state: new InMemoryStateAdapter(),
			logger,
			fallbackStreamingPlaceholderText: null,
			streamingUpdateIntervalMs: 500,
		}).registerSingleton();
		const threadQueues = new Map<string, Promise<void>>();
		const activeTurns = new Map<string, ActiveConnectorTurn>();
		const pendingApprovals = new Map<string, PendingConnectorApproval>();
		const startRequest = await buildLinearStartRequest(options, io, {
			enabled: loggerAdapter.runtimeConfig.enabled,
			level: loggerAdapter.runtimeConfig.level,
			destination: loggerAdapter.runtimeConfig.destination,
			bindings: {
				transport: "linear",
				userName: options.userName,
			},
		});
		const userInstructionService = createUserInstructionConfigService({
			skills: { workspacePath: startRequest.cwd },
			rules: { workspacePath: startRequest.cwd },
			workflows: { workspacePath: startRequest.cwd },
		});
		await userInstructionService.start().catch(() => undefined);
		const commandCwd = startRequest.cwd || process.cwd();
		const { host: chatCommandHost } = await createWorkspaceChatCommandHost({
			cwd: commandCwd,
			workspaceRoot: startRequest.workspaceRoot || commandCwd,
		});
		const { url: rpcAddress, authToken: rpcAuthToken } =
			await ensureCliHubServer(
				startRequest.workspaceRoot || startRequest.cwd || process.cwd(),
				parseHubEndpointOverride(options.rpcAddress),
			);

		const clientId = `linear-${process.pid}-${Date.now()}`;
		const client = new HubSessionClient({
			address: rpcAddress,
			authToken: rpcAuthToken,
			clientId,
			clientType: "cli",
			displayName: "linear 连接器",
			workspaceRoot: startRequest.workspaceRoot || startRequest.cwd,
			cwd: startRequest.cwd,
			metadata: {
				transport: "linear",
				userName: options.userName,
			},
		});
		await client.connect();
		this.writeConnectorState(statePath, {
			userName: options.userName,
			pid: process.pid,
			rpcAddress,
			port: options.port,
			baseUrl: options.baseUrl,
			startedAt: new Date().toISOString(),
		});

		let stopping = false;
		let resolveStop: (() => void) | undefined;
		const stopPromise = new Promise<void>((resolve) => {
			resolveStop = resolve;
		});
		const requestStop = (_reason: string) => {
			if (stopping) {
				return;
			}
			stopping = true;
			resolveStop?.();
		};

		const handleTurn = async (
			thread: Thread<LinearThreadState>,
			text: string,
		) => {
			const queueKey = resolveThreadTurnQueueKey(thread);
			const enqueueTurn = (work: () => Promise<void>) =>
				enqueueThreadTurn(threadQueues, queueKey, work);
			const runTurn = async () => {
				try {
					await handleConnectorUserTurn({
						thread,
						text,
						client,
						pendingApprovals,
						baseStartRequest: startRequest,
						explicitSystemPrompt:
							options.systemPrompt?.trim() ||
							getConnectorSystemPrompt("Linear"),
						clientId,
						logger: loggerAdapter,
						transport: "linear",
						botUserName: options.userName,
						requestStop,
						bindingsPath,
						hookCommand: options.hookCommand,
						systemRules: LINEAR_SYSTEM_RULES,
						errorLabel: "Linear",
						firstContactMessage: LINEAR_FIRST_CONTACT_MESSAGE,
						userInstructionService,
						chatCommandHost,
						activeTurns,
						enqueueTurn,
						turnKey: queueKey,
						getSessionMetadata: (currentThread, _clientId, currentState) => ({
							userName: options.userName,
							linearThreadId: currentThread.id,
							linearChannelId: currentThread.channelId,
							...(currentState.participantKey
								? { linearParticipantKey: currentState.participantKey }
								: {}),
							...(currentState.participantLabel
								? { linearParticipantLabel: currentState.participantLabel }
								: {}),
						}),
						reusedLogMessage: "Linear 线程正在复用 RPC 会话",
						onReplyCompleted: async (result) => {
							await dispatchConnectorHook(
								options.hookCommand,
								{
									adapter: "linear",
									botUserName: options.userName,
									event: "message.completed",
									payload: {
										threadId: result.threadId,
										sessionId: result.sessionId,
										finishReason: result.finishReason,
										iterations: result.iterations,
										outputPreview: truncateText(result.text),
										outputLength: result.text.length,
									},
									ts: new Date().toISOString(),
								},
								loggerAdapter,
							);
						},
						onReplyFailed: async (details) => {
							await dispatchConnectorHook(
								options.hookCommand,
								{
									adapter: "linear",
									botUserName: options.userName,
									event: "message.failed",
									payload: {
										threadId: details.threadId,
										sessionId: details.sessionId,
										error: details.error.message,
									},
									ts: new Date().toISOString(),
								},
								loggerAdapter,
							);
						},
					});
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					await thread.post(`Linear 桥接器错误：${message}`);
				}
			};
			if (activeTurns.has(queueKey)) {
				await runTurn();
				return;
			}
			await enqueueTurn(runTurn);
		};

		bot.onNewMention(async (thread, message) => {
			await thread.subscribe();
			await persistLinearThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Linear",
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text: message.text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "已被 Linear 用户拒绝",
				})
			) {
				return;
			}
			await handleTurn(thread, message.text);
		});

		bot.onSubscribedMessage(async (thread, message) => {
			await persistLinearThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Linear",
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text: message.text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "已被 Linear 用户拒绝",
				})
			) {
				return;
			}
			await handleTurn(thread, message.text);
		});

		await bot.initialize();
		const stopTaskUpdateStream =
			startConnectorTaskUpdateRelay<LinearThreadState>({
				client,
				clientId,
				bot,
				logger: loggerAdapter,
				bindingsPath,
				transport: "linear",
			});

		const webhookUrl = `${options.baseUrl.replace(/\/$/, "")}/api/webhooks/linear`;
		const server = await startConnectorWebhookServer({
			host: options.host,
			port: options.port,
			routes: {
				"/api/webhooks/linear": async (request) => bot.webhooks.linear(request),
				"/health": () => new Response("ok"),
				"/": () =>
					new Response(
						["Linear 连接器正在运行。", `Webhook URL: ${webhookUrl}`].join(
							"\n",
						),
					),
			},
		});

		const stopEventStream = client.streamEvents(
			{ clientId: `${clientId}-server-events` },
			{
				onEvent: (event) => {
					if (event.eventType === "rpc.server.shutting_down") {
						requestStop("rpc_server_shutting_down");
						return;
					}
					if (
						event.eventType !== "schedule.execution.completed" &&
						event.eventType !== "schedule.execution.failed"
					) {
						return;
					}
					const scheduleId =
						typeof event.payload.scheduleId === "string"
							? event.payload.scheduleId.trim()
							: "";
					const executionId =
						typeof event.payload.executionId === "string"
							? event.payload.executionId.trim()
							: "";
					const sessionId =
						typeof event.payload.sessionId === "string"
							? event.payload.sessionId.trim()
							: undefined;
					const status =
						typeof event.payload.status === "string"
							? event.payload.status.trim()
							: "";
					const errorMessage =
						typeof event.payload.errorMessage === "string"
							? event.payload.errorMessage
							: undefined;
					if (!scheduleId || !executionId || !status) {
						return;
					}
					void deliverScheduledResult({
						bot,
						client,
						logger: loggerAdapter,
						bindingsPath,
						userName: options.userName,
						scheduleId,
						executionId,
						sessionId,
						status,
						errorMessage,
						hookCommand: options.hookCommand,
					});
				},
				onError: () => {
					requestStop("rpc_server_event_stream_failed");
				},
			},
		);

		process.once("SIGINT", () => requestStop("sigint"));
		process.once("SIGTERM", () => requestStop("sigterm"));

		io.writeln(`[linear] 正在监听 ${options.host}:${options.port}`);
		io.writeln(`[linear] 配置 Linear webhook URL：${webhookUrl}`);

		await stopPromise;
		clearBindingSessionIds<LinearThreadState>(bindingsPath);
		stopTaskUpdateStream();
		stopEventStream();
		await server.close();
		userInstructionService.stop();
		await bot.shutdown().catch(() => undefined);
		client.close();
		this.removeStateFile(statePath);
		return 0;
	}
}

export const linearConnector: ConnectCommandDefinition = new LinearConnector();

export const __test__ = {
	findBindingForThread: (
		bindings: ConnectorBindingStore<LinearThreadState>,
		thread: Pick<Thread<LinearThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
		},
	) => findBindingForThread(bindings, thread),
};
