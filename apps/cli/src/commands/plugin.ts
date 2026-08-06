import {
	installPlugin,
	type PluginInstallOptions,
	type PluginInstallResult,
	type PluginMcpOAuthCandidate,
	type PluginUninstallOptions,
	uninstallPlugin,
} from "@cline/core";

export type {
	PluginInstallOptions,
	PluginInstallResult,
	PluginMcpOAuthCandidate,
} from "@cline/core";
export {
	collectPluginMcpOAuthCandidates,
	installPlugin,
	isOfficialPluginSlug,
	parsePluginSource,
} from "@cline/core";

export interface PluginInstallMcpOAuthOptions {
	interactive?: boolean;
	selectCandidates?: (
		candidates: PluginMcpOAuthCandidate[],
	) => Promise<PluginMcpOAuthCandidate[]>;
	authorize?: (candidate: PluginMcpOAuthCandidate) => Promise<void>;
}

export interface PluginInstallIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

type PluginInstallCommandOptions = PluginInstallOptions & {
	json?: boolean;
	io?: PluginInstallIo;
	mcpOAuth?: PluginInstallMcpOAuthOptions;
};

function serializePluginInstallResult(
	result: PluginInstallResult,
): Omit<PluginInstallResult, "mcpOAuthCandidates"> {
	return {
		source: result.source,
		installPath: result.installPath,
		entryPaths: result.entryPaths,
		mcpSyncFailures: result.mcpSyncFailures,
	};
}

function isInteractivePluginInstall(
	options: PluginInstallCommandOptions,
): boolean {
	return (
		options.mcpOAuth?.interactive ??
		(process.stdin.isTTY && process.stdout.isTTY)
	);
}

async function selectMcpOAuthCandidatesWithClack(
	candidates: PluginMcpOAuthCandidate[],
): Promise<PluginMcpOAuthCandidate[]> {
	const p = await import("@clack/prompts");
	const action = await p.select({
		message: "现在授权插件 MCP 服务器吗？",
		options: [
			{
				value: "all",
				label: "全部授权",
				hint: "为每个服务器打开浏览器授权",
			},
			{
				value: "choose",
				label: "选择服务器",
				hint: "选择要授权的服务器",
			},
			{
				value: "skip",
				label: "跳过",
			},
		],
	});
	if (p.isCancel(action) || action === "skip") {
		return [];
	}
	if (action === "all") {
		return candidates;
	}

	const selectedNames = await p.multiselect({
		message: "选择要授权的 MCP 服务器",
		options: candidates.map((candidate) => ({
			value: candidate.name,
			label: candidate.name,
			hint: `${candidate.transportType} [${candidate.pluginName}]`,
		})),
		required: false,
	});
	if (p.isCancel(selectedNames) || !Array.isArray(selectedNames)) {
		return [];
	}
	const selected = new Set(selectedNames);
	return candidates.filter((candidate) => selected.has(candidate.name));
}

async function authorizeMcpOAuthCandidate(
	candidate: PluginMcpOAuthCandidate,
): Promise<void> {
	const { authorizeMcpServerOAuthWithBrowser } = await import(
		"../wizards/mcp/oauth"
	);
	await authorizeMcpServerOAuthWithBrowser(candidate.name, {
		throwOnError: true,
	});
}

async function runPluginMcpOAuthFollowup(
	candidates: PluginMcpOAuthCandidate[],
	options: PluginInstallCommandOptions,
): Promise<void> {
	if (candidates.length === 0) {
		return;
	}

	if (!isInteractivePluginInstall(options)) {
		options.io?.writeln("插件 MCP 服务器可能需要 OAuth 授权：");
		for (const candidate of candidates) {
			options.io?.writeln(
				`  ${candidate.name} (${candidate.transportType}, 插件: ${candidate.pluginName})`,
			);
		}
		options.io?.writeln(
			'运行 "cline mcp" 并选择 "Authorize OAuth" 来授权它们。',
		);
		return;
	}

	const selected =
		options.mcpOAuth?.selectCandidates !== undefined
			? await options.mcpOAuth.selectCandidates(candidates)
			: await selectMcpOAuthCandidatesWithClack(candidates);
	const authorize = options.mcpOAuth?.authorize ?? authorizeMcpOAuthCandidate;
	for (const candidate of selected) {
		try {
			await authorize(candidate);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			options.io?.writeErr(
				`警告：无法授权 MCP 服务器 ${candidate.name}: ${message}。运行 "cline mcp" 并选择 "Authorize OAuth" 重试。`,
			);
		}
	}
}

export async function runPluginInstallCommand(
	options: PluginInstallCommandOptions,
): Promise<number> {
	try {
		const result = await installPlugin(options);
		if (options.json) {
			process.stdout.write(
				JSON.stringify(serializePluginInstallResult(result)),
			);
			return 0;
		}
		options.io?.writeln(`已从 ${result.source} 安装插件`);
		options.io?.writeln(`  路径: ${result.installPath}`);
		for (const failure of result.mcpSyncFailures) {
			options.io?.writeErr(
				`警告：无法同步 ${failure.pluginName ?? failure.pluginPath} 的插件 MCP 服务器: ${failure.message}`,
			);
		}
		await runPluginMcpOAuthFollowup(result.mcpOAuthCandidates, options);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		options.io?.writeErr(message);
		return 1;
	}
}

export async function runPluginUninstallCommand(
	options: PluginUninstallOptions & { json?: boolean; io?: PluginInstallIo },
): Promise<number> {
	try {
		const result = await uninstallPlugin(options);
		if (options.json) {
			process.stdout.write(JSON.stringify(result));
			return 0;
		}
		options.io?.writeln(`已卸载插件 ${result.name}`);
		options.io?.writeln(`  已移除: ${result.installPath}`);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		options.io?.writeErr(message);
		return 1;
	}
}
