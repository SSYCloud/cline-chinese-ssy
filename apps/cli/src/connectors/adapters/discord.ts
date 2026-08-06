import {
	createDiscordAdapter,
	type DiscordAdapter,
} from "@chat-adapter/discord";
// TODO: Remove the root Undici 6 override when discord.js no longer requires Undici ^6.27.0.
import type { ChatStartSessionRequest } from "@cline/core";
import {
	createUserInstructionConfigService,
	HubSessionClient,
} from "@cline/core";
import type {
	ConnectDiscordOptions,
	DiscordConnectorState,
} from "@cline/shared";
import { Chat, ConsoleLogger, type Thread, ThreadImpl } from "chat";
import type { Command } from "commander";
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
	readSessionMessageCount,
	readSessionReplyText,
	stopConnectorSessions,
} from "../session-runtime";
import { InMemoryStateAdapter } from "../stores/memory-state";
import { startConnectorTaskUpdateRelay } from "../task-updates";
import {
	type ConnectorBindingStore,
	type ConnectorMuteTarget,
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

const DISCORD_SYSTEM_RULES = getConnectorSystemRules(
	"Discord",
	[
		"你可以在 Discord 线程、频道和私信中回复，并且可以根据用户的请求和你的能力使用工具。",
		"当被要求按名称提及某个 Discord 用户或机器人时，请将提及写为 @display-name 或 @username。连接器会在发送前将唯一的服务器名称解析为 Discord 提及 ID。除非名称无法解析，否则不要向用户索要 Discord ID。",
		"即使消息并非针对你，Discord 订阅线程的消息也可能到达。请检查 <discord_message_context>：当 isDirectMention 为 false 且消息属于不需要你参与的其他用户或机器人对话时，请仅回复 /idle，不要回复其他内容。连接器会将 /idle 视为私有空操作，不会将其发布到 Discord。",
		"如果此 Discord 线程陷入机器人循环，或用户希望连接器停止处理此线程，请告诉他们：在共享频道中发送 /mute@BotName，或在私信中发送 /mute。当用户希望连接器恢复处理此线程时，请告诉他们在共享频道中发送 /unmute@BotName，或在私信中发送 /unmute。",
		"如果用户只想在当前线程中屏蔽单个 Discord 用户或机器人，请告诉他们在共享频道中发送 /mute@BotName @user-or-bot，或在私信中发送 /mute @user-or-bot。要恢复处理该参与者，请告诉他们在共享频道中发送 /unmute@BotName @user-or-bot，或在私信中发送 /unmute @user-or-bot。",
	].join("\n"),
);

const DISCORD_FIRST_CONTACT_MESSAGE = getConnectorFirstContactMessage();
const DISCORD_GATEWAY_DURATION_MS = 1_800_000_000;

type DiscordThreadState = ConnectorThreadState;
type DiscordParticipant = { key: string; label?: string };
type DiscordMessageIdentity = { author?: unknown; raw?: unknown };
type DiscordThreadIdParts = {
	guildId?: string;
	channelId?: string;
	threadId?: string;
};
type DiscordForwardedGatewayEvent = {
	type?: string;
	data?: unknown;
};
type DiscordGuildMemberResponse = {
	roles?: unknown;
};
type DiscordGuildMember = {
	nick?: string;
	user?: {
		id?: string;
		username?: string;
		global_name?: string | null;
		bot?: boolean;
	};
};

const botGuildRoleCache = new Map<string, Promise<Set<string>>>();

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

async function stopSessionsForApplication(
	state: DiscordConnectorState,
): Promise<number> {
	return stopConnectorSessions({
		rpcAddress: state.rpcAddress,
		rpcMatcher: (metadata) =>
			metadata?.transport === "discord" &&
			metadata?.applicationId === state.applicationId,
		localMatcher: (metadata) =>
			metadata?.transport === "discord" &&
			metadata?.applicationId === state.applicationId,
	});
}

async function buildDiscordStartRequest(
	options: ConnectDiscordOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<ChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options,
		io,
		loggerConfig,
		systemRules: DISCORD_SYSTEM_RULES,
	});
}

