import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import type { ChatStartSessionRequest } from "@cline/core";
import {
	createUserInstructionConfigService,
	HubSessionClient,
} from "@cline/core";
import type {
	ConnectWhatsAppOptions,
	WhatsAppConnectorState,
} from "@cline/shared";
import { Chat, ConsoleLogger, type Thread } from "chat";
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
import {
	getConnectorFirstContactMessage,
	getConnectorSystemPrompt,
	getConnectorSystemRules,
} from "./prompts";

const WHATSAPP_SYSTEM_RULES = getConnectorSystemRules(
	"WhatsApp",
	"你能在会话和私信中回复用户消息，并能根据用户的请求和自身能力使用工具。",
);

const WHATSAPP_FIRST_CONTACT_MESSAGE = getConnectorFirstContactMessage();

type WhatsAppThreadState = ConnectorThreadState;

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

function resolveInstanceKey(input: {
	phoneNumberId?: string;
	userName: string;
}): string {
	return (input.phoneNumberId?.trim() || input.userName).replace(
		/[^a-zA-Z0-9._-]+/g,
		"_",
	);
}

async function stopSessionsForConnector(
	state: WhatsAppConnectorState,
): Promise<number> {
	return stopConnectorSessions({
		rpcAddress: state.rpcAddress,
		rpcMatcher: (metadata) =>
			metadata?.transport === "whatsapp" &&
			(state.phoneNumberId?.trim()
				? metadata?.phoneNumberId === state.phoneNumberId.trim()
				: metadata?.userName === state.userName),
		localMatcher: (metadata) =>
			metadata?.transport === "whatsapp" &&
			(state.phoneNumberId?.trim()
				? metadata?.phoneNumberId === state.phoneNumberId.trim()
				: metadata?.userName === state.userName),
	});
}

async function buildWhatsAppStartRequest(
	options: ConnectWhatsAppOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<ChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options,
		io,
		loggerConfig,
		systemRules: WHATSAPP_SYSTEM_RULES,
	});
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
	return Array.isArray(value) ? asRecord(value[0]) : undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveWhatsAppParticipant(
	rawMessage: unknown,
): { key: string; label?: string } | undefined {
	const raw = asRecord(rawMessage);
	const contact = asRecord(raw?.contact) ?? firstRecord(raw?.contacts);
	const profile = asRecord(contact?.profile);
	const phone =
		readString(raw?.from) ||
		readString(raw?.wa_id) ||
		readString(contact?.wa_id);
	const label = readString(profile?.name) || phone;
	if (!phone) {
		return undefined;
	}
	return {
		key: `whatsapp:user:${phone}`,
		label,
	};
}

