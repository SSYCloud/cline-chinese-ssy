import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import type { ChatStartSessionRequest } from "@cline/core";
import {
	createUserInstructionConfigService,
	HubSessionClient,
} from "@cline/core";
import type { ConnectSlackOptions, SlackConnectorState } from "@cline/shared";
import {
	type Adapter,
	Chat,
	ConsoleLogger,
	type Message,
	type Thread,
	ThreadImpl,
} from "chat";
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
import { CONNECT_ALREADY_RUNNING_EXIT_CODE, isProcessRunning } from "../common";
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
import { FileStateAdapter } from "../stores/file-state";
import { startConnectorTaskUpdateRelay } from "../task-updates";
import {
	type ConnectorBindingStore,
	type ConnectorThreadBinding,
	type ConnectorThreadState,
	clearBindingSessionIds,
	findBindingForDeliveryTarget,
	findBindingForThread,
	loadThreadState,
	persistMergedThreadState,
	readBindings,
	resolveThreadTurnQueueKey,
	writeBindings,
} from "../thread-bindings";
import type {
	ConnectCommandDefinition,
	ConnectIo,
	ConnectRunContext,
	ConnectStopResult,
} from "../types";
import { getConnectorSystemPrompt, getConnectorSystemRules } from "./prompts";

const SLACK_SYSTEM_RULES = getConnectorSystemRules(
	"Slack",
	"You can respond to user messages in threads and DMs, and you can use tools according to user's requests and your capabilities.",
);

type SlackThreadState = ConnectorThreadState & {
	teamId?: string;
};

type SlackConnectionMode = ConnectSlackOptions["connectionMode"];

function inferSlackConnectionMode(
	baseUrl: string | undefined,
): SlackConnectionMode {
	return baseUrl?.trim() ? "webhook" : "socket";
}

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

