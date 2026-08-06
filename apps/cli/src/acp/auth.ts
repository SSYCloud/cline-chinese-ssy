import type { ProviderSettingsManager } from "@cline/core";
import { loginAndSaveProviderOAuthCredentials } from "@cline/core";
import { getPersistedProviderApiKey } from "../commands/auth";
import { writeDiagnostic } from "../utils/output";

/**
 * Supported ACP OAuth provider IDs.
 *
 * This list doubles as the set of selectable providers (see
 * `setSessionConfigOption`)
 */
export const ACP_AUTH_METHODS = [
	{ id: "cline", name: "使用 Cline 登录" },
	{ id: "cline-pass", name: "使用 ClinePass 登录" },
	{ id: "openai-codex", name: "使用 ChatGPT 订阅登录" },
] as const;

export type AcpAuthMethodId = (typeof ACP_AUTH_METHODS)[number]["id"];

export function isAcpAuthMethodId(id: string): id is AcpAuthMethodId {
	return ACP_AUTH_METHODS.some((m) => m.id === id);
}

/**
 * Perform an OAuth login for the given provider in ACP mode.
 *
 * Since stdin/stdout are used for the JSON-RPC transport, all user-facing
 * output is written to stderr and URLs are opened via the `open` package.
 * If the OAuth flow requires interactive prompts (rare), defaults are used
 * when available; otherwise an error is thrown.
 */
async function performOAuthLogin(input: {
	providerId: AcpAuthMethodId;
	providerSettingsManager: ProviderSettingsManager;
}): Promise<string> {
	const [{ createOAuthClientCallbacks }, { default: open }] = await Promise.all(
		[import("@cline/core"), import("../utils/open")],
	);

	const callbacks = createOAuthClientCallbacks({
		onPrompt: ({ defaultValue }) => {
			if (defaultValue) {
				return Promise.resolve(defaultValue);
			}
			return Promise.reject(
				new Error(
					"OAuth 流程需要交互式输入，而 ACP 模式下不可用",
				),
			);
		},
		onOutput: (message) => writeDiagnostic(`[acp/auth] ${message}`),
		openUrl: (url) => open(url, { wait: false }).then(() => undefined),
		onOpenUrlError: ({ url }) => {
			writeDiagnostic(
				`[acp/auth] 无法自动打开浏览器。请手动打开此 URL:\n${url}`,
			);
		},
	});

	const settings = await loginAndSaveProviderOAuthCredentials(
		input.providerSettingsManager,
		input.providerId,
		{ callbacks },
	);
	const apiKey = getPersistedProviderApiKey(input.providerId, settings);
	if (!apiKey) {
		throw new Error(
			`OAuth 登录未能为 ${input.providerId} 持久保存凭据`,
		);
	}
	return apiKey;
}

export interface AcpAuthResult {
	providerId: AcpAuthMethodId;
	apiKey: string;
}

/**
 * Authenticate via OAuth for the given ACP auth method.
 *
 * Uses `ProviderSettingsManager` to check for existing credentials first,
 * falling back to a fresh OAuth login if needed.
 */
export async function authenticateAcpProvider(
	methodId: AcpAuthMethodId,
	providerSettingsManager: ProviderSettingsManager,
): Promise<AcpAuthResult> {
	const existing = providerSettingsManager.getProviderSettings(methodId);

	// Check for already-stored credentials.
	const existingKey = getPersistedProviderApiKey(methodId, existing);
	if (existingKey) {
		writeDiagnostic(`[acp/auth] 为 ${methodId} 使用现有凭据`);
		return { providerId: methodId, apiKey: existingKey };
	}

	// Perform a fresh OAuth login.
	writeDiagnostic(`[acp/auth] 正在为 ${methodId} 开始 OAuth 登录…`);
	const apiKey = await performOAuthLogin({
		providerId: methodId,
		providerSettingsManager,
	});
	writeDiagnostic(`[acp/auth] 已成功通过 ${methodId} 认证`);
	return { providerId: methodId, apiKey };
}
