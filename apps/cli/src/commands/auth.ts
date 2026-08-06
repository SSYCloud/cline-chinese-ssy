import { createInterface } from "node:readline";
import {
	BUILT_IN_PROVIDER,
	createOAuthClientCallbacks,
	ensureCustomProvidersLoaded,
	getProviderAuthHandler,
	loginAndSaveProviderOAuthCredentials,
	type ProviderSettings,
	type ProviderSettingsManager,
	saveProviderOAuthCredentials,
} from "@cline/core";
import { Command } from "commander";
import React from "react";
import { disableOpenTuiGraphicsProbe } from "../tui/opentui-env";
import open from "../utils/open";
import {
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeAuthProviderId,
	normalizeProviderId,
	type OAuthCredentials,
	toProviderApiKey,
} from "../utils/provider-auth";
import { listLocalProviders } from "../utils/provider-catalog";
import { identifyTelemetryAccount } from "../utils/telemetry";

export {
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeAuthProviderId,
	normalizeProviderId,
	toProviderApiKey,
};
export type { OAuthCredentials };

const c = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
};

type AuthIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

type AuthQuickSetupInput = {
	provider: string;
	apikey: string;
	modelid: string;
	baseurl?: string;
	azureApiVersion?: string;
};

type AuthCommandInput = {
	providerSettingsManager: ProviderSettingsManager;
	io: AuthIo;
	explicitProvider?: string;
	apikey?: string;
	modelid?: string;
	baseurl?: string;
	azureApiVersion?: string;
};

type ParsedAuthCommandArgs = {
	explicitProvider?: string;
	apikey?: string;
	modelid?: string;
	baseurl?: string;
	azureApiVersion?: string;
	parseError?: string;
};

/**
 * Create the `auth` subcommand for Commander.
 *
 * In the auth context, `-p` means `--provider` and `-m` means `--modelid`,
 * which intentionally shadows the global `-p` (--plan) and `-m` (--model)
 * short flags. Commander scopes options per-command, so there is no conflict.
 */
export function createAuthCommand(): Command {
	const cmd = new Command("auth")
		.description("与 LLM 提供方进行身份验证")
		.exitOverride()
		.configureOutput({ writeOut: () => {}, writeErr: () => {} })
		.argument("[provider]", "提供方 ID（-p 的位置参数简写）")
		.option("-p, --provider <id>", "提供方 ID")
		.option("-k, --apikey <key>", "API 密钥")
		.option("-m, --modelid <id>", "模型 ID")
		.option("-b, --baseurl <url>", "基础 URL")
		.option("--azure-api-version <version>", "Azure API 版本");
	return cmd;
}

export function parseAuthCommandArgs(args: string[]): ParsedAuthCommandArgs {
	const cmd = createAuthCommand();
	try {
		cmd.parse(args, { from: "user" });
	} catch {
		// Commander throws on --help / --version / unknown flags via exitOverride
		return { parseError: `未知的 auth 选项：${args.join(" ")}` };
	}
	const opts = cmd.opts<{
		provider?: string;
		apikey?: string;
		modelid?: string;
		baseurl?: string;
		azureApiVersion?: string;
	}>();
	const positionalProvider = cmd.args[0];
	return {
		explicitProvider: opts.provider ?? positionalProvider,
		apikey: opts.apikey,
		modelid: opts.modelid,
		baseurl: opts.baseurl,
		azureApiVersion: opts.azureApiVersion,
	};
}

async function loadProviderCatalog(
	providerSettingsManager: ProviderSettingsManager,
): Promise<Array<{ id: string; name: string }>> {
	await ensureCustomProvidersLoaded(providerSettingsManager);
	const catalog = await listLocalProviders(providerSettingsManager);
	return catalog.providers
		.map((provider) => ({
			id: provider.id.trim(),
			name: provider.name.trim() || provider.id.trim(),
		}))
		.filter((provider) => provider.id.length > 0)
		.sort((a, b) => a.id.localeCompare(b.id));
}

