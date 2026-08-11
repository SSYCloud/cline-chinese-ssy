import * as p from "@clack/prompts";
import { authorizeMcpServerOAuthWithBrowser as authorizeOAuth } from "./oauth";
import {
	addServer,
	clearServerOAuth,
	getSettingsPath,
	loadServers,
	type McpServerEntry,
	type McpTransport,
	removeServer,
	setServerOAuthClient,
	toggleServer,
	updateServer,
} from "./settings";

function isCancel(value: unknown): value is symbol {
	return p.isCancel(value);
}

function transportLabel(t: McpTransport): string {
	if (t.type === "stdio") return `stdio: ${t.command}`;
	return `${t.type}: ${t.url}`;
}

function statusLabel(entry: McpServerEntry): string {
	return entry.disabled ? "已禁用" : "已启用";
}

function authLabel(entry: McpServerEntry): string {
	if (entry.transport.type === "stdio") return "本地";
	if (entry.oauth?.lastError) return "OAuth 错误";
	const accessToken = entry.oauth?.tokens?.access_token;
	if (typeof accessToken === "string" && accessToken.trim().length > 0) {
		return "OAuth 已授权";
	}
	if (entry.oauth && Object.keys(entry.oauth).length > 0) {
		return "OAuth 待处理";
	}
	if (
		entry.transport.headers &&
		Object.keys(entry.transport.headers).length > 0
	) {
		return "静态标头";
	}
	return "无身份验证";
}

type RemoteAuthMode = "none" | "headers" | "oauth";

interface UrlServerConfig {
	transport: McpTransport;
	authMode: RemoteAuthMode;
	oauthClient?: { clientId: string; clientSecret?: string };
}

export interface McpAddDefaults {
	name?: string;
	type?: McpTransport["type"];
	command?: string;
	url?: string;
}

export interface RunMcpWizardOptions {
	initialAction?: "add";
	addDefaults?: McpAddDefaults;
	exitAfterInitialAction?: boolean;
}