async function persistWhatsAppThreadContext(input: {
	thread: Thread<WhatsAppThreadState>;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	rawMessage: unknown;
	errorLabel: string;
}): Promise<void> {
	const participant = resolveWhatsAppParticipant(input.rawMessage);
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
	options: ConnectWhatsAppOptions;
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
	if (!delivery || delivery.adapter !== "whatsapp") {
		return;
	}
	const targetPhoneNumberId =
		typeof delivery.phoneNumberId === "string"
			? delivery.phoneNumberId.trim()
			: "";
	if (
		targetPhoneNumberId &&
		input.options.phoneNumberId?.trim() &&
		targetPhoneNumberId !== input.options.phoneNumberId.trim()
	) {
		return;
	}
	const targetUserName =
		typeof delivery.userName === "string" ? delivery.userName.trim() : "";
	if (targetUserName && targetUserName !== input.options.userName) {
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
	const bindings = readBindings<WhatsAppThreadState>(input.bindingsPath);
	const match = findBindingForDeliveryTarget(bindings, {
		bindingKey,
		threadId,
		participantKey,
	});
	const binding = match?.binding;
	if (!binding?.serializedThread) {
		return;
	}
	const thread = JSON.parse(
		binding.serializedThread,
		input.bot.reviver(),
	) as Thread<WhatsAppThreadState>;
	let body = "";
	if (input.status === "success" && input.sessionId) {
		const text = await readSessionReplyText(input.client, input.sessionId);
		body = text?.trim()
			? text
			: `计划 "${schedule?.name ?? input.scheduleId}" 已完成，但未找到助手的回复文本。`;
	} else {
		body = `计划 "${schedule?.name ?? input.scheduleId}" ${input.status}。${input.errorMessage ? `\n\n${input.errorMessage}` : ""}`;
	}
	await thread.post(body);
}

class WhatsAppConnector extends ConnectorBase<
	ConnectWhatsAppOptions,
	WhatsAppConnectorState
> {
	constructor() {
		super(
			"whatsapp",
			"WhatsApp Business 网页钩子桥接，基于 RPC 运行时会话",
		);
	}

	protected override createCommand(): Command {
		return (
			super
				.createCommand()
				.usage("--base-url <PUBLIC_BASE_URL> [options]")
				.option("--user-name <name>", "WhatsApp 机器人用户名标签")
				.option("--phone-number-id <id>", "WhatsApp Business 电话号码 ID")
				.option("--access-token <token>", "Meta 访问令牌")
				.option("--app-secret <secret>", "Meta 应用密钥")
				.option("--verify-token <token>", "Webhook 验证令牌")
				.option("--api-version <version>", "Graph API 版本", "v21.0")
				.option("--provider <id>", "提供商覆盖")
				.option("--model <id>", "模型覆盖")
				.option("--api-key <key>", "提供商 API 密钥覆盖")
				.option("--system <prompt>", "系统提示词覆盖")
				.option("--cwd <path>", "运行时的工作区 / cwd")
				.option("--mode <act|plan>", "代理模式", "act")
				.option("-i, --interactive", "保持连接器在前台运行")
				.option("--no-tools", "为 WhatsApp 会话禁用工具")
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
						"环境：",
						"  WHATSAPP_ACCESS_TOKEN       Meta 访问令牌",
						"  WHATSAPP_APP_SECRET         Meta 应用密钥",
						"  WHATSAPP_PHONE_NUMBER_ID    WhatsApp Business 电话号码 ID",
						"  WHATSAPP_VERIFY_TOKEN       Webhook 验证令牌",
						"  WHATSAPP_BOT_USERNAME       机器人用户名标签",
					].join("\n"),
				)
		);
	}

	protected override readOptions(command: Command): ConnectWhatsAppOptions {
		const opts = command.opts<{
			userName?: string;
			phoneNumberId?: string;
			accessToken?: string;
			appSecret?: string;
			verifyToken?: string;
			apiVersion?: string;
			cwd?: string;
			model?: string;
			provider?: string;
			apiKey?: string;
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
		const parsedPort =
			this.parseOptionalInteger(opts.port, "port") ??
			Number.parseInt(process.env.PORT ?? "8787", 10);
		const port = Number.isFinite(parsedPort) ? parsedPort : 8787;
		return {
			userName:
				opts.userName?.trim() ||
				process.env.WHATSAPP_BOT_USERNAME?.trim() ||
				"whatsapp-bot",
			phoneNumberId:
				opts.phoneNumberId?.trim() ||
				process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
			accessToken:
				opts.accessToken?.trim() || process.env.WHATSAPP_ACCESS_TOKEN?.trim(),
			appSecret:
				opts.appSecret?.trim() || process.env.WHATSAPP_APP_SECRET?.trim(),
			verifyToken:
				opts.verifyToken?.trim() || process.env.WHATSAPP_VERIFY_TOKEN?.trim(),
			apiVersion: opts.apiVersion?.trim() || "v21.0",
			cwd: opts.cwd || process.cwd(),
			model: opts.model,
			provider: opts.provider,
			apiKey: opts.apiKey,
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

	private resolveConnectorStatePath(instanceKey: string): string {
		return this.resolveConnectorPath(`${instanceKey}.json`);
	}

	private resolveBindingsPath(instanceKey: string): string {
		return this.resolveConnectorPath(`${instanceKey}.threads.json`);
	}

	private listConnectorStatePaths(): string[] {
		return this.listJsonStatePaths([".threads.json"]);
	}

	private readConnectorState(
		statePath: string,
	): WhatsAppConnectorState | undefined {
		return this.readStateFile(
			statePath,
			(value): value is WhatsAppConnectorState =>
				Boolean(
					value &&
						typeof value === "object" &&
						typeof (value as WhatsAppConnectorState).pid === "number" &&
						typeof (value as WhatsAppConnectorState).instanceKey === "string" &&
						typeof (value as WhatsAppConnectorState).userName === "string",
				),
		);
	}

	private writeConnectorState(
		statePath: string,
		state: WhatsAppConnectorState,
	): void {
		this.writeStateFile(statePath, state);
	}

	private async stopWhatsAppConnectorInstance(
		statePath: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return this.stopManagedProcess({
			io,
			statePath,
			readState: (path) => this.readConnectorState(path),
			describeStoppedProcess: (state) =>
				`[whatsapp] stopped pid=${state.pid} user=${state.userName}${state.phoneNumberId ? ` phone=${state.phoneNumberId}` : ""}`,
			getPid: (state) => state.pid,
			stopSessions: stopSessionsForConnector,
			clearBindings: (state) => {
				clearBindingSessionIds<WhatsAppThreadState>(
					this.resolveBindingsPath(state.instanceKey),
				);
			},
		});
	}

	override async stopAll(io: ConnectIo): Promise<ConnectStopResult> {
		return this.stopAllFromStatePaths(
			io,
			this.listConnectorStatePaths(),
			(statePath, stopIo) =>
				this.stopWhatsAppConnectorInstance(statePath, stopIo),
		);
	}

	override async stopInstance(
		instanceId: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return await this.stopWhatsAppConnectorInstance(
			this.resolveConnectorStatePath(instanceId),
			io,
		);
	}

	protected override instanceIdFromOptions(
		options: ConnectWhatsAppOptions,
	): string | undefined {
		return resolveInstanceKey({
			phoneNumberId: options.phoneNumberId,
			userName: options.userName,
		});
	}

	protected override async runWithOptions(
		options: ConnectWhatsAppOptions,
		rawArgs: string[],
		io: ConnectIo,
		context: ConnectRunContext,
	): Promise<number> {
		const instanceKey = resolveInstanceKey({
			phoneNumberId: options.phoneNumberId,
			userName: options.userName,
		});
		context.setPersistenceInstanceId(instanceKey);
		const statePath = this.resolveConnectorStatePath(instanceKey);
		const bindingsPath = this.resolveBindingsPath(instanceKey);
		const staleState = this.removeStaleState(
			statePath,
			(path) => this.readConnectorState(path),
			(state) => state.pid,
		);
		if (staleState) {
			clearBindingSessionIds<WhatsAppThreadState>(bindingsPath);
		}
		const backgroundExitCode = await this.maybeRunInBackground({
			rawArgs,
			io,
			interactive: options.interactive,
			childEnvVar: "CLINE_WHATSAPP_CONNECT_CHILD",
			statePath,
			readState: (path) => this.readConnectorState(path),
			isRunning: (state) => isProcessRunning(state.pid),
			formatAlreadyRunningMessage: (state) =>
				`[whatsapp] 连接器已在运行 pid=${state.pid} rpc=${state.rpcAddress} url=${state.baseUrl}`,
			formatBackgroundStartMessage: (pid) =>
				`[whatsapp] 正在后台启动连接器 pid=${pid} user=${options.userName}`,
			foregroundHint:
				"[whatsapp] 使用 `cline connect whatsapp -i ...` 在前台运行",
			launchFailureMessage: "无法在后台启动 WhatsApp 连接器",
		});
		if (backgroundExitCode !== undefined) {
			return backgroundExitCode;
		}

		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "whatsapp-connect",
		});
		const logger = createChatSdkLogger(loggerAdapter);
		const consoleLogger = new ConsoleLogger("info", "whatsapp-connect");
		const whatsappConfig: Record<string, unknown> = {
			logger: consoleLogger,
			userName: options.userName,
		};
		if (options.accessToken?.trim()) {
			whatsappConfig.accessToken = options.accessToken.trim();
		}
		if (options.appSecret?.trim()) {
			whatsappConfig.appSecret = options.appSecret.trim();
		}
		if (options.phoneNumberId?.trim()) {
			whatsappConfig.phoneNumberId = options.phoneNumberId.trim();
		}
		if (options.verifyToken?.trim()) {
			whatsappConfig.verifyToken = options.verifyToken.trim();
		}
		if (options.apiVersion?.trim()) {
			whatsappConfig.apiVersion = options.apiVersion.trim();
		}
		const whatsapp = createWhatsAppAdapter(whatsappConfig);
		const bot = new Chat({
			userName: options.userName,
			adapters: { whatsapp },
			state: new InMemoryStateAdapter(),
			logger,
			fallbackStreamingPlaceholderText: null,
			streamingUpdateIntervalMs: 500,
		}).registerSingleton();
		const threadQueues = new Map<string, Promise<void>>();
		const activeTurns = new Map<string, ActiveConnectorTurn>();
		const pendingApprovals = new Map<string, PendingConnectorApproval>();
		const startRequest = await buildWhatsAppStartRequest(options, io, {
			enabled: loggerAdapter.runtimeConfig.enabled,
			level: loggerAdapter.runtimeConfig.level,
			destination: loggerAdapter.runtimeConfig.destination,
			bindings: {
				transport: "whatsapp",
				userName: options.userName,
				...(options.phoneNumberId
					? { phoneNumberId: options.phoneNumberId }
					: {}),
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

		const clientId = `whatsapp-${process.pid}-${Date.now()}`;
		const client = new HubSessionClient({
			address: rpcAddress,
			authToken: rpcAuthToken,
			clientId,
			clientType: "cli",
			displayName: "whatsapp connector",
			workspaceRoot: startRequest.workspaceRoot || startRequest.cwd,
			cwd: startRequest.cwd,
			metadata: {
				transport: "whatsapp",
				userName: options.userName,
				...(options.phoneNumberId
					? { phoneNumberId: options.phoneNumberId }
					: {}),
			},
		});
		await client.connect();
		this.writeConnectorState(statePath, {
			instanceKey,
			userName: options.userName,
			phoneNumberId: options.phoneNumberId,
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
			thread: Thread<WhatsAppThreadState>,
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
							getConnectorSystemPrompt("WhatsApp"),
						clientId,
						logger: loggerAdapter,
						transport: "whatsapp",
						botUserName: options.userName,
						requestStop,
						bindingsPath,
						hookCommand: options.hookCommand,
						systemRules: WHATSAPP_SYSTEM_RULES,
						errorLabel: "WhatsApp",
						firstContactMessage: WHATSAPP_FIRST_CONTACT_MESSAGE,
						userInstructionService,
						chatCommandHost,
						activeTurns,
						enqueueTurn,
						turnKey: queueKey,
						getSessionMetadata: (currentThread, _clientId, currentState) => ({
							userName: options.userName,
							phoneNumberId: options.phoneNumberId,
							whatsappThreadId: currentThread.id,
							whatsappChannelId: currentThread.channelId,
							...(currentState.participantKey
								? { whatsappParticipantKey: currentState.participantKey }
								: {}),
							...(currentState.participantLabel
								? { whatsappParticipantLabel: currentState.participantLabel }
								: {}),
						}),
						reusedLogMessage: "WhatsApp 线程复用 RPC 会话",
						startedLogMessage: "WhatsApp 线程已启动 RPC 会话",
						onMessageReceived: async (details) => {
							await dispatchConnectorHook(
								options.hookCommand,
								{
									adapter: "whatsapp",
									botUserName: options.userName,
									event: "message.received",
									payload: details,
									ts: new Date().toISOString(),
								},
								loggerAdapter,
							);
						},
						onReplyCompleted: async (result) => {
							await dispatchConnectorHook(
								options.hookCommand,
								{
									adapter: "whatsapp",
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
									adapter: "whatsapp",
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
					await thread.post(`WhatsApp 桥接错误：${message}`);
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
			await persistWhatsAppThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "WhatsApp",
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text: message.text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "已被 WhatsApp 用户拒绝",
				})
			) {
				return;
			}
			await handleTurn(thread, message.text);
		});

		bot.onSubscribedMessage(async (thread, message) => {
			await persistWhatsAppThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "WhatsApp",
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text: message.text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "已被 WhatsApp 用户拒绝",
				})
			) {
				return;
			}
			await handleTurn(thread, message.text);
		});

		await bot.initialize();
		const stopTaskUpdateStream =
			startConnectorTaskUpdateRelay<WhatsAppThreadState>({
				client,
				clientId,
				bot,
				logger: loggerAdapter,
				bindingsPath,
				transport: "whatsapp",
			});

		const endpointUrl = `${options.baseUrl.replace(/\/$/, "")}/api/webhooks/whatsapp`;
		const server = await startConnectorWebhookServer({
			host: options.host,
			port: options.port,
			routes: {
				"/api/webhooks/whatsapp": async (request) =>
					whatsapp.handleWebhook(request),
				"/health": () => new Response("ok"),
				"/": () =>
					new Response(
						[
							"WhatsApp 连接器正在运行。",
							`Webhook URL：${endpointUrl}`,
						].join("\n"),
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
						options,
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

		io.writeln(`[whatsapp] 正在监听 ${options.host}:${options.port}`);
		io.writeln(`[whatsapp] 配置 WhatsApp webhook URL：${endpointUrl}`);

		await stopPromise;
		clearBindingSessionIds<WhatsAppThreadState>(bindingsPath);
		stopTaskUpdateStream();
		stopEventStream();
		await server.close();
		userInstructionService.stop();
		client.close();
		this.removeStateFile(statePath);
		return 0;
	}
}

export const whatsappConnector: ConnectCommandDefinition =
	new WhatsAppConnector();

export const __test__ = {
	findBindingForThread: (
		bindings: ConnectorBindingStore<WhatsAppThreadState>,
		thread: Pick<Thread<WhatsAppThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
		},
	) => findBindingForThread(bindings, thread),
};