async function ensureQuickSetupInputValid(
	input: AuthQuickSetupInput,
	providerSettingsManager: ProviderSettingsManager,
): Promise<string | undefined> {
	const normalizedProvider = normalizeProviderId(input.provider);
	const providerCatalog = await loadProviderCatalog(providerSettingsManager);
	if (!providerCatalog.some((provider) => provider.id === normalizedProvider)) {
		return `无效的提供方 "${input.provider}"`;
	}
	if (!input.apikey.trim()) {
		return "auth 快速设置需要 --apikey <key>";
	}
	if (!input.modelid.trim()) {
		return "auth 快速设置需要 --modelid <id>";
	}
	if (
		input.baseurl?.trim() &&
		normalizedProvider !== BUILT_IN_PROVIDER.OPENAI_COMPATIBLE &&
		normalizedProvider !== BUILT_IN_PROVIDER.OPENAI_NATIVE
	) {
		return "基础 URL 仅支持 OpenAI 和兼容 OpenAI 的提供方";
	}
	if (
		input.azureApiVersion?.trim() &&
		normalizedProvider !== BUILT_IN_PROVIDER.OPENAI_COMPATIBLE
	) {
		return "Azure API 版本仅支持兼容 OpenAI 的提供方";
	}
	return undefined;
}

function saveQuickAuthProviderSettings(input: {
	providerSettingsManager: ProviderSettingsManager;
	providerId: string;
	apikey: string;
	modelid: string;
	baseurl?: string;
	azureApiVersion?: string;
}): void {
	const existing = input.providerSettingsManager.getProviderSettings(
		input.providerId,
	);
	const nextSettings: ProviderSettings = {
		...(existing ?? {
			provider: input.providerId as ProviderSettings["provider"],
		}),
		provider: input.providerId as ProviderSettings["provider"],
		apiKey: input.apikey,
		model: input.modelid,
	};
	if (input.baseurl?.trim()) {
		nextSettings.baseUrl = input.baseurl.trim();
	}
	if (input.azureApiVersion?.trim()) {
		nextSettings.azure = {
			...(nextSettings.azure ?? {}),
			apiVersion: input.azureApiVersion.trim(),
		};
	}
	input.providerSettingsManager.saveProviderSettings(nextSettings);
}

async function askForInputInTerminal(question: string): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("OAuth 登录需要交互式终端会话");
	}

	return new Promise<string>((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(`${question} `, (value) => {
			rl.close();
			resolve(value);
		});
	});
}

function createOAuthCallbacks(io: AuthIo): {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onPrompt: (prompt: {
		message: string;
		defaultValue?: string;
	}) => Promise<string>;
} {
	return createOAuthClientCallbacks({
		onPrompt: ({ message, defaultValue }) =>
			askForInputInTerminal(message).then((value) => {
				const trimmed = value.trim();
				return trimmed || defaultValue || "";
			}),
		onOutput: (message) => {
			io.writeln(`${c.dim}[auth] ${message}${c.reset}`);
		},
		openUrl: (url) => open(url, { wait: false }).then(() => undefined),
		onOpenUrlError: ({ error }) => {
			io.writeln(
				`${c.dim}[auth] 无法自动打开浏览器；请手动打开上面的 URL。${c.reset}`,
			);
			io.writeln(
				`${c.dim}[auth] 打开浏览器失败: ${error instanceof Error ? error.message : String(error)}${c.reset}`,
			);
		},
	});
}

export function saveOAuthProviderSettings(
	providerSettingsManager: ProviderSettingsManager,
	providerId: string,
	existing: ProviderSettings | undefined,
	credentials: OAuthCredentials,
): ProviderSettings {
	return saveProviderOAuthCredentials({
		manager: providerSettingsManager,
		providerId,
		settings: existing,
		credentials,
	});
}

export async function ensureOAuthProviderApiKey(input: {
	providerId: string;
	currentApiKey?: string;
	existingSettings?: ProviderSettings;
	providerSettingsManager: ProviderSettingsManager;
	io: AuthIo;
}): Promise<{
	apiKey?: string;
	selectedProviderSettings?: ProviderSettings;
}> {
	if (input.currentApiKey || !isOAuthProvider(input.providerId)) {
		return {
			apiKey: input.currentApiKey,
			selectedProviderSettings: input.existingSettings,
		};
	}
	const selectedProviderSettings = await loginAndSaveProviderOAuthCredentials(
		input.providerSettingsManager,
		input.providerId,
		{ callbacks: createOAuthCallbacks(input.io) },
	);
	const handler = getProviderAuthHandler(input.providerId);
	return {
		apiKey: handler?.getApiKey(selectedProviderSettings),
		selectedProviderSettings,
	};
}