export function parseStdioCommand(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let escaping = false;
	for (const char of input.trim()) {
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
	if (escaping) {
		current += "\\";
	}
	if (current) {
		tokens.push(current);
	}
	return tokens;
}

async function collectStdioTransport(
	defaultCommand?: string,
): Promise<McpTransport | null> {
	p.log.info("支持带引号的参数和转义空格");

	const command = await p.text({
		message: "要运行的命令",
		placeholder: "npx -y @modelcontextprotocol/server-filesystem",
		initialValue: defaultCommand,
		validate: (v) => {
			if (!v?.trim()) return "命令是必填项";
			return undefined;
		},
	});
	if (isCancel(command)) return null;

	const parts = parseStdioCommand(command as string);
	const cmd = parts[0] ?? "";
	const args = parts.slice(1);

	const envInput = await p.text({
		message: "环境变量（KEY=VALUE，逗号分隔）",
		placeholder: "留空表示无",
	});
	if (isCancel(envInput)) return null;

	let env: Record<string, string> | undefined;
	const envStr = (envInput as string).trim();
	if (envStr) {
		env = {};
		for (const pair of envStr.split(",")) {
			const eqIdx = pair.indexOf("=");
			if (eqIdx > 0) {
				env[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
			}
		}
	}

	return {
		type: "stdio",
		command: cmd,
		args: args.length > 0 ? args : undefined,
		env,
	};
}

async function collectUrlTransport(
	type: "sse" | "streamableHttp",
	defaultUrl?: string,
): Promise<UrlServerConfig | null> {
	const url = await p.text({
		message: "服务器网址",
		placeholder: "https://example.com/mcp",
		initialValue: defaultUrl,
		validate: (v) => {
			if (!v?.trim()) return "网址是必填项";
			try {
				new URL(v.trim());
			} catch {
				return "必须是有效的网址";
			}
			return undefined;
		},
	});
	if (isCancel(url)) return null;

	const authMode = await p.select({
		message: "身份验证",
		options: [
			{
				value: "oauth",
				label: "OAuth",
				hint: "打开浏览器并将令牌保存在 MCP 设置中",
			},
			{
				value: "headers",
				label: "静态标头",
				hint: "手动配置请求标头",
			},
			{
				value: "none",
				label: "无身份验证",
			},
		],
	});
	if (isCancel(authMode)) return null;

	if (authMode === "oauth") {
		const clientId = await p.text({
			message: "OAuth client ID (leave empty for dynamic registration)",
		});
		if (isCancel(clientId)) return null;
		const normalizedClientId = (clientId as string).trim();
		let clientSecret: string | undefined;
		if (normalizedClientId) {
			const secret = await p.password({
				message: "OAuth client secret (leave empty for public clients)",
			});
			if (isCancel(secret)) return null;
			clientSecret = (secret as string).trim() || undefined;
		}
		return {
			transport: { type, url: (url as string).trim() },
			authMode,
			oauthClient: normalizedClientId
				? { clientId: normalizedClientId, clientSecret }
				: undefined,
		};
	}
	if (authMode === "none") {
		return {
			transport: { type, url: (url as string).trim() },
			authMode,
		};
	}

	const headersInput = await p.text({
		message: "标头（KEY:VALUE，逗号分隔）",
		placeholder: "留空表示无",
	});
	if (isCancel(headersInput)) return null;

	let headers: Record<string, string> | undefined;
	const headersStr = (headersInput as string).trim();
	if (headersStr) {
		headers = {};
		for (const pair of headersStr.split(",")) {
			const colonIdx = pair.indexOf(":");
			if (colonIdx > 0) {
				headers[pair.slice(0, colonIdx).trim()] = pair
					.slice(colonIdx + 1)
					.trim();
			}
		}
	}

	return {
		transport: { type, url: (url as string).trim(), headers },
		authMode,
	};
}

async function actionAdd(defaults?: McpAddDefaults): Promise<void> {
	const name = await p.text({
		message: "服务器名称",
		placeholder: "my-mcp-server",
		initialValue: defaults?.name,
		validate: (v) => {
			if (!v?.trim()) return "名称是必填项";
			const existing = loadServers();
			if (existing.some((s) => s.name === v.trim())) {
				return "已存在同名服务器";
			}
			return undefined;
		},
	});
	if (isCancel(name)) return;

	const type = await p.select({
		message: "服务器类型",
		initialValue: defaults?.type,
		options: [
			{
				value: "stdio",
				label: "本地",
				hint: "在本机运行命令",
			},
			{
				value: "sse",
				label: "远程（SSE）",
				hint: "通过 Server-Sent Events 连接网址",
			},
			{
				value: "streamableHttp",
				label: "远程（HTTP）",
				hint: "通过可流式 HTTP 连接网址",
			},
		],
	});
	if (isCancel(type)) return;

	let transport: McpTransport | null;
	let authMode: RemoteAuthMode = "none";
	let oauthClient: UrlServerConfig["oauthClient"];
	if (type === "stdio") {
		transport = await collectStdioTransport(defaults?.command);
	} else {
		const config = await collectUrlTransport(
			type as "sse" | "streamableHttp",
			defaults?.url,
		);
		transport = config?.transport ?? null;
		authMode = config?.authMode ?? "none";
		oauthClient = config?.oauthClient;
	}
	if (!transport) return;

	const serverName = (name as string).trim();
	addServer(serverName, transport);
	if (authMode !== "oauth") {
		clearServerOAuth(serverName);
	} else {
		setServerOAuthClient(serverName, oauthClient);
	}
	p.log.success(`已将 "${serverName}" 添加到 ${getSettingsPath()}`);
	if (authMode === "oauth") {
		await authorizeOAuth(serverName);
	}
}

async function actionList(): Promise<void> {
	const servers = loadServers();
	if (servers.length === 0) {
		p.log.info("未配置任何 MCP 服务器");
		p.log.info(`设置文件：${getSettingsPath()}`);
		return;
	}
	for (const s of servers) {
		const status = s.disabled ? "（已禁用）" : "";
		p.log.info(`${s.name}${status}`);
		p.log.message(`  ${transportLabel(s.transport)}`);
		p.log.message(`  身份验证：${authLabel(s)}`);
		if (s.oauth?.lastError) {
			p.log.message(`  上次 OAuth 错误：${s.oauth.lastError}`);
		}
	}
	p.log.message(`\n设置文件：${getSettingsPath()}`);
}

function pickServer(
	servers: McpServerEntry[],
	message: string,
): Promise<string | null> {
	if (servers.length === 0) {
		p.log.warn("未配置任何 MCP 服务器");
		return Promise.resolve(null);
	}
	return p
		.select({
			message,
			options: servers.map((s) => ({
				value: s.name,
				label: s.name,
				hint: `${s.transport.type} [${statusLabel(s)}, ${authLabel(s)}]`,
			})),
		})
		.then((v) => (isCancel(v) ? null : (v as string)));
}

async function pickRemoteServer(message: string): Promise<string | null> {
	const servers = loadServers().filter(
		(server) => server.transport.type !== "stdio",
	);
	return pickServer(servers, message);
}

async function actionEdit(): Promise<void> {
	const servers = loadServers();
	const name = await pickServer(servers, "选择要编辑的服务器");
	if (!name) return;

	const current = servers.find((s) => s.name === name);
	if (!current) return;

	p.log.step(`正在编辑 ${name} (${current.transport.type})`);

	const type = await p.select({
		message: "服务器类型",
		initialValue: current.transport.type,
		options: [
			{
				value: "stdio",
				label: "本地",
				hint: "运行命令",
			},
			{
				value: "sse",
				label: "远程（SSE）",
				hint: "Server-Sent Events",
			},
			{
				value: "streamableHttp",
				label: "远程（HTTP）",
				hint: "可流式 HTTP",
			},
		],
	});
	if (isCancel(type)) return;

	let transport: McpTransport | null;
	let authMode: RemoteAuthMode = "none";
	let oauthClient: UrlServerConfig["oauthClient"];
	if (type === "stdio") {
		transport = await collectStdioTransport();
	} else {
		const config = await collectUrlTransport(type as "sse" | "streamableHttp");
		transport = config?.transport ?? null;
		authMode = config?.authMode ?? "none";
		oauthClient = config?.oauthClient;
	}
	if (!transport) return;

	updateServer(name, transport);
	if (type === "stdio" || authMode !== "oauth") {
		clearServerOAuth(name);
	} else {
		setServerOAuthClient(name, oauthClient);
	}
	p.log.success(`已更新 "${name}"`);
	if (authMode === "oauth") {
		await authorizeOAuth(name);
	}
}

async function actionDelete(): Promise<void> {
	const servers = loadServers();
	const name = await pickServer(servers, "选择要删除的服务器");
	if (!name) return;

	const confirm = await p.confirm({
		message: `删除 "${name}"？`,
		initialValue: false,
	});
	if (isCancel(confirm) || !confirm) return;

	if (removeServer(name)) {
		p.log.success(`已删除 "${name}"`);
	} else {
		p.log.error("删除服务器失败");
	}
}

async function actionToggle(): Promise<void> {
	const servers = loadServers();
	const name = await pickServer(servers, "选择要启用/禁用的服务器");
	if (!name) return;

	const current = servers.find((s) => s.name === name);
	if (!current) return;

	const newDisabled = !current.disabled;
	toggleServer(name, newDisabled);
	p.log.success(`${name} 现在${newDisabled ? "已禁用" : "已启用"}`);
}

async function actionAuthorizeOAuth(): Promise<void> {
	const name = await pickRemoteServer("选择要授权的远程服务器");
	if (!name) return;
	await authorizeOAuth(name);
}

export async function runMcpWizard(
	options: RunMcpWizardOptions = {},
): Promise<number> {
	p.intro("MCP 服务器");

	if (options.initialAction === "add") {
		let initialActionExitCode = 0;
		try {
			await actionAdd(options.addDefaults);
		} catch (err) {
			initialActionExitCode = 1;
			p.log.error(err instanceof Error ? err.message : String(err));
		}
		if (options.exitAfterInitialAction === true) {
			p.outro("完成");
			return initialActionExitCode;
		}
	}

	let keepGoing = true;
	while (keepGoing) {
		const action = await p.select({
			message: "你想做什么？",
			options: [
				{
					value: "list",
					label: "列出服务器",
					hint: "查看已配置的 MCP 服务器",
				},
				{
					value: "add",
					label: "添加服务器",
					hint: "配置新的 MCP 服务器",
				},
				{
					value: "edit",
					label: "编辑服务器",
					hint: "更改服务器配置",
				},
				{
					value: "toggle",
					label: "启用/禁用服务器",
				},
				{
					value: "authorize",
					label: "授权 OAuth",
					hint: "为远程服务器运行或重新运行浏览器授权",
				},
				{
					value: "delete",
					label: "删除服务器",
				},
				{
					value: "exit",
					label: "退出",
				},
			],
		});

		if (isCancel(action) || action === "exit") {
			keepGoing = false;
			continue;
		}

		try {
			switch (action) {
				case "list":
					await actionList();
					break;
				case "add":
					await actionAdd();
					break;
				case "edit":
					await actionEdit();
					break;
				case "toggle":
					await actionToggle();
					break;
				case "authorize":
					await actionAuthorizeOAuth();
					break;
				case "delete":
					await actionDelete();
					break;
			}
		} catch (err) {
			p.log.error(err instanceof Error ? err.message : String(err));
		}
	}

	p.outro("完成");
	return 0;
}