function sanitizeKey(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function stopSessionsForUser(
	state: SlackConnectorState,
): Promise<number> {
	return stopConnectorSessions({
		rpcAddress: state.rpcAddress,
		rpcMatcher: (metadata) =>
			metadata?.transport === "slack" && metadata?.userName === state.userName,
		localMatcher: (metadata) =>
			metadata?.transport === "slack" && metadata?.userName === state.userName,
	});
}

async function buildSlackStartRequest(
	options: ConnectSlackOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<ChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options,
		io,
		loggerConfig,
		systemRules: SLACK_SYSTEM_RULES,
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

function normalizeSlackMessageEventChannelType<T>(event: T): T {
	const record = asRecord(event);
	const channel = readString(record?.channel);
	if (!channel?.startsWith("D") || record?.channel_type === "im") {
		return event;
	}
	return {
		...record,
		channel_type: "im",
	} as T;
}

function buildSlackParticipantKey(teamId: string, userId: string): string {
	return `slack:team:${teamId}:user:${userId}`;
}

function resolveSlackParticipant(
	rawMessage: unknown,
	teamId?: string,
): { key: string; label?: string } | undefined {
	const raw = asRecord(rawMessage);
	const event = asRecord(raw?.event);
	const message = asRecord(raw?.message);
	const user =
		readString(raw?.user) ||
		readString(event?.user) ||
		readString(message?.user) ||
		readString(firstRecord(raw?.authorizations)?.user_id);
	const username =
		readString(raw?.username) ||
		readString(event?.username) ||
		readString(message?.username);
	const label = username || user;
	if (!user || !teamId?.trim()) {
		return undefined;
	}
	return {
		key: buildSlackParticipantKey(teamId.trim(), user),
		label,
	};
}

function extractSlackTeamId(raw: unknown): string | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	const value =
		typeof record.team_id === "string"
			? record.team_id
			: typeof record.team === "string"
				? record.team
				: undefined;
	return value?.trim() || undefined;
}

function extractSlackMessageRecord(
	raw: unknown,
): Record<string, unknown> | undefined {
	const record = asRecord(raw);
	return asRecord(record?.event) ?? asRecord(record?.message) ?? record;
}

function extractSlackChannelFromId(id: string): string | undefined {
	const parts = id.split(":");
	return parts[0] === "slack" ? readString(parts[1]) : undefined;
}

/**
 * Slack delivers `@cline hi` as `<@U0B8E8H3U1F> hi`, and the chat SDK
 * deliberately leaves the bot's own mention unresolved (so mention detection
 * keeps working), flattening it to `@U0B8E8H3U1F hi`. Strip that leading
 * self-mention so the agent receives `hi`.
 *
 * Only leading mentions of the bot itself are removed; mentions of other users
 * (already resolved to `@display-name`) and inline mentions are preserved so
 * the agent still sees who was addressed. A bare mention with no other content
 * is left untouched so the turn still reaches the agent instead of being
 * dropped as empty input.
 */
function stripSlackBotMention(
	text: string,
	botUserId: string | undefined,
): string {
	const botId = botUserId?.trim();
	if (!botId || !text) {
		return text;
	}
	const escapedBotId = botId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	// Matches `<@U123>`, `<@U123|name>` and the SDK-flattened `@U123` form,
	// repeated when a user mentions the bot more than once up front.
	//
	// The angle-bracket forms are delimited by `>`, but the flattened form has no
	// closing delimiter, so it needs an explicit boundary. Without one, `@U123`
	// also matches the start of a longer id belonging to someone else, turning
	// `@U1234 help` into `4 help`. Slack ids are uppercase alphanumeric, so a
	// complete mention is one that is not followed by another id character.
	// `\b` cannot express this: ids end in word characters, so `@U123\b` still
	// matches inside `@U1234`.
	const leadingMention = new RegExp(
		`^(?:\\s*(?:<@${escapedBotId}(?:\\|[^<>]*)?>|@${escapedBotId}(?![A-Za-z0-9]))[\\s,:]*)+`,
	);
	const stripped = text.replace(leadingMention, "");
	return stripped.trim() ? stripped.trimStart() : text;
}

/**
 * The adapter exposes the authenticated bot user id (request-scoped in
 * multi-workspace mode). When it is not yet known, fall back to the id Slack
 * reports as the authorized app user on the event envelope.
 */
function resolveSlackBotUserId(
	slack: Pick<SlackAdapter, "botUserId">,
	rawMessage?: unknown,
): string | undefined {
	const raw = asRecord(rawMessage);
	return (
		readString(slack.botUserId) ??
		readString(firstRecord(raw?.authorizations)?.user_id)
	);
}

function resolveSlackChannelMentionThread(
	thread: Thread<SlackThreadState>,
	message: Message,
): Thread<SlackThreadState> {
	if (thread.isDM) {
		return thread;
	}
	const event = extractSlackMessageRecord(message.raw);
	const threadTs = readString(event?.thread_ts) ?? readString(event?.ts);
	if (!threadTs) {
		return thread;
	}
	const channel =
		readString(event?.channel) ??
		extractSlackChannelFromId(thread.id) ??
		extractSlackChannelFromId(thread.channelId);
	if (!channel) {
		return thread;
	}
	const threadId = `slack:${channel}:${threadTs}`;
	const channelId = `slack:${channel}`;
	if (thread.id === threadId && thread.channelId === channelId) {
		return thread;
	}
	return new ThreadImpl<SlackThreadState>({
		adapterName: "slack",
		channelId,
		channelVisibility: thread.channelVisibility,
		currentMessage: message,
		fallbackStreamingPlaceholderText: null,
		id: threadId,
		initialMessage: message,
		isDM: false,
		isSubscribedContext: false,
		streamingUpdateIntervalMs: 500,
	});
}

async function withSlackBindingBotToken<T>(input: {
	slack: Pick<SlackAdapter, "getInstallation" | "withBotToken">;
	binding: ConnectorThreadBinding<SlackThreadState>;
	work: () => Promise<T>;
}): Promise<T> {
	return withSlackTeamBotToken({
		slack: input.slack,
		teamId: input.binding.state?.teamId,
		work: input.work,
	});
}

async function withSlackTeamBotToken<T>(input: {
	slack: Pick<SlackAdapter, "getInstallation" | "withBotToken">;
	teamId?: string;
	work: () => Promise<T>;
}): Promise<T> {
	const teamId = input.teamId?.trim();
	if (!teamId) {
		return input.work();
	}
	const installation = await input.slack.getInstallation(teamId);
	if (!installation?.botToken) {
		return input.work();
	}
	return input.slack.withBotToken(installation.botToken, input.work);
}

function patchSlackMessageEventHandling(slack: SlackAdapter): void {
	const adapter = slack as unknown as {
		handleMessageEvent?: (event: unknown, options?: unknown) => unknown;
	};
	if (typeof adapter.handleMessageEvent !== "function") {
		return;
	}
	const original = adapter.handleMessageEvent.bind(slack);
	adapter.handleMessageEvent = (event, options) =>
		original(normalizeSlackMessageEventChannelType(event), options);
}

function isSlackInvalidThreadTsError(error: unknown): boolean {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "";
	return /\binvalid_thread_ts\b/i.test(message);
}

function clearSlackBinding(
	bindingsPath: string,
	bindingKey: string | undefined,
): boolean {
	const key = bindingKey?.trim();
	if (!key) {
		return false;
	}
	const bindings = readBindings<SlackThreadState>(bindingsPath);
	if (!bindings[key]) {
		return false;
	}
	delete bindings[key];
	writeBindings(bindingsPath, bindings);
	return true;
}

async function persistSlackThreadContext(input: {
	thread: Thread<SlackThreadState>;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	rawMessage: unknown;
	errorLabel: string;
}): Promise<void> {
	const teamId = extractSlackTeamId(input.rawMessage);
	const participant = resolveSlackParticipant(input.rawMessage, teamId);
	if (!teamId) {
		return;
	}
	const currentState = await loadThreadState(
		input.thread,
		input.bindingsPath,
		input.baseStartRequest,
	);
	if (
		currentState.teamId === teamId &&
		currentState.participantKey === participant?.key &&
		currentState.participantLabel === participant?.label
	) {
		return;
	}
	await persistMergedThreadState(
		input.thread,
		input.bindingsPath,
		{
			...currentState,
			teamId: teamId ?? currentState.teamId,
			participantKey: participant?.key ?? currentState.participantKey,
			participantLabel: participant?.label ?? currentState.participantLabel,
		},
		input.errorLabel,
	);
}

async function deliverScheduledResult(input: {
	bot: Chat;
	slack: SlackAdapter;
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
	if (!delivery || delivery.adapter !== "slack") {
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
	const bindings = readBindings<SlackThreadState>(input.bindingsPath);
	const match = findBindingForDeliveryTarget(bindings, {
		bindingKey,
		threadId,
		participantKey,
	});
	const binding = match?.binding;
	const deliveryThreadId = match?.key || threadId || bindingKey;
	if (!binding?.serializedThread) {
		return;
	}
	const thread = JSON.parse(
		binding.serializedThread,
		input.bot.reviver(),
	) as Thread<SlackThreadState>;
	let body = "";
	if (input.status === "success" && input.sessionId) {
		const text = await readSessionReplyText(input.client, input.sessionId);
		body = text?.trim()
			? text
			: `Schedule "${schedule?.name ?? input.scheduleId}" completed, but no assistant reply text was found.`;
	} else {
		body = `Schedule "${schedule?.name ?? input.scheduleId}" ${input.status}.${input.errorMessage ? `\n\n${input.errorMessage}` : ""}`;
	}
	try {
		await withSlackBindingBotToken({
			slack: input.slack,
			binding,
			work: () => thread.post(body).then(() => undefined),
		});
	} catch (error) {
		if (
			isSlackInvalidThreadTsError(error) &&
			clearSlackBinding(input.bindingsPath, deliveryThreadId)
		) {
			input.logger.core.log(
				"在 invalid_thread_ts 后清除了过期的 Slack 绑定",
				{
					severity: "warn",
					transport: "slack",
					threadId: deliveryThreadId,
					scheduleId: input.scheduleId,
					executionId: input.executionId,
				},
			);
		}
		throw error;
	}
}

class SlackConnector extends ConnectorBase<
	ConnectSlackOptions,
	SlackConnectorState
> {
	constructor() {
		super(
			"slack",
			"Slack Webhook/Socket 桥接，以 RPC 运行时会话为后端",
		);
	}

	protected override createCommand(): Command {
		return (
			super
				.createCommand()
				.usage("--base-url <PUBLIC_BASE_URL> [options]")
				.option("--user-name <name>", "Slack 机器人用户名标签")
				.option(
					"--bot-token <token>",
					"单工作区模式的 Slack 机器人令牌",
				)
				.option("--signing-secret <secret>", "Slack 签名密钥")
				.option("--app-token <token>", "Socket 模式的 Slack 应用级令牌")
				.option("--client-id <id>", "Slack OAuth 客户端 ID")
				.option("--client-secret <secret>", "Slack OAuth 客户端密钥")
				.option(
					"--encryption-key <key>",
					"用于加密安装的 Base64 32 字节密钥",
				)
				.option(
					"--installation-key-prefix <prefix>",
					"覆盖已存储的安装密钥前缀",
				)
				.option("--provider <id>", "覆盖提供商")
				.option("--model <id>", "覆盖模型")
				.option("--api-key <key>", "覆盖提供商 API 密钥")
				.option("--system <prompt>", "覆盖系统提示词")
				.option("--cwd <path>", "运行时的工作区 / cwd")
				.option("--mode <act|plan>", "代理模式", "act")
				.option("-i, --interactive", "保持连接器在前台运行")
				.option("--no-tools", "为 Slack 会话禁用工具")
				// 保留以便现有调用和已持久化的自动启动参数
				// 继续正常解析；除非传入 --no-tools，否则工具始终开启。
				.option("--enable-tools", "启用工具（默认）")
				.option(
					"--hook-command <command>",
					"为连接器事件运行一条 shell 命令",
				)
				.option(
					"--rpc-address <host:port>",
					"RPC 地址",
					process.env.CLINE_RPC_ADDRESS?.trim() ||
						resolveDefaultCliRpcAddress(),
				)
				.option("--host <host>", "Webhook 监听主机")
				.option("--port <port>", "Webhook 监听端口")
				.option(
					"--base-url <url>",
					"Webhook 和 OAuth 回调的公共基础 URL",
				)
				.addHelpText(
					"after",
					[
						"",
						"环境变量：",
						"  SLACK_BOT_TOKEN             单工作区机器人令牌",
						"  SLACK_SIGNING_SECRET        Slack 签名密钥",
						"  SLACK_APP_TOKEN             Socket 模式的应用级令牌",
						"  SLACK_CLIENT_ID             OAuth 客户端 ID",
						"  SLACK_CLIENT_SECRET         OAuth 客户端密钥",
						"  SLACK_ENCRYPTION_KEY        可选的安装加密密钥",
					].join("\n"),
				)
		);
	}

	protected override readOptions(command: Command): ConnectSlackOptions {
		const opts = command.opts<{
			userName?: string;
			botToken?: string;
			signingSecret?: string;
			appToken?: string;
			clientId?: string;
			clientSecret?: string;
			encryptionKey?: string;
			installationKeyPrefix?: string;
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
		const baseUrl = opts.baseUrl?.trim() || process.env.BASE_URL?.trim();
		const connectionMode = inferSlackConnectionMode(baseUrl);
		const isSocketMode = connectionMode === "socket";
		if (isSocketMode && (opts.clientId?.trim() || opts.clientSecret?.trim())) {
			throw new Error(
				"Slack Socket 模式不支持 --client-id 或 --client-secret",
			);
		}
		const botToken =
			opts.botToken?.trim() || process.env.SLACK_BOT_TOKEN?.trim();
		const appToken = isSocketMode
			? opts.appToken?.trim() || process.env.SLACK_APP_TOKEN?.trim()
			: undefined;
		if (isSocketMode && !appToken) {
			throw new Error(
				"Slack Socket 模式需要 --app-token 或 SLACK_APP_TOKEN",
			);
		}
		if (isSocketMode && !botToken) {
			throw new Error(
				"Slack Socket 模式需要 --bot-token 或 SLACK_BOT_TOKEN",
			);
		}
		return {
			userName:
				opts.userName?.trim() ||
				process.env.SLACK_BOT_USERNAME?.trim() ||
				"cline-slack",
			connectionMode,
			botToken,
			signingSecret:
				connectionMode === "webhook"
					? opts.signingSecret?.trim() ||
						process.env.SLACK_SIGNING_SECRET?.trim()
					: opts.signingSecret?.trim(),
			appToken,
			clientId:
				connectionMode === "webhook"
					? opts.clientId?.trim() || process.env.SLACK_CLIENT_ID?.trim()
					: undefined,
			clientSecret:
				connectionMode === "webhook"
					? opts.clientSecret?.trim() || process.env.SLACK_CLIENT_SECRET?.trim()
					: undefined,
			encryptionKey:
				opts.encryptionKey?.trim() || process.env.SLACK_ENCRYPTION_KEY?.trim(),
			installationKeyPrefix:
				opts.installationKeyPrefix?.trim() ||
				process.env.SLACK_INSTALLATION_KEY_PREFIX?.trim(),
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
			baseUrl,
		};
	}

	private resolveConnectorStatePath(userName: string): string {
		return this.resolveConnectorPath(`${sanitizeKey(userName)}.json`);
	}

	private resolveBindingsPath(userName: string): string {
		return this.resolveConnectorPath(`${sanitizeKey(userName)}.threads.json`);
	}

	private resolveStateStorePath(userName: string): string {
		return this.resolveConnectorPath(`${sanitizeKey(userName)}.state.json`);
	}

	private listConnectorStatePaths(): string[] {
		return this.listJsonStatePaths([".threads.json", ".state.json"]);
	}

	private readConnectorState(
		statePath: string,
	): SlackConnectorState | undefined {
		return this.readStateFile(
			statePath,
			(value): value is SlackConnectorState =>
				Boolean(
					value &&
						typeof value === "object" &&
						// claimId is optional: state files written by older CLI
						// versions predate claiming and must stay manageable
						// (already-running detection, status, stop).
						typeof (value as SlackConnectorState).pid === "number" &&
						typeof (value as SlackConnectorState).userName === "string",
				),
		);
	}

	private writeConnectorState(
		statePath: string,
		state: SlackConnectorState,
	): void {
		this.writeStateFile(statePath, state);
	}

	private async stopSlackConnectorInstance(
		statePath: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return this.stopManagedProcess({
			io,
			statePath,
			readState: (path) => this.readConnectorState(path),
			describeStoppedProcess: (state) =>
				`[slack] 已停止 pid=${state.pid} user=${state.userName}`,
			getPid: (state) => state.pid,
			stopSessions: stopSessionsForUser,
			clearBindings: (state) => {
				clearBindingSessionIds<SlackThreadState>(
					this.resolveBindingsPath(state.userName),
				);
			},
		});
	}

	override async stopAll(io: ConnectIo): Promise<ConnectStopResult> {
		return this.stopAllFromStatePaths(
			io,
			this.listConnectorStatePaths(),
			(statePath, stopIo) => this.stopSlackConnectorInstance(statePath, stopIo),
		);
	}

	override async stopInstance(
		instanceId: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return await this.stopSlackConnectorInstance(
			this.resolveConnectorStatePath(instanceId),
			io,
		);
	}

	protected override instanceIdFromOptions(
		options: ConnectSlackOptions,
	): string | undefined {
		return options.userName;
	}

	protected override async runWithOptions(
		options: ConnectSlackOptions,
		rawArgs: string[],
		io: ConnectIo,
		context: ConnectRunContext,
	): Promise<number> {
		context.setPersistenceInstanceId(options.userName);
		const statePath = this.resolveConnectorStatePath(options.userName);
		const bindingsPath = this.resolveBindingsPath(options.userName);
		const stateStorePath = this.resolveStateStorePath(options.userName);
		const existingState = this.readConnectorState(statePath);
		const staleState =
			existingState && !isProcessRunning(existingState.pid)
				? existingState
				: undefined;
		if (staleState) {
			clearBindingSessionIds<SlackThreadState>(bindingsPath);
		}
		const formatAlreadyRunning = (state: SlackConnectorState) =>
			state.connectionMode === "socket"
				? `[slack] 连接器已在运行 pid=${state.pid} rpc=${state.rpcAddress} mode=socket`
				: `[slack] 连接器已在运行 pid=${state.pid} rpc=${state.rpcAddress} url=${state.baseUrl}`;
		const backgroundExitCode = await this.maybeRunInBackground({
			rawArgs,
			io,
			interactive: options.interactive,
			childEnvVar: "CLINE_SLACK_CONNECT_CHILD",
			statePath,
			readState: (path) => this.readConnectorState(path),
			isRunning: (state) => isProcessRunning(state.pid),
			formatAlreadyRunningMessage: formatAlreadyRunning,
			formatBackgroundStartMessage: (pid) =>
				`[slack] 正在后台启动连接器 pid=${pid} user=${options.userName} mode=${options.connectionMode}`,
			foregroundHint:
				"[slack] 使用 `cline connect slack -i ...` 在前台运行",
			launchFailureMessage: "无法在后台启动 Slack 连接器",
		});
		if (backgroundExitCode !== undefined) {
			return backgroundExitCode;
		}

		// Foreground / detached-child path: exclusively claim the instance before
		// opening Slack socket-mode so a second process cannot share the token.
		const startedAt = new Date().toISOString();
		const claim = this.claimConnectorInstance({
			statePath,
			createState: (claimId) => ({
				claimId,
				userName: options.userName,
				connectionMode: options.connectionMode,
				pid: process.pid,
				rpcAddress: "pending",
				startedAt,
				...(options.connectionMode === "webhook"
					? { port: options.port, baseUrl: options.baseUrl }
					: {}),
			}),
			readState: (path) => this.readConnectorState(path),
			getPid: (state) => state.pid,
		});
		if (!claim.claimed) {
			io.writeln(
				claim.running
					? formatAlreadyRunning(claim.running)
					: `[slack] 连接器已在运行 user=${options.userName}`,
			);
			return CONNECT_ALREADY_RUNNING_EXIT_CODE;
		}

		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "slack-connect",
		});
		const logger = createChatSdkLogger(loggerAdapter);
		const consoleLogger = new ConsoleLogger("info", "slack-connect");
		const slackConfig: Record<string, unknown> = {
			logger: consoleLogger,
			mode: options.connectionMode,
			userName: options.userName,
		};
		if (options.botToken?.trim()) {
			slackConfig.botToken = options.botToken.trim();
		}
		if (options.signingSecret?.trim()) {
			slackConfig.signingSecret = options.signingSecret.trim();
		}
		if (options.appToken?.trim()) {
			slackConfig.appToken = options.appToken.trim();
		}
		if (options.clientId?.trim()) {
			slackConfig.clientId = options.clientId.trim();
		}
		if (options.clientSecret?.trim()) {
			slackConfig.clientSecret = options.clientSecret.trim();
		}
		if (options.encryptionKey?.trim()) {
			slackConfig.encryptionKey = options.encryptionKey.trim();
		}
		if (options.installationKeyPrefix?.trim()) {
			slackConfig.installationKeyPrefix = options.installationKeyPrefix.trim();
		}
		const slack = createSlackAdapter(slackConfig) as SlackAdapter;
		patchSlackMessageEventHandling(slack);
		const bot = new Chat({
			userName: options.userName,
			adapters: { slack: slack as unknown as Adapter },
			state: new FileStateAdapter(stateStorePath),
			logger,
			fallbackStreamingPlaceholderText: null,
			streamingUpdateIntervalMs: 500,
		}).registerSingleton();
		const threadQueues = new Map<string, Promise<void>>();
		const activeTurns = new Map<string, ActiveConnectorTurn>();
		const pendingApprovals = new Map<string, PendingConnectorApproval>();
		const startRequest = await buildSlackStartRequest(options, io, {
			enabled: loggerAdapter.runtimeConfig.enabled,
			level: loggerAdapter.runtimeConfig.level,
			destination: loggerAdapter.runtimeConfig.destination,
			bindings: {
				transport: "slack",
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

		const clientId = `slack-${process.pid}-${Date.now()}`;
		const client = new HubSessionClient({
			address: rpcAddress,
			authToken: rpcAuthToken,
			clientId,
			clientType: "cli",
			displayName: "slack connector",
			workspaceRoot: startRequest.workspaceRoot || startRequest.cwd,
			cwd: startRequest.cwd,
			metadata: {
				transport: "slack",
				userName: options.userName,
			},
		});
		await client.connect();
		this.writeConnectorState(statePath, {
			claimId: claim.claimId,
			userName: options.userName,
			connectionMode: options.connectionMode,
			pid: process.pid,
			rpcAddress,
			...(options.connectionMode === "webhook"
				? { port: options.port, baseUrl: options.baseUrl }
				: {}),
			startedAt,
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
			thread: Thread<SlackThreadState>,
			text: string,
		) => {
			const currentState = await loadThreadState(
				thread,
				bindingsPath,
				startRequest,
			);
			const queueKey = resolveThreadTurnQueueKey(thread);
			const enqueueTurn = (work: () => Promise<void>) =>
				enqueueThreadTurn(threadQueues, queueKey, work);
			const runTurn = async () => {
				try {
					await withSlackTeamBotToken({
						slack,
						teamId: currentState.teamId,
						work: async () =>
							handleConnectorUserTurn({
								thread,
								text,
								client,
								pendingApprovals,
								baseStartRequest: startRequest,
								explicitSystemPrompt:
									options.systemPrompt?.trim() ||
									getConnectorSystemPrompt("slack"),
								clientId,
								logger: loggerAdapter,
								transport: "slack",
								botUserName: options.userName,
								requestStop,
								bindingsPath,
								hookCommand: options.hookCommand,
								systemRules: SLACK_SYSTEM_RULES,
								errorLabel: "Slack",
								userInstructionService,
								chatCommandHost,
								activeTurns,
								enqueueTurn,
								turnKey: queueKey,
								getSessionMetadata: (
									currentThread,
									_clientId,
									currentState,
								) => ({
									userName: options.userName,
									slackThreadId: currentThread.id,
									slackChannelId: currentThread.channelId,
									...(currentState.participantKey
										? { slackParticipantKey: currentState.participantKey }
										: {}),
									...(currentState.participantLabel
										? { slackParticipantLabel: currentState.participantLabel }
										: {}),
								}),
								reusedLogMessage: "Slack 线程正在复用 RPC 会话",
								startedLogMessage: "Slack 线程已启动 RPC 会话",
								onMessageReceived: async (details) => {
									await dispatchConnectorHook(
										options.hookCommand,
										{
											adapter: "slack",
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
											adapter: "slack",
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
											adapter: "slack",
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
							}),
					});
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					await withSlackTeamBotToken({
						slack,
						teamId: currentState.teamId,
						work: () => thread.post(`Slack 桥接错误：${message}`),
					});
				}
			};
			if (activeTurns.has(queueKey)) {
				await runTurn();
				return;
			}
			await enqueueTurn(runTurn);
		};

		bot.onNewMention(async (thread, message) => {
			const mentionThread = resolveSlackChannelMentionThread(thread, message);
			await mentionThread.subscribe();
			await persistSlackThreadContext({
				thread: mentionThread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Slack",
			});
			const text = stripSlackBotMention(
				message.text,
				resolveSlackBotUserId(slack, message.raw),
			);
			if (
				await maybeHandleConnectorApprovalReply({
					thread: mentionThread,
					text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "Slack 用户拒绝",
				})
			) {
				return;
			}
			await handleTurn(mentionThread, text);
		});

		bot.onSubscribedMessage(async (thread, message) => {
			await persistSlackThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Slack",
			});
			const text = stripSlackBotMention(
				message.text,
				resolveSlackBotUserId(slack, message.raw),
			);
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "Slack 用户拒绝",
				})
			) {
				return;
			}
			await handleTurn(thread, text);
		});

		bot.onSlashCommand(async (event) => {
			const commandText = [event.command.trim(), event.text.trim()]
				.filter(Boolean)
				.join(" ");
			const rootMessage = await event.channel.post(
				`${event.user.fullName} 调用了 ${commandText}`,
			);
			const thread = new ThreadImpl<SlackThreadState>({
				adapterName: "slack",
				channelId: event.channel.id,
				id: rootMessage.threadId,
				isDM: event.channel.isDM,
				isSubscribedContext: true,
			});
			await thread.subscribe();
			await persistSlackThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: event.raw,
				errorLabel: "Slack",
			});
			await handleTurn(thread, commandText);
		});

		await bot.initialize();
		const stopTaskUpdateStream =
			startConnectorTaskUpdateRelay<SlackThreadState>({
				client,
				clientId,
				bot,
				logger: loggerAdapter,
				bindingsPath,
				transport: "slack",
				postToThread: async ({ thread, binding, body, threadId }) => {
					try {
						await withSlackBindingBotToken({
							slack,
							binding,
							work: () => thread.post(body).then(() => undefined),
						});
					} catch (error) {
						if (
							isSlackInvalidThreadTsError(error) &&
							clearSlackBinding(bindingsPath, threadId)
						) {
							loggerAdapter.core.log(
								"在 invalid_thread_ts 后清除了过期的 Slack 绑定",
								{
									severity: "warn",
									transport: "slack",
									threadId,
								},
							);
						}
						throw error;
					}
				},
			});

		let webhookUrl: string | undefined;
		let oauthCallbackUrl: string | undefined;
		const server =
			options.connectionMode === "webhook"
				? await (async () => {
						const baseUrl = options.baseUrl?.trim();
						if (!baseUrl) {
							throw new Error(
								"Slack webhook mode requires --base-url or BASE_URL",
							);
						}
						webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/webhooks/slack`;
						oauthCallbackUrl = `${baseUrl.replace(/\/$/, "")}/api/oauth/slack/callback`;
						return startConnectorWebhookServer({
							host: options.host,
							port: options.port,
							routes: {
								"/api/webhooks/slack": async (request) =>
									bot.webhooks.slack(request),
								"/api/oauth/slack/callback": async (request) => {
									try {
										const result = await slack.handleOAuthCallback(request);
										return new Response(
											`Slack 安装已存储到团队 ${result.teamId}。你可以返回 Slack。`,
										);
									} catch (error) {
										const message =
											error instanceof Error ? error.message : String(error);
										loggerAdapter.core.log("Slack OAuth 回调失败", {
											severity: "warn",
											transport: "slack",
											error: message,
										});
										return new Response(`Slack OAuth 错误：${message}`, {
											status: 500,
										});
									}
								},
								"/health": () => new Response("ok"),
								"/": () =>
									new Response(
										[
											"Slack 连接器正在运行。",
											"连接模式：webhook",
											`Webhook URL：${webhookUrl}`,
											`OAuth 回调 URL：${oauthCallbackUrl}`,
											options.botToken?.trim()
												? "认证模式：单工作区"
												: options.clientId?.trim() &&
														options.clientSecret?.trim()
													? "认证模式：多工作区 OAuth"
													: "认证模式：不完整（请设置机器人令牌或 OAuth 凭据）",
										].join("\n"),
									),
							},
						});
					})()
				: undefined;

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
						slack,
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

		if (options.connectionMode === "webhook") {
			io.writeln(`[slack] 正在监听 ${options.host}:${options.port}`);
			io.writeln(`[slack] 配置 Slack Webhook URL：${webhookUrl}`);
			io.writeln(
				`[slack] 配置 Slack OAuth 回调 URL：${oauthCallbackUrl}`,
			);
		} else {
			io.writeln("[slack] Socket 模式已连接");
		}

		await stopPromise;
		clearBindingSessionIds<SlackThreadState>(bindingsPath);
		stopTaskUpdateStream();
		stopEventStream();
		await server?.close();
		await bot.shutdown();
		userInstructionService.stop();
		client.close();
		this.removeStateFile(statePath);
		return 0;
	}
}

export const slackConnector: ConnectCommandDefinition = new SlackConnector();

export const __test__ = {
	inferSlackConnectionMode,
	buildSlackParticipantKey,
	resolveSlackParticipant,
	normalizeSlackMessageEventChannelType,
	resolveSlackBotUserId,
	resolveSlackChannelMentionThread,
	stripSlackBotMention,
	withSlackTeamBotToken,
	isSlackInvalidThreadTsError,
	findBindingForThread: (
		bindings: ConnectorBindingStore<SlackThreadState>,
		thread: Pick<Thread<SlackThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
		},
	) => findBindingForThread(bindings, thread),
};