async function runQuickAuthSetup(input: AuthCommandInput): Promise<number> {
	const providerId = normalizeProviderId((input.explicitProvider ?? "").trim());
	const apikey = input.apikey?.trim() ?? "";
	const modelid = input.modelid?.trim() ?? "";
	const baseurl = input.baseurl?.trim();
	const azureApiVersion = input.azureApiVersion?.trim();
	const validationError = await ensureQuickSetupInputValid(
		{
			provider: providerId,
			apikey,
			modelid,
			baseurl,
			azureApiVersion,
		},
		input.providerSettingsManager,
	);
	if (validationError) {
		input.io.writeErr(validationError);
		return 1;
	}
	saveQuickAuthProviderSettings({
		providerSettingsManager: input.providerSettingsManager,
		providerId,
		apikey,
		modelid,
		baseurl,
		azureApiVersion,
	});
	input.io.writeln(
		`${c.green}提供方已配置：${c.reset} ${c.cyan}${providerId}${c.reset} (${modelid})`,
	);
	return 0;
}

export async function loadAuthTuiRuntime() {
	disableOpenTuiGraphicsProbe();
	const { createCliRenderer } = await import("@opentui/core");
	const { createRoot } = await import("@opentui/react");
	const { OnboardingView } = await import("../tui/views/onboarding");
	return { createCliRenderer, createRoot, OnboardingView };
}

async function runInteractiveAuthTui(input: AuthCommandInput): Promise<number> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		input.io.writeErr(
			"交互式 auth 设置需要 TTY（使用 --provider/--apikey/--modelid 进行非交互式设置）",
		);
		return 1;
	}
	const { createCliRenderer, createRoot, OnboardingView } =
		await loadAuthTuiRuntime();
	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
		autoFocus: false,
		enableMouseMovement: true,
	});

	return await new Promise<number>((resolve, reject) => {
		let root: ReturnType<typeof createRoot>;
		try {
			root = createRoot(renderer);
		} catch (error) {
			renderer.destroy();
			reject(error);
			return;
		}
		let settled = false;
		let unmounted = false;
		const unmountRoot = () => {
			if (unmounted) {
				return;
			}
			unmounted = true;
			root.unmount();
		};
		const settle = (code: number) => {
			if (settled) {
				return;
			}
			settled = true;
			unmountRoot();
			renderer.destroy();
			resolve(code);
		};
		renderer.on("destroy", () => {
			unmountRoot();
			if (!settled) {
				settled = true;
				resolve(1);
			}
		});
		try {
			root.render(
				React.createElement(OnboardingView, {
					providerSettingsManager: input.providerSettingsManager,
					onComplete: () => settle(0),
					onExit: () => settle(1),
				}),
			);
		} catch (error) {
			unmountRoot();
			renderer.destroy();
			reject(error);
		}
	});
}

export async function runAuthCommand(input: AuthCommandInput): Promise<number> {
	const hasQuickSetupFlags =
		typeof input.apikey === "string" ||
		typeof input.modelid === "string" ||
		typeof input.baseurl === "string" ||
		typeof input.azureApiVersion === "string";

	if (hasQuickSetupFlags) {
		if (!input.explicitProvider?.trim()) {
			input.io.writeErr(
				"使用 --apikey/--modelid/--baseurl/--azure-api-version 时，auth 快速设置需要 --provider <id>",
			);
			return 1;
		}
		return runQuickAuthSetup(input);
	}

	if (input.explicitProvider?.trim()) {
		const providerId = normalizeAuthProviderId(input.explicitProvider);
		if (isOAuthProvider(providerId)) {
			return runAuthProviderCommand(
				input.providerSettingsManager,
				providerId,
				input.io,
			);
		}
		input.io.writeErr(
			`提供方 "${providerId}" 需要 API 密钥设置（使用子命令：auth --provider ${providerId} --apikey <key> --modelid <id>）`,
		);
		return 1;
	}

	return runInteractiveAuthTui(input);
}

export async function runAuthProviderCommand(
	providerSettingsManager: ProviderSettingsManager,
	providerId: string,
	io: AuthIo,
): Promise<number> {
	if (!isOAuthProvider(providerId)) {
		io.writeErr(
			`提供方 "${providerId}" 不支持 OAuth 登录（支持：cline、openai-codex、oca）`,
		);
		return 1;
	}
	try {
		const settings = await loginAndSaveProviderOAuthCredentials(
			providerSettingsManager,
			providerId,
			{ callbacks: createOAuthCallbacks(io) },
		);
		identifyTelemetryAccount({
			id: settings.auth?.accountId,
			provider: providerId,
		});
		io.writeln(
			`${c.green}你现在已登录到 ${c.cyan}${providerId}${c.reset}`,
		);
		return 0;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}
