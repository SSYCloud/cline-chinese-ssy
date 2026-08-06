import {
	type McpInstallOptions as CoreMcpInstallOptions,
	installMcpServer,
	type McpInstallResult,
	type McpServerTransportConfig,
} from "@cline/core";
import type { McpAddDefaults } from "../wizards/mcp";

export { buildMcpInstallTransport } from "@cline/core";

export interface McpCommandIo {
	writeln?: (text: string) => void;
	writeErr: (text: string) => void;
}

export interface McpInstallOptions extends CoreMcpInstallOptions {
	io?: McpCommandIo;
	isTty?: boolean;
	json?: boolean;
	runWizard?: (defaults: McpAddDefaults) => Promise<number>;
	yes?: boolean;
}

export interface McpInstallDirectResult {
	name: string;
	status: "installed";
	transport: McpServerTransportConfig;
	warnings: string[];
}

function normalizeTransportType(
	value: string | undefined,
): McpServerTransportConfig["type"] {
	const normalized = (value ?? "stdio").trim();
	if (normalized === "http" || normalized === "streamable-http") {
		return "streamableHttp";
	}
	if (
		normalized === "stdio" ||
		normalized === "sse" ||
		normalized === "streamableHttp"
	) {
		return normalized;
	}
	throw new Error(
		`不支持的 MCP 传输方式 "${normalized}"。应为 stdio、sse、http、streamable-http 或 streamableHttp。`,
	);
}

function assertValidUrl(url: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`无效的 MCP 服务器 URL: ${url}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(
			`无效的 MCP 服务器 URL: ${url}（仅支持 http 和 https）`,
		);
	}
}

function quoteCommandArg(arg: string): string {
	if (/^[^\s"'\\]+$/.test(arg)) {
		return arg;
	}
	return `"${arg.replace(/(["\\])/g, "\\$1")}"`;
}

export function buildMcpInstallDefaults(options: {
	name: string;
	targetArgs?: string[];
	transport?: string;
}): McpAddDefaults {
	const name = options.name.trim();
	if (!name) {
		throw new Error("需要 MCP 服务器名称");
	}
	const type = normalizeTransportType(options.transport);
	const targetArgs = options.targetArgs ?? [];
	if (type === "stdio") {
		if (targetArgs.length === 0) {
			throw new Error(
				"Stdio MCP 安装需要在服务器名称后跟命令，例如：cline mcp install fs -- npx -y @modelcontextprotocol/server-filesystem /tmp",
			);
		}
		return {
			name,
			type,
			command: targetArgs.map(quoteCommandArg).join(" "),
		};
	}

	if (targetArgs.length !== 1) {
		throw new Error(
			"远程 MCP 安装需要在服务器名称后提供恰好一个 URL 参数。",
		);
	}
	const url = targetArgs[0]?.trim() ?? "";
	assertValidUrl(url);
	return {
		name,
		type,
		url,
	};
}

export function installMcpServerDirect(
	options: McpInstallOptions,
): McpInstallDirectResult {
	const result: McpInstallResult = installMcpServer(options);
	return {
		name: result.name,
		status: result.status,
		transport: result.transport,
		warnings: result.warnings,
	};
}

async function runPrefilledWizard(defaults: McpAddDefaults): Promise<number> {
	const { runMcpWizard } = await import("../wizards/mcp");
	return runMcpWizard({
		initialAction: "add",
		addDefaults: defaults,
		exitAfterInitialAction: true,
	});
}

export async function runMcpInstallCommand(
	options: McpInstallOptions,
): Promise<number> {
	try {
		if (options.yes) {
			const result = installMcpServerDirect(options);
			if (options.json) {
				options.io?.writeln?.(JSON.stringify(result));
			} else {
				options.io?.writeln?.(`已安装 MCP 服务器 ${result.name}。`);
				for (const warning of result.warnings) {
					options.io?.writeErr(warning);
				}
			}
			return 0;
		}
		const isTty =
			options.isTty ?? (process.stdin.isTTY && process.stdout.isTTY);
		if (!isTty) {
			throw new Error(
				"cline mcp install 会打开 MCP 向导并需要 TTY。请传入 --yes 以非交互方式安装。",
			);
		}
		const defaults = buildMcpInstallDefaults(options);
		return await (options.runWizard ?? runPrefilledWizard)(defaults);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		options.io?.writeErr(message);
		return 1;
	}
}
