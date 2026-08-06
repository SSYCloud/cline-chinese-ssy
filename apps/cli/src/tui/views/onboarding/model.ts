import { isOpenAICodexCliProvider } from "../../../utils/codex-cli";
import { isOAuthProvider } from "../../../utils/provider-auth";

export type OnboardingStep =
	| "menu"
	| "oauth_pending"
	| "device_code"
	| "byo_provider"
	| "byo_apikey"
	| "codex_cli_setup"
	| "cline_pass_subscription"
	| "cline_model"
	| "model_picker"
	| "custom_model_id"
	| "thinking_level"
	| "done";

export type ThinkingLevel = "none" | "low" | "medium" | "high" | "xhigh";
export type ReasoningEffort = Exclude<ThinkingLevel, "none">;

export const THINKING_LEVELS: {
	value: ThinkingLevel;
	label: string;
	desc: string;
}[] = [
	{ value: "none", label: "关闭", desc: "无扩展思考" },
	{ value: "low", label: "低", desc: "最少推理" },
	{ value: "medium", label: "中", desc: "平衡推理" },
	{ value: "high", label: "高", desc: "深度推理" },
	{ value: "xhigh", label: "极高", desc: "最大推理" },
];

export const DEFAULT_THINKING_LEVEL_INDEX = THINKING_LEVELS.findIndex(
	(l) => l.value === "medium",
);

export interface MenuOption {
	label: string;
	value: string;
	detail: string;
	icon: string;
}

export type ClinePassSubscriptionAction =
	| "subscribe"
	| "refresh"
	| "skip"
	| "back";

export interface ClinePassSubscriptionOption {
	value: ClinePassSubscriptionAction;
	label: string;
}

export const MAIN_MENU: MenuOption[] = [
	{
		label: "\u4f7f\u7528 Cline \u767b\u5f55",
		value: "cline",
		detail: "\u6700\u65b0\u6a21\u578b\uff0c\u5b9a\u671f\u514d\u8d39\u4fc3\u9500",
		icon: "\u263a",
	},
	{
		label: "\u4f7f\u7528 ClinePass \u767b\u5f55",
		value: "cline-pass",
		detail: "\u9762\u5411\u6240\u6709\u4eba\u7684\u4f4e\u6210\u672c\u8ba2\u9605",
		icon: "\u2726",
	},
	{
		label: "\u4f7f\u7528 ChatGPT \u767b\u5f55",
		value: "openai-codex",
		detail: "\u4f7f\u7528\u4f60\u7684 ChatGPT Plus \u8ba2\u9605",
		icon: "\u2726",
	},
	{
		label: "\u81ea\u5e26\u63d0\u4f9b\u5546",
		value: "byo",
		detail: "API \u5bc6\u94a5\u6216\u672c\u5730\u670d\u52a1\u5668\uff08\u4f8b\u5982 Ollama\uff09",
		icon: "\u26b7",
	},
];

export function getMainMenuOptions(options?: {
	isClinePassEnabled?: boolean;
}): MenuOption[] {
	return MAIN_MENU.filter(
		(option) => option.value !== "cline-pass" || options?.isClinePassEnabled,
	);
}

export const CLINE_PASS_SUBSCRIPTION_OPTIONS: ClinePassSubscriptionOption[] = [
	{
		value: "subscribe",
		label: "订阅 ClinePass",
	},
	{
		value: "refresh",
		label: "重新检查订阅状态",
	},
	{
		value: "skip",
		label: "暂时跳过",
	},
	{
		value: "back",
		label: "返回",
	},
];

export interface OnboardingResult {
	providerId: string;
	modelId: string;
	apiKey?: string;
	thinking?: boolean;
	reasoningEffort?: ReasoningEffort;
}

export interface ProviderEntry {
	id: string;
	name: string;
	isOAuth: boolean;
	isLocalAuth: boolean;
	hasAuth: boolean;
	capabilities?: readonly string[];
	models: number | null;
	defaultModelId?: string;
}

export interface ModelEntry {
	id: string;
	name: string;
	supportsReasoning: boolean;
}

export type ClinePassSubscriptionStatus =
	| "loading"
	| "subscribed"
	| "unsubscribed"
	| "error";

export interface ProviderCatalogItem {
	id: string;
	name: string;
	apiKey?: string;
	oauthAccessTokenPresent?: boolean;
	capabilities?: readonly string[];
	models: number | null;
	defaultModelId?: string;
}

export interface ProviderModelItem {
	id: string;
	name?: string;
	supportsReasoning?: boolean;
}

export interface KnownModelInfo {
	name?: string;
	capabilities?: string[];
}

export function toProviderEntry(provider: ProviderCatalogItem): ProviderEntry {
	return {
		id: provider.id,
		name: provider.name,
		isOAuth: isOAuthProvider(provider.id),
		isLocalAuth: isOpenAICodexCliProvider(provider.id),
		hasAuth:
			Boolean(provider.apiKey) || provider.oauthAccessTokenPresent === true,
		...(provider.capabilities ? { capabilities: provider.capabilities } : {}),
		models: provider.models,
		defaultModelId: provider.defaultModelId,
	};
}

export function toModelEntry(model: ProviderModelItem): ModelEntry {
	return {
		id: model.id,
		name: model.name || model.id,
		supportsReasoning: model.supportsReasoning === true,
	};
}

export function toModelEntriesFromKnownModels(
	knownModels: Record<string, KnownModelInfo> | undefined,
): ModelEntry[] {
	if (!knownModels) return [];
	return Object.entries(knownModels)
		.map(([id, info]) => ({
			id,
			name: info.name || id,
			supportsReasoning: info.capabilities?.includes("reasoning") ?? false,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function getOAuthProviderLabel(providerId: string): string {
	if (providerId === "cline-pass") {
		return "ClinePass";
	}
	if (providerId === "cline") {
		return "Cline";
	}
	if (providerId === "openai-codex") {
		return "ChatGPT";
	}
	return providerId;
}

export function shouldUseFeaturedClineModelPicker(providerId: string): boolean {
	// ClinePass uses the featured picker too, with Subscribed/Free sections
	return providerId === "cline" || providerId === "cline-pass";
}
