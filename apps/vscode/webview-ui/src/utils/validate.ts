import { ApiConfiguration } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"

export function validateApiConfiguration(currentMode: Mode, apiConfiguration?: ApiConfiguration): string | undefined {
	if (apiConfiguration) {
		const { apiProvider, openAiModelId, togetherModelId, ollamaModelId, lmStudioModelId, vsCodeLmModelSelector } =
			getModeSpecificFields(apiConfiguration, currentMode)
		const tips = "您必须提供有效的API密钥或选择其他提供者。"
		switch (apiProvider) {
			case "anthropic":
				if (!apiConfiguration.apiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "bedrock":
				if (!apiConfiguration.awsRegion) {
					return "你必须选择区域才能使用 AWS Bedrock。"
				}
				break
			case "openrouter":
				if (!apiConfiguration.openRouterApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "vertex":
				if (!apiConfiguration.vertexProjectId || !apiConfiguration.vertexRegion) {
					return "你必须提供有效的 Google Cloud 项目 ID 和区域。"
				}
				break
			case "gemini":
				if (!apiConfiguration.geminiApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "openai-native":
				if (!apiConfiguration.openAiNativeApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "deepseek":
				if (!apiConfiguration.deepSeekApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "xai":
				if (!apiConfiguration.xaiApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "qwen":
				if (!apiConfiguration.qwenApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "doubao":
				if (!apiConfiguration.doubaoApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "mistral":
				if (!apiConfiguration.mistralApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "cline":
				break
			case "openai-codex":
				// Authentication is handled via OAuth, not API key
				// Validation happens at runtime in the handler
				break
			case "openai":
				if (
					!apiConfiguration.openAiBaseUrl ||
					(!apiConfiguration.openAiApiKey && !apiConfiguration.azureIdentity) ||
					!openAiModelId
				) {
					return "你必须提供有效的基础 URL、API 密钥和模型 ID。"
				}
				break
			case "requesty":
				if (!apiConfiguration.requestyApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "fireworks":
				if (!apiConfiguration.fireworksApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "together":
				if (!apiConfiguration.togetherApiKey || !togetherModelId) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "ollama":
				if (!ollamaModelId) {
					return "你必须提供有效的模型 ID。"
				}
				break
			case "lmstudio":
				if (!lmStudioModelId) {
					return "你必须提供有效的模型 ID。"
				}
				break
			case "vscode-lm":
				if (!vsCodeLmModelSelector) {
					return "你必须提供有效的模型选择器。"
				}
				break
			case "moonshot":
				if (!apiConfiguration.moonshotApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "nebius":
				if (!apiConfiguration.nebiusApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "asksage":
				if (!apiConfiguration.asksageApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "sambanova":
				if (!apiConfiguration.sambanovaApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "sapaicore":
				if (!apiConfiguration.sapAiCoreBaseUrl) {
					return "你必须提供有效的基础 URL 密钥，或选择其他提供商。"
				}
				if (!apiConfiguration.sapAiCoreClientId) {
					return "你必须提供有效的客户端 ID，或选择其他提供商。"
				}
				if (!apiConfiguration.sapAiCoreClientSecret) {
					return "你必须提供有效的客户端密钥，或选择其他提供商。"
				}
				if (!apiConfiguration.sapAiCoreTokenUrl) {
					return "你必须提供有效的认证 URL，或选择其他提供商。"
				}
				break
			case "zai":
				if (!apiConfiguration.zaiApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "dify":
				if (!apiConfiguration.difyBaseUrl) {
					return "你必须提供有效的基础 URL，或选择其他提供商。"
				}
				if (!apiConfiguration.difyApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "minimax":
				if (!apiConfiguration.minimaxApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "hicap":
				if (!apiConfiguration.hicapApiKey) {
					return "你必须提供有效的 API 密钥"
				}
				break
			case "wandb":
				if (!apiConfiguration.wandbApiKey) {
					return "你必须提供有效的 API 密钥，或选择其他提供商。"
				}
				break
			case "shengsuanyun":
				if (!apiConfiguration.shengSuanYunApiKey) {
					return tips
				}
				break
		}
	}
	return undefined
}