async function createDiscordEmptyRuntimeReplyResolver(input: {
	client: HubSessionClient;
	sessionId: string;
}): Promise<(() => Promise<string | undefined>) | undefined> {
	const minMessageIndex = await readSessionMessageCount(
		input.client,
		input.sessionId,
	);
	if (minMessageIndex === undefined) {
		return async () => undefined;
	}
	return () =>
		readSessionReplyText(input.client, input.sessionId, {
			minMessageIndex,
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

function readIdentifier(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	return undefined;
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function normalizeDiscordLookupName(value: string | undefined): string {
	return (value ?? "").trim().replace(/^@+/, "").toLowerCase();
}

function resolveDiscordParticipantFromAuthor(
	author: unknown,
): DiscordParticipant | undefined {
	const record = asRecord(author);
	const userId =
		readIdentifier(record?.userId) ||
		readIdentifier(record?.id) ||
		readIdentifier(record?.user_id);
	const username =
		readString(record?.userName) ||
		readString(record?.username) ||
		readString(record?.name);
	const label =
		readString(record?.fullName) ||
		readString(record?.global_name) ||
		readString(record?.displayName) ||
		readString(record?.display_name) ||
		username ||
		userId;
	if (!userId) {
		return undefined;
	}
	return { key: `discord:user:${userId}`, label };
}

function resolveDiscordParticipant(
	rawMessage: unknown,
	messageAuthor?: unknown,
): DiscordParticipant | undefined {
	const normalized = resolveDiscordParticipantFromAuthor(messageAuthor);
	if (normalized) {
		return normalized;
	}
	const raw = asRecord(rawMessage);
	const data = asRecord(raw?.data) ?? raw;
	const candidates = [
		asRecord(raw?.author),
		asRecord(asRecord(raw?.member)?.user),
		asRecord(raw?.user),
		asRecord(data?.author),
		asRecord(asRecord(data?.member)?.user),
		asRecord(data?.user),
		asRecord(asRecord(raw?.message)?.author),
		asRecord(asRecord(data?.message)?.author),
	];
	for (const candidate of candidates) {
		const participant = resolveDiscordParticipantFromAuthor(candidate);
		if (participant) {
			return participant;
		}
	}
	return undefined;
}

function formatDiscordRuntimeText(
	text: string,
	participant: DiscordParticipant | undefined,
	options?: {
		ownerUserId?: string;
		isDirectMention?: boolean;
		isSubscribedThreadMessage?: boolean;
	},
): string {
	if (!participant) {
		return text;
	}
	const authorId = participant.key.replace(/^discord:user:/, "");
	return [
		"<discord_message_context>",
		`authorId: ${authorId}`,
		...(participant.label ? [`authorLabel: ${participant.label}`] : []),
		`participantKey: ${participant.key}`,
		...(options?.isDirectMention === undefined
			? []
			: [`isDirectMention: ${options.isDirectMention ? "true" : "false"}`]),
		...(options?.isSubscribedThreadMessage === undefined
			? []
			: [
					`isSubscribedThreadMessage: ${options.isSubscribedThreadMessage ? "true" : "false"}`,
				]),
		...(options?.ownerUserId && options.ownerUserId === authorId
			? ["isOwner: true"]
			: []),
		"</discord_message_context>",
		"",
		text,
	].join("\n");
}

function resolveDiscordMuteTarget(
	rawTarget: string,
): ConnectorMuteTarget | undefined {
	const trimmed = rawTarget.trim();
	const userId =
		trimmed.match(/^<@!?(\d{15,25})>$/)?.[1] ??
		trimmed.match(/^@?(\d{15,25})$/)?.[1];
	if (!userId) {
		return undefined;
	}
	return {
		participantKey: `discord:user:${userId}`,
		participantLabel: `<@${userId}>`,
	};
}

function decodeDiscordThreadId(threadId: string): DiscordThreadIdParts {
	const parts = threadId.split(":");
	if (parts.length < 3 || parts[0] !== "discord") {
		return {};
	}
	return {
		guildId: parts[1],
		channelId: parts[2],
		threadId: parts[3],
	};
}

async function readDiscordBotGuildRoleIds(input: {
	botToken: string;
	guildId: string;
	applicationId: string;
}): Promise<Set<string>> {
	const cacheKey = `${input.guildId}:${input.applicationId}`;
	const cached = botGuildRoleCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const pending = fetchDiscordJson({
		botToken: input.botToken,
		path: `/guilds/${encodeURIComponent(input.guildId)}/members/${encodeURIComponent(input.applicationId)}`,
	}).then(
		(value) => {
			const member = value as DiscordGuildMemberResponse;
			return new Set(readStringArray(member.roles));
		},
		() => {
			botGuildRoleCache.delete(cacheKey);
			return new Set<string>();
		},
	);
	botGuildRoleCache.set(cacheKey, pending);
	return pending;
}

async function normalizeDiscordForwardedGatewayRequest(input: {
	request: Request;
	botToken: string;
	applicationId: string;
}): Promise<Request> {
	let event: DiscordForwardedGatewayEvent | undefined;
	try {
		event = (await input.request
			.clone()
			.json()) as DiscordForwardedGatewayEvent;
	} catch {
		return input.request;
	}
	if (event?.type !== "GATEWAY_MESSAGE_CREATE") {
		return input.request;
	}
	const data = asRecord(event.data);
	const guildId = readIdentifier(data?.guild_id);
	const mentionRoleIds = readStringArray(data?.mention_roles);
	if (!guildId || mentionRoleIds.length === 0 || data?.is_mention === true) {
		return input.request;
	}
	const botRoleIds = await readDiscordBotGuildRoleIds({
		botToken: input.botToken,
		guildId,
		applicationId: input.applicationId,
	});
	const mentionsBotRole = mentionRoleIds.some((roleId) =>
		botRoleIds.has(roleId),
	);
	if (!mentionsBotRole) {
		return input.request;
	}
	const headers = new Headers(input.request.headers);
	headers.set("Content-Type", "application/json");
	return new Request(input.request.url, {
		method: input.request.method,
		headers,
		body: JSON.stringify({
			...event,
			data: {
				...data,
				is_mention: true,
			},
		}),
	});
}

async function logDiscordForwardedGatewayMessage(input: {
	request: Request;
	logger: ConsoleLogger;
	applicationId: string;
}): Promise<void> {
	let event: DiscordForwardedGatewayEvent | undefined;
	try {
		event = (await input.request
			.clone()
			.json()) as DiscordForwardedGatewayEvent;
	} catch {
		return;
	}
	if (event?.type !== "GATEWAY_MESSAGE_CREATE") {
		return;
	}
	const data = asRecord(event.data);
	const author = asRecord(data?.author);
	const mentions = Array.isArray(data?.mentions)
		? data.mentions
				.map((mention) => readIdentifier(asRecord(mention)?.id))
				.filter(Boolean)
		: [];
	const mentionRoleIds = readStringArray(data?.mention_roles);
	input.logger.info("收到 Discord 转发的 Gateway 消息", {
		channelId: readIdentifier(data?.channel_id),
		guildId: readIdentifier(data?.guild_id) ?? null,
		authorId: readIdentifier(author?.id),
		authorName: readString(author?.username),
		authorIsBot: author?.bot === true,
		isMe: readIdentifier(author?.id) === input.applicationId,
		isMentioned: mentions.includes(input.applicationId),
		isRoleMentioned: data?.is_mention === true,
		mentionIds: mentions,
		mentionRoleIds,
		content: readString(data?.content)?.slice(0, 100) ?? "",
	});
}

async function fetchDiscordJson(input: {
	botToken: string;
	path: string;
	method?: "GET" | "POST";
	body?: unknown;
}): Promise<unknown> {
	const response = await fetch(`https://discord.com/api/v10${input.path}`, {
		method: input.method ?? "GET",
		headers: {
			Authorization: `Bot ${input.botToken}`,
			...(input.body ? { "Content-Type": "application/json" } : {}),
			"User-Agent": "Cline Discord Connector",
		},
		...(input.body ? { body: JSON.stringify(input.body) } : {}),
	});
	if (!response.ok) {
		throw new Error(`Discord API ${response.status}：${await response.text()}`);
	}
	return response.json();
}

async function searchDiscordGuildMembers(input: {
	botToken: string;
	guildId: string;
	query: string;
}): Promise<DiscordGuildMember[]> {
	const query = normalizeDiscordLookupName(input.query);
	if (!query || input.guildId === "@me") {
		return [];
	}
	const parsed = await fetchDiscordJson({
		botToken: input.botToken,
		path: `/guilds/${encodeURIComponent(input.guildId)}/members/search?query=${encodeURIComponent(query)}&limit=10`,
	});
	return Array.isArray(parsed) ? (parsed as DiscordGuildMember[]) : [];
}

function pickDiscordMemberByName(
	members: DiscordGuildMember[],
	query: string,
): DiscordGuildMember | undefined {
	const normalizedQuery = normalizeDiscordLookupName(query);
	const exact = members.filter((member) => {
		const user = member.user;
		return [member.nick, user?.username, user?.global_name ?? undefined].some(
			(name) => normalizeDiscordLookupName(name) === normalizedQuery,
		);
	});
	if (exact.length === 1) {
		return exact[0];
	}
	return undefined;
}

async function resolveDiscordMentionName(input: {
	botToken: string;
	guildId: string | undefined;
	name: string;
}): Promise<string | undefined> {
	if (!input.guildId || input.guildId === "@me") {
		return undefined;
	}
	const members = await searchDiscordGuildMembers({
		botToken: input.botToken,
		guildId: input.guildId,
		query: input.name,
	}).catch(() => []);
	const match = pickDiscordMemberByName(members, input.name);
	const id = readIdentifier(match?.user?.id);
	return id ? `<@${id}>` : undefined;
}

async function resolveDiscordOutboundMentions(input: {
	botToken: string;
	threadId: string;
	text: string;
}): Promise<string> {
	const { guildId } = decodeDiscordThreadId(input.threadId);
	if (!guildId || guildId === "@me" || !input.text.includes("@")) {
		return input.text;
	}
	const mentionPattern =
		/(^|[\s([{])(?:@([A-Za-z0-9_.-]{2,64})|<@([A-Za-z0-9_]{2,64})>((?:-[A-Za-z0-9_.]+)+))(?=$|[\s,.;:!?}\])])/g;
	const replacements = new Map<string, string>();
	for (const match of input.text.matchAll(mentionPattern)) {
		const name = match[2] ?? `${match[3] ?? ""}${match[4] ?? ""}`;
		if (!name || /^\d{15,25}$/.test(name) || replacements.has(name)) {
			continue;
		}
		const mention = await resolveDiscordMentionName({
			botToken: input.botToken,
			guildId,
			name,
		});
		if (mention) {
			replacements.set(name, mention);
		}
	}
	if (replacements.size === 0) {
		return input.text.replace(
			mentionPattern,
			(full, prefix, rawName, base, suffix) => {
				const name = rawName ?? `${base ?? ""}${suffix ?? ""}`;
				return name ? `${prefix}@${name}` : full;
			},
		);
	}
	return input.text.replace(
		mentionPattern,
		(_full, prefix, rawName, base, suffix) => {
			const name = rawName ?? `${base ?? ""}${suffix ?? ""}`;
			const replacement = replacements.get(name);
			return replacement ? `${prefix}${replacement}` : `${prefix}@${name}`;
		},
	);
}

async function postDiscordResolvedText(input: {
	botToken: string;
	thread: Thread<DiscordThreadState>;
	text: string;
}): Promise<void> {
	const resolvedText = await resolveDiscordOutboundMentions({
		botToken: input.botToken,
		threadId: input.thread.id,
		text: input.text,
	});
	const { channelId, threadId } = decodeDiscordThreadId(input.thread.id);
	const targetChannelId = threadId || channelId;
	if (!targetChannelId) {
		await input.thread.post(resolvedText);
		return;
	}
	await fetchDiscordJson({
		botToken: input.botToken,
		path: `/channels/${encodeURIComponent(targetChannelId)}/messages`,
		method: "POST",
		body: {
			content: resolvedText.slice(0, 2000),
			allowed_mentions: { parse: ["users"] },
		},
	});
}

function resolveCurrentStateWithParticipant(input: {
	currentState: DiscordThreadState;
	participant: DiscordParticipant;
}): DiscordThreadState {
	return {
		...input.currentState,
		participantKey: input.participant.key,
		participantLabel: input.participant.label,
	};
}

async function persistDiscordThreadContext(input: {
	thread: Thread<DiscordThreadState>;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	message: DiscordMessageIdentity;
	errorLabel: string;
}): Promise<DiscordParticipant | undefined> {
	const participant = resolveDiscordParticipant(
		input.message.raw,
		input.message.author,
	);
	if (!participant) {
		return undefined;
	}
	const currentState = await loadThreadState(
		input.thread,
		input.bindingsPath,
		input.baseStartRequest,
	);
	const nextState = resolveCurrentStateWithParticipant({
		currentState,
		participant,
	});
	if (
		currentState.participantKey === nextState.participantKey &&
		currentState.participantLabel === nextState.participantLabel &&
		currentState.sessionId === nextState.sessionId
	) {
		return participant;
	}
	await persistMergedThreadState(
		input.thread,
		input.bindingsPath,
		nextState,
		input.errorLabel,
	);
	return participant;
}

async function deliverScheduledResult(input: {
	bot: Chat;
	client: HubSessionClient;
	bindingsPath: string;
	userName: string;
	scheduleId: string;
	sessionId?: string;
	status: string;
	errorMessage?: string;
}): Promise<void> {
	const schedule = await input.client.getSchedule(input.scheduleId);
	const delivery = schedule?.metadata?.delivery as
		| Record<string, unknown>
		| undefined;
	if (!delivery || delivery.adapter !== "discord") {
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
	const bindings = readBindings<DiscordThreadState>(input.bindingsPath);
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
	) as Thread<DiscordThreadState>;
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

function isRestorableThread(
	value: unknown,
): value is Thread<DiscordThreadState> & { subscribe(): Promise<void> } {
	return (
		Boolean(value) &&
		typeof value === "object" &&
		typeof (value as Thread<DiscordThreadState>).id === "string" &&
		typeof (value as Thread<DiscordThreadState>).subscribe === "function"
	);
}

async function restoreDiscordThreadSubscriptions(input: {
	bot: Pick<Chat, "reviver">;
	bindingsPath: string;
	logger: ReturnType<typeof createCliLoggerAdapter>;
}): Promise<number> {
	const bindings = readBindings<DiscordThreadState>(input.bindingsPath);
	const restoredThreadIds = new Set<string>();
	for (const binding of Object.values(bindings)) {
		if (!binding.serializedThread?.trim()) {
			continue;
		}
		try {
			const thread = JSON.parse(
				binding.serializedThread,
				input.bot.reviver(),
			) as unknown;
			if (!isRestorableThread(thread) || restoredThreadIds.has(thread.id)) {
				continue;
			}
			await thread.subscribe();
			restoredThreadIds.add(thread.id);
		} catch (error) {
			input.logger.core.log("恢复 Discord 线程订阅失败", {
				severity: "warn",
				error: error instanceof Error ? error.message : String(error),
				channelId: binding.channelId,
				participantKey: binding.participantKey,
			});
		}
	}
	return restoredThreadIds.size;
}

class DiscordConnector extends ConnectorBase<
	ConnectDiscordOptions,
	DiscordConnectorState
> {
	constructor() {
		super(
			"discord",
			"由 RPC 运行时会话支持的 Discord 交互与网关桥接",
		);
	}

	protected override createCommand(): Command {
		return (
			super
				.createCommand()
				.usage("--base-url <PUBLIC_BASE_URL> [options]")
				.option("--user-name <name>", "Discord 机器人用户名标签")
				.option("--application-id <id>", "Discord 应用 ID")
				.option("--app-id <id>", "--application-id 的别名")
				.option("--bot-token <token>", "Discord 机器人令牌")
				.option("--token <token>", "--bot-token 的别名")
				.option("--public-key <key>", "Discord 应用公钥")
				.option(
					"--owner-user-id <id>",
					"应标记为连接器所有者的 Discord 用户 ID",
				)
				.option(
					"--ignore-bot-authors",
					"忽略来自其他 Discord 机器人的消息",
				)
				.option(
					"--mention-role-ids <ids>",
					"应触发提及处理程序的逗号分隔的角色 ID",
				)
				.option("--provider <id>", "覆盖提供商")
				.option("--model <id>", "覆盖模型")
				.option("--api-key <key>", "覆盖提供商 API 密钥")
				.option("--system <prompt>", "覆盖系统提示词")
				.option("--cwd <path>", "运行时的工作区 / 工作目录")
				.option("--mode <act|plan>", "代理模式", "act")
				.option("-i, --interactive", "保持连接器在前台运行")
				.option("--no-tools", "为 Discord 会话禁用工具")
				// 保留这些选项是为了让现有的调用和持久化的自动启动参数
				// 继续解析；除非传入 --no-tools，否则默认启用工具。
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
				.option(
					"--base-url <url>",
					"Discord 交互 Webhook 的公共基础 URL",
				)
				.addHelpText(
					"after",
					[
						"",
						"环境变量：",
						"  DISCORD_APPLICATION_ID      Discord 应用 ID",
						"  DISCORD_BOT_TOKEN           Discord 机器人令牌",
						"  DISCORD_PUBLIC_KEY          Discord 应用公钥",
						"  DISCORD_OWNER_USER_ID       可选的连接器所有者用户 ID",
						"  DISCORD_IGNORE_BOT_AUTHORS  设为 1 以忽略来自其他机器人的消息",
						"  DISCORD_MENTION_ROLE_IDS    可选的逗号分隔的角色 ID",
					].join("\n"),
				)
		);
	}

	protected override readOptions(command: Command): ConnectDiscordOptions {
		const opts = command.opts<{
			userName?: string;
			applicationId?: string;
			appId?: string;
			botToken?: string;
			token?: string;
			publicKey?: string;
			ownerUserId?: string;
			ignoreBotAuthors?: boolean;
			mentionRoleIds?: string;
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
		const mentionRoleIds = (
			opts.mentionRoleIds?.trim() ||
			process.env.DISCORD_MENTION_ROLE_IDS?.trim() ||
			""
		)
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		return {
			userName:
				opts.userName?.trim() ||
				process.env.DISCORD_BOT_USERNAME?.trim() ||
				"cline-discord",
			applicationId:
				opts.applicationId?.trim() ||
				opts.appId?.trim() ||
				process.env.DISCORD_APPLICATION_ID?.trim() ||
				"",
			botToken:
				opts.botToken?.trim() ||
				opts.token?.trim() ||
				process.env.DISCORD_BOT_TOKEN?.trim() ||
				"",
			publicKey:
				opts.publicKey?.trim() || process.env.DISCORD_PUBLIC_KEY?.trim() || "",
			ownerUserId:
				opts.ownerUserId?.trim() ||
				process.env.DISCORD_OWNER_USER_ID?.trim() ||
				undefined,
			allowBotAuthors:
				!opts.ignoreBotAuthors &&
				!/^(1|true|yes)$/i.test(
					process.env.DISCORD_IGNORE_BOT_AUTHORS?.trim() ?? "",
				),
			mentionRoleIds: mentionRoleIds.length > 0 ? mentionRoleIds : undefined,
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

	private resolveConnectorStatePath(applicationId: string): string {
		return this.resolveConnectorPath(`${this.sanitizeKey(applicationId)}.json`);
	}

	private resolveBindingsPath(applicationId: string): string {
		return this.resolveConnectorPath(
			`${this.sanitizeKey(applicationId)}.threads.json`,
		);
	}

	private listConnectorStatePaths(): string[] {
		return this.listJsonStatePaths([".threads.json"]);
	}

	private readConnectorState(
		statePath: string,
	): DiscordConnectorState | undefined {
		return this.readStateFile(
			statePath,
			(value): value is DiscordConnectorState =>
				Boolean(
					value &&
						typeof value === "object" &&
						typeof (value as DiscordConnectorState).pid === "number" &&
						typeof (value as DiscordConnectorState).applicationId === "string",
				),
		);
	}

	private writeConnectorState(
		statePath: string,
		state: DiscordConnectorState,
	): void {
		this.writeStateFile(statePath, state);
	}

	private async stopDiscordConnectorInstance(
		statePath: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return this.stopManagedProcess({
			io,
			statePath,
			readState: (path) => this.readConnectorState(path),
			describeStoppedProcess: (state) =>
				`[discord] stopped pid=${state.pid} application=${state.applicationId}`,
			getPid: (state) => state.pid,
			stopSessions: stopSessionsForApplication,
			clearBindings: (state) => {
				clearBindingSessionIds<DiscordThreadState>(
					this.resolveBindingsPath(state.applicationId),
				);
			},
		});
	}

	override async stopAll(io: ConnectIo): Promise<ConnectStopResult> {
		return this.stopAllFromStatePaths(
			io,
			this.listConnectorStatePaths(),
			(statePath, stopIo) =>
				this.stopDiscordConnectorInstance(statePath, stopIo),
		);
	}

	override async stopInstance(
		instanceId: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return await this.stopDiscordConnectorInstance(
			this.resolveConnectorStatePath(instanceId),
			io,
		);
	}

	protected override async validateOptions(
		options: ConnectDiscordOptions,
		io: ConnectIo,
	): Promise<number> {
		if (!options.applicationId) {
			io.writeErr(
				"connect discord 需要 --application-id <id> 或 DISCORD_APPLICATION_ID",
			);
			return 1;
		}
		if (!options.botToken) {
			io.writeErr(
				"connect discord 需要 --bot-token <token> 或 DISCORD_BOT_TOKEN",
			);
			return 1;
		}
		if (!options.publicKey) {
			io.writeErr(
				"connect discord 需要 --public-key <key> 或 DISCORD_PUBLIC_KEY",
			);
			return 1;
		}
		return 0;
	}

	protected override instanceIdFromOptions(
		options: ConnectDiscordOptions,
	): string | undefined {
		return options.applicationId;
	}

	protected override async runWithOptions(
		options: ConnectDiscordOptions,
		rawArgs: string[],
		io: ConnectIo,
		context: ConnectRunContext,
	): Promise<number> {
		context.setPersistenceInstanceId(options.applicationId);
		const statePath = this.resolveConnectorStatePath(options.applicationId);
		const bindingsPath = this.resolveBindingsPath(options.applicationId);
		const staleState = this.removeStaleState(
			statePath,
			(path) => this.readConnectorState(path),
			(state) => state.pid,
		);
		if (staleState) {
			clearBindingSessionIds<DiscordThreadState>(bindingsPath);
		}
		const backgroundExitCode = await this.maybeRunInBackground({
			rawArgs,
			io,
			interactive: options.interactive,
			childEnvVar: "CLINE_DISCORD_CONNECT_CHILD",
			statePath,
			readState: (path) => this.readConnectorState(path),
			isRunning: (state) => isProcessRunning(state.pid),
			formatAlreadyRunningMessage: (state) =>
				`[discord] 连接器已在运行 pid=${state.pid} rpc=${state.rpcAddress} url=${state.baseUrl}`,
			formatBackgroundStartMessage: (pid) =>
				`[discord] 正在启动后台连接器 pid=${pid} application=${options.applicationId}`,
			foregroundHint:
				"[discord] 使用 `cline connect discord -i ...` 在前台运行",
			launchFailureMessage: "无法在后台启动 Discord 连接器",
		});
		if (backgroundExitCode !== undefined) {
			return backgroundExitCode;
		}

		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "discord-connect",
		});
		const logger = createChatSdkLogger(loggerAdapter);
		const consoleLogger = new ConsoleLogger("info", "discord-connect");
		const discord = createDiscordAdapter({
			userName: options.userName,
			applicationId: options.applicationId,
			botToken: options.botToken,
			publicKey: options.publicKey,
			mentionRoleIds: options.mentionRoleIds,
			logger: consoleLogger,
		}) as DiscordAdapter;
		const bot = new Chat({
			userName: options.userName,
			adapters: { discord },
			state: new InMemoryStateAdapter(),
			logger,
			fallbackStreamingPlaceholderText: null,
			streamingUpdateIntervalMs: 500,
		}).registerSingleton();
		const threadQueues = new Map<string, Promise<void>>();
		const activeTurns = new Map<string, ActiveConnectorTurn>();
		const pendingApprovals = new Map<string, PendingConnectorApproval>();
		const startRequest = await buildDiscordStartRequest(options, io, {
			enabled: loggerAdapter.runtimeConfig.enabled,
			level: loggerAdapter.runtimeConfig.level,
			destination: loggerAdapter.runtimeConfig.destination,
			bindings: {
				transport: "discord",
				applicationId: options.applicationId,
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

		const clientId = `discord-${process.pid}-${Date.now()}`;
		const client = new HubSessionClient({
			address: rpcAddress,
			authToken: rpcAuthToken,
			clientId,
			clientType: "cli",
			displayName: "discord connector",
			workspaceRoot: startRequest.workspaceRoot || startRequest.cwd,
			cwd: startRequest.cwd,
			metadata: {
				transport: "discord",
				applicationId: options.applicationId,
				userName: options.userName,
			},
		});
		await client.connect();
		this.writeConnectorState(statePath, {
			userName: options.userName,
			applicationId: options.applicationId,
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

		type ErrorTrackerEntry = {
			count: number;
			firstSeen: number;
			lastSeen: number;
		};
		const errorTracker = new Map<string, ErrorTrackerEntry>();
		const MAX_REPEATED_ERRORS = 3;
		const ERROR_WINDOW_MS = 60_000; // 1 minute

		const handleTurn = async (
			thread: Thread<DiscordThreadState>,
			text: string,
			context?: {
				participant?: DiscordParticipant;
				isDirectMention?: boolean;
				isSubscribedThreadMessage?: boolean;
			},
		) => {
			const queueKey = resolveThreadTurnQueueKey(thread);
			const enqueueTurn = (work: () => Promise<void>) =>
				enqueueThreadTurn(threadQueues, queueKey, work);
			const runTurn = async () => {
				try {
					await handleConnectorUserTurn({
						thread,
						text,
						runtimeText: formatDiscordRuntimeText(text, context?.participant, {
							ownerUserId: options.ownerUserId,
							isDirectMention: context?.isDirectMention,
							isSubscribedThreadMessage: context?.isSubscribedThreadMessage,
						}),
						client,
						pendingApprovals,
						baseStartRequest: startRequest,
						explicitSystemPrompt:
							options.systemPrompt?.trim() ||
							getConnectorSystemPrompt("discord"),
						clientId,
						logger: loggerAdapter,
						transport: "discord",
						botUserName: options.userName,
						ownerParticipantKeys: options.ownerUserId
							? [`discord:user:${options.ownerUserId}`]
							: undefined,
						requestStop,
						bindingsPath,
						hookCommand: options.hookCommand,
						systemRules: DISCORD_SYSTEM_RULES,
						errorLabel: "Discord",
						firstContactMessage: DISCORD_FIRST_CONTACT_MESSAGE,
						userInstructionService,
						chatCommandHost,
						activeTurns,
						enqueueTurn,
						turnKey: queueKey,
						resolveMuteTarget: ({ target }) => resolveDiscordMuteTarget(target),
						createEmptyRuntimeReplyResolver:
							createDiscordEmptyRuntimeReplyResolver,
						getSessionMetadata: (currentThread, _clientId, currentState) => ({
							userName: options.userName,
							applicationId: options.applicationId,
							...(options.ownerUserId
								? { discordOwnerUserId: options.ownerUserId }
								: {}),
							discordThreadId: currentThread.id,
							discordChannelId: currentThread.channelId,
							...(currentState.participantKey
								? { discordParticipantKey: currentState.participantKey }
								: {}),
							...(currentState.participantLabel
								? { discordParticipantLabel: currentState.participantLabel }
								: {}),
						}),
						reusedLogMessage: "Discord 线程正在复用 RPC 会话",
						startedLogMessage: "Discord 线程已启动 RPC 会话",
						postFinalReply: async ({
							thread: replyThread,
							text: replyText,
						}) => {
							await postDiscordResolvedText({
								botToken: options.botToken,
								thread: replyThread,
								text: replyText,
							});
						},
						onMessageReceived: async (details) => {
							await dispatchConnectorHook(
								options.hookCommand,
								{
									adapter: "discord",
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
									adapter: "discord",
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
									adapter: "discord",
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

					// Track repeated errors per-thread with fixed time window
					const now = Date.now();
					const errorKey = `${thread.id}:${message.slice(0, 200)}`; // Per-thread error tracking
					const tracked = errorTracker.get(errorKey);

					if (!tracked) {
						// First occurrence, start tracking
						errorTracker.set(errorKey, {
							count: 1,
							firstSeen: now,
							lastSeen: now,
						});
						await thread.post(`Discord 桥接错误：${message}`);
					} else if (now - tracked.firstSeen > ERROR_WINDOW_MS) {
						// Outside fixed window, reset counter
						errorTracker.set(errorKey, {
							count: 1,
							firstSeen: now,
							lastSeen: now,
						});
						await thread.post(`Discord 桥接错误：${message}`);
					} else {
						// Within fixed window, increment counter
						tracked.count++;
						tracked.lastSeen = now;

						if (tracked.count >= MAX_REPEATED_ERRORS) {
							// Too many repeated errors in this thread, kill the connector
							loggerAdapter.core.error?.(
								"由于重复错误，Discord 连接器正在停止",
								{
									transport: "discord",
									threadId: thread.id,
									errorMessage: message,
									count: tracked.count,
									windowMs: now - tracked.firstSeen,
								},
							);
							await thread.post(
								`Discord 桥接错误（在 ${Math.round((now - tracked.firstSeen) / 1000)}s 内重复 ${tracked.count} 次）：${message}\n\n由于重复错误，连接器正在关闭。`,
							);
							requestStop("repeated_discord_errors");
						} else {
							// Still within threshold, post error
							await thread.post(`Discord 桥接错误：${message}`);
						}
					}
				}
			};
			if (activeTurns.has(queueKey)) {
				await runTurn();
				return;
			}
			await enqueueTurn(runTurn);
		};

		bot.onNewMention(async (thread, message) => {
			loggerAdapter.core.log("已调用 Discord 提及处理程序", {
				transport: "discord",
				threadId: thread.id,
				channelId: thread.channelId,
				authorId: message.author.userId,
				authorName: message.author.userName,
				authorIsBot: message.author.isBot,
				isMention: message.isMention,
				textPreview: truncateText(message.text),
			});
			await thread.subscribe();
			const participant = await persistDiscordThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				message,
				errorLabel: "Discord",
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text: message.text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "被 Discord 用户拒绝",
				})
			) {
				return;
			}
			await handleTurn(thread, message.text, {
				participant,
				isDirectMention: message.isMention,
				isSubscribedThreadMessage: false,
			});
		});

		bot.onSubscribedMessage(async (thread, message) => {
			loggerAdapter.core.log("已调用 Discord 订阅消息处理程序", {
				transport: "discord",
				threadId: thread.id,
				channelId: thread.channelId,
				authorId: message.author.userId,
				authorName: message.author.userName,
				authorIsBot: message.author.isBot,
				isMention: message.isMention,
				textPreview: truncateText(message.text),
			});
			const participant = await persistDiscordThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				message,
				errorLabel: "Discord",
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text: message.text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "被 Discord 用户拒绝",
				})
			) {
				return;
			}
			await handleTurn(thread, message.text, {
				participant,
				isDirectMention: message.isMention,
				isSubscribedThreadMessage: true,
			});
		});

		bot.onSlashCommand(async (event) => {
			const commandText = [event.command.trim(), event.text.trim()]
				.filter(Boolean)
				.join(" ");
			const displayName =
				event.user.fullName || event.user.userName || event.user.userId;
			const rootMessage = await event.channel.post(
				`${displayName} 调用了 ${commandText}`,
			);
			const thread = new ThreadImpl<DiscordThreadState>({
				adapterName: "discord",
				channelId: event.channel.id,
				id: rootMessage.threadId,
				isDM: event.channel.isDM,
				isSubscribedContext: true,
			});
			await thread.subscribe();
			const participant = await persistDiscordThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				message: {
					raw: event.raw,
					author: event.user,
				},
				errorLabel: "Discord",
			});
			await handleTurn(thread, commandText, {
				participant,
				isDirectMention: true,
				isSubscribedThreadMessage: false,
			});
		});

		await bot.initialize();
		const restoredSubscriptionCount = await restoreDiscordThreadSubscriptions({
			bot,
			bindingsPath,
			logger: loggerAdapter,
		});
		const stopTaskUpdateStream =
			startConnectorTaskUpdateRelay<DiscordThreadState>({
				client,
				clientId,
				bot,
				logger: loggerAdapter,
				bindingsPath,
				transport: "discord",
			});

		const webhookUrl = `${options.baseUrl.replace(/\/$/, "")}/api/webhooks/discord`;
		const server = await startConnectorWebhookServer({
			host: options.host,
			port: options.port,
			routes: {
				"/api/webhooks/discord": async (request) => {
					const normalizedRequest =
						await normalizeDiscordForwardedGatewayRequest({
							request,
							botToken: options.botToken,
							applicationId: options.applicationId,
						});
					await logDiscordForwardedGatewayMessage({
						request: normalizedRequest,
						logger: consoleLogger,
						applicationId: options.applicationId,
					});
					return discord.handleWebhook(normalizedRequest);
				},
				"/health": () => new Response("ok"),
				"/": () =>
					new Response(
						[
							"Discord 连接器正在运行。",
							`交互端点：${webhookUrl}`,
							`网关模式：${options.allowBotAuthors ? "转发式 WebSocket 监听器" : "直接 WebSocket 监听器"}`,
						].join("\n"),
					),
			},
		});

		let gatewayTask: Promise<unknown> | undefined;
		const gatewayAbortController = new AbortController();
		const gatewayStartResponse = await discord.startGatewayListener(
			{
				waitUntil: (task) => {
					gatewayTask = Promise.resolve(task).catch((error) => {
						loggerAdapter.core.error?.("Discord 网关监听器失败", {
							transport: "discord",
							error: error instanceof Error ? error.message : String(error),
						});
						requestStop("discord_gateway_failed");
					});
				},
			},
			DISCORD_GATEWAY_DURATION_MS,
			gatewayAbortController.signal,
			options.allowBotAuthors ? webhookUrl : undefined,
		);
		if (!gatewayStartResponse.ok) {
			await server.close();
			stopTaskUpdateStream();
			userInstructionService.stop();
			client.close();
			this.removeStateFile(statePath);
			io.writeErr(
				`启动 Discord 网关监听器失败：${await gatewayStartResponse.text()}`,
			);
			return 1;
		}

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
					if (!scheduleId || !status) {
						return;
					}
					void deliverScheduledResult({
						bot,
						client,
						bindingsPath,
						userName: options.userName,
						scheduleId,
						sessionId,
						status,
						errorMessage,
					});
				},
				onError: () => {
					requestStop("rpc_server_event_stream_failed");
				},
			},
		);

		process.once("SIGINT", () => requestStop("sigint"));
		process.once("SIGTERM", () => requestStop("sigterm"));

		io.writeln(`[discord] 正在监听 ${options.host}:${options.port}`);
		io.writeln(
			`[discord] 配置 Discord 交互端点：${webhookUrl}`,
		);
		io.writeln(
			`[discord] 已为提及、回复、回应和私信启动网关监听器${options.allowBotAuthors ? "（允许机器人作者）" : ""}`,
		);
		if (restoredSubscriptionCount > 0) {
			io.writeln(
				`[discord] 已恢复 ${restoredSubscriptionCount} 个线程订阅${restoredSubscriptionCount === 1 ? "" : ""}`,
			);
		}

		await stopPromise;
		clearBindingSessionIds<DiscordThreadState>(bindingsPath);
		gatewayAbortController.abort();
		stopTaskUpdateStream();
		stopEventStream();
		await gatewayTask?.catch(() => undefined);
		await server.close();
		userInstructionService.stop();
		client.close();
		this.removeStateFile(statePath);
		return 0;
	}
}

export const discordConnector: ConnectCommandDefinition =
	new DiscordConnector();

export const __test__ = {
	DISCORD_SYSTEM_RULES,
	createDiscordEmptyRuntimeReplyResolver,
	formatDiscordRuntimeText,
	resolveDiscordMuteTarget,
	findBindingForThread: (
		bindings: ConnectorBindingStore<DiscordThreadState>,
		thread: Pick<Thread<DiscordThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
		},
	) => findBindingForThread(bindings, thread),
	persistDiscordThreadContext,
	normalizeDiscordForwardedGatewayRequest,
	resolveDiscordOutboundMentions,
	resolveDiscordParticipant,
	restoreDiscordThreadSubscriptions,
};
