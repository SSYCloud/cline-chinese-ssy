import { ApiConfiguration } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"

export function validateApiConfiguration(currentMode: Mode, apiConfiguration?: ApiConfiguration): string | undefined {
	if (apiConfiguration) {
		const { apiProvider, openAiModelId, togetherModelId, ollamaModelId, lmStudioModelId, vsCodeLmModelSelector } =
			getModeSpecificFields(apiConfiguration, currentMode)
		const tips = "您必须提供有效的API密钥,或选择其他提供商。"
		switch (apiProvider) {
			case "anthropic":
				if (!apiConfiguration.apiKey) {
					return tips
				}
				break
			case "bedrock":
				if (!apiConfiguration.awsRegion) {
					return "你必须选择区域才能使用 AWS Bedrock。"
				}
				break
			case "openrouter":
				if (!apiConfiguration.openRouterApiKey) {
					return tips
				}
				break
			case "vertex":
				if (!apiConfiguration.vertexProjectId || !apiConfiguration.vertexRegion) {
					return "你必须提供有效的 Google Cloud 项目 ID 和区域。"
				}
				break
			case "gemini":
				if (!apiConfiguration.geminiApiKey) {
					return tips
				}
				break
			case "openai-native":
				if (!apiConfiguration.openAiNativeApiKey) {
					return tips
				}
				break
			case "deepseek":
				if (!apiConfiguration.deepSeekApiKey) {
					return tips
				}
				break
			case "xai":
				if (!apiConfiguration.xaiApiKey) {
					return tips
				}
				break
			case "qwen":
				if (!apiConfiguration.qwenApiKey) {
					return tips
				}
				break
			case "doubao":
				if (!apiConfiguration.doubaoApiKey) {
					return tips
				}
				break
			case "mistral":
				if (!apiConfiguration.mistralApiKey) {
					return tips
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
					return tips
				}
				break
			case "fireworks":
				if (!apiConfiguration.fireworksApiKey) {
					return tips
				}
				break
			case "together":
				if (!apiConfiguration.togetherApiKey || !togetherModelId) {
					return tips
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
					return tips
				}
				break
			case "nebius":
				if (!apiConfiguration.nebiusApiKey) {
					return tips
				}
				break
			case "asksage":
				if (!apiConfiguration.asksageApiKey) {
					return tips
				}
				break
			case "sambanova":
				if (!apiConfiguration.sambanovaApiKey) {
					return tips
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
					return tips
				}
				if (!apiConfiguration.sapAiCoreTokenUrl) {
					return "你必须提供有效的认证 URL，或选择其他提供商。"
				}
				break
			case "zai":
				if (!apiConfiguration.zaiApiKey) {
					return tips
				}
				break
			case "dify":
				if (!apiConfiguration.difyBaseUrl) {
					return "你必须提供有效的基础 URL，或选择其他提供商。"
				}
				if (!apiConfiguration.difyApiKey) {
					return tips
				}
				break
			case "minimax":
				if (!apiConfiguration.minimaxApiKey) {
					return tips
				}
				break
			case "hicap":
				if (!apiConfiguration.hicapApiKey) {
					return "你必须提供有效的 API 密钥"
				}
				break
			case "wandb":
				if (!apiConfiguration.wandbApiKey) {
					return tips
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
