import {
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeLink,
	VSCodeOption,
	VSCodeRadio,
	VSCodeRadioGroup,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react"
import ThinkingBudgetSlider from "./ThinkingBudgetSlider"
import { useEvent, useInterval } from "react-use"
import styled from "styled-components"
import * as vscodemodels from "vscode"
import {
	anthropicDefaultModelId,
	anthropicModels,
	ApiConfiguration,
	ApiProvider,
	azureOpenAiDefaultApiVersion,
	bedrockDefaultModelId,
	bedrockModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	mistralDefaultModelId,
	mistralModels,
	ModelInfo,
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
	mainlandQwenModels,
	internationalQwenModels,
	mainlandQwenDefaultModelId,
	internationalQwenDefaultModelId,
	vertexDefaultModelId,
	vertexModels,
	askSageModels,
	askSageDefaultModelId,
	askSageDefaultURL,
	xaiDefaultModelId,
	xaiModels,
	sambanovaModels,
	sambanovaDefaultModelId,
	doubaoModels,
	doubaoDefaultModelId,
	liteLlmModelInfoSaneDefaults,
	ssyDefaultModelId,
	ssyDefaultModelInfo,
} from "@shared/api"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import OpenRouterModelPicker, { ModelDescriptionMarkdown, OPENROUTER_MODEL_PICKER_Z_INDEX } from "./OpenRouterModelPicker"
import { ClineAccountInfoCard } from "./ClineAccountInfoCard"
import RequestyModelPicker from "./RequestyModelPicker"
import SSYModelPicker from "./SSYModelPicker"
import { useOpenRouterKeyInfo } from "../ui/hooks/useOpenRouterKeyInfo"

interface ApiOptionsProps {
	showModelOptions: boolean
	apiErrorMessage?: string
	modelIdErrorMessage?: string
	isPopup?: boolean
	saveImmediately?: boolean // Add prop to control immediate saving
}

const OpenRouterBalanceDisplay = ({ apiKey }: { apiKey: string }) => {
	const { data: keyInfo, isLoading, error } = useOpenRouterKeyInfo(apiKey)

	if (isLoading) {
		return <span style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>Loading...</span>
	}

	if (error || !keyInfo || keyInfo.limit === null) {
		// Don't show anything if there's an error, no info, or no limit set
		return null
	}

	// Calculate remaining balance
	const remainingBalance = keyInfo.limit - keyInfo.usage
	const formattedBalance = remainingBalance.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 4,
	})

	return (
		<VSCodeLink
			href="https://openrouter.ai/settings/keys"
			title={`Remaining balance: ${formattedBalance}\nLimit: ${keyInfo.limit.toLocaleString("en-US", { style: "currency", currency: "USD" })}\nUsage: ${keyInfo.usage.toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
			style={{
				fontSize: "12px",
				color: "var(--vscode-foreground)",
				textDecoration: "none",
				fontWeight: 500,
				paddingLeft: 4,
				cursor: "pointer",
			}}>
			Balance: {formattedBalance}
		</VSCodeLink>
	)
}

// This is necessary to ensure dropdown opens downward, important for when this is used in popup
const DROPDOWN_Z_INDEX = OPENROUTER_MODEL_PICKER_Z_INDEX + 2 // Higher than the OpenRouterModelPicker's and ModelSelectorTooltip's z-index

export const DropdownContainer = styled.div<{ zIndex?: number }>`
	position: relative;
	z-index: ${(props) => props.zIndex || DROPDOWN_Z_INDEX};

	// Force dropdowns to open downward
	& vscode-dropdown::part(listbox) {
		position: absolute !important;
		top: 100% !important;
		bottom: auto !important;
	}
`

declare module "vscode" {
	interface LanguageModelChatSelector {
		vendor?: string
		family?: string
		version?: string
		id?: string
	}
}

const ApiOptions = ({
	showModelOptions,
	apiErrorMessage,
	modelIdErrorMessage,
	isPopup,
	saveImmediately = false, // Default to false
}: ApiOptionsProps) => {
	// Use full context state for immediate save payload
	const extensionState = useExtensionState()
	const { apiConfiguration, setApiConfiguration, uriScheme } = extensionState
	const [ollamaModels, setOllamaModels] = useState<string[]>([])
	const [lmStudioModels, setLmStudioModels] = useState<string[]>([])
	const [vsCodeLmModels, setVsCodeLmModels] = useState<vscodemodels.LanguageModelChatSelector[]>([])
	const [anthropicBaseUrlSelected, setAnthropicBaseUrlSelected] = useState(!!apiConfiguration?.anthropicBaseUrl)
	const [geminiBaseUrlSelected, setGeminiBaseUrlSelected] = useState(!!apiConfiguration?.geminiBaseUrl)
	const [azureApiVersionSelected, setAzureApiVersionSelected] = useState(!!apiConfiguration?.azureApiVersion)
	const [awsEndpointSelected, setAwsEndpointSelected] = useState(!!apiConfiguration?.awsBedrockEndpoint)
	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
	const [providerSortingSelected, setProviderSortingSelected] = useState(!!apiConfiguration?.openRouterProviderSorting)
	const [reasoningEffortSelected, setReasoningEffortSelected] = useState(!!apiConfiguration?.reasoningEffort)

	const handleInputChange = (field: keyof ApiConfiguration) => (event: any) => {
		const newValue = event.target.value

		// Update local state
		setApiConfiguration({
			...apiConfiguration,
			[field]: newValue,
		})

		// If the field is the provider AND saveImmediately is true, save it immediately using the full context state
		if (saveImmediately && field === "apiProvider") {
			// Use apiConfiguration from the full extensionState context to send the most complete data
			const currentFullApiConfig = extensionState.apiConfiguration
			vscode.postMessage({
				type: "apiConfiguration",
				apiConfiguration: {
					...currentFullApiConfig, // Send the most complete config available
					apiProvider: newValue, // Override with the new provider
				},
			})
		}
	}

	const { selectedProvider, selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	// Poll ollama/lmstudio models
	const requestLocalModels = useCallback(() => {
		if (selectedProvider === "ollama") {
			vscode.postMessage({
				type: "requestOllamaModels",
				text: apiConfiguration?.ollamaBaseUrl,
			})
		} else if (selectedProvider === "lmstudio") {
			vscode.postMessage({
				type: "requestLmStudioModels",
				text: apiConfiguration?.lmStudioBaseUrl,
			})
		} else if (selectedProvider === "vscode-lm") {
			vscode.postMessage({ type: "requestVsCodeLmModels" })
		}
	}, [selectedProvider, apiConfiguration?.ollamaBaseUrl, apiConfiguration?.lmStudioBaseUrl])
	useEffect(() => {
		if (selectedProvider === "ollama" || selectedProvider === "lmstudio" || selectedProvider === "vscode-lm") {
			requestLocalModels()
		}
	}, [selectedProvider, requestLocalModels])
	useInterval(
		requestLocalModels,
		selectedProvider === "ollama" || selectedProvider === "lmstudio" || selectedProvider === "vscode-lm" ? 2000 : null,
	)

	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message.type === "ollamaModels" && message.ollamaModels) {
			setOllamaModels(message.ollamaModels)
		} else if (message.type === "lmStudioModels" && message.lmStudioModels) {
			setLmStudioModels(message.lmStudioModels)
		} else if (message.type === "vsCodeLmModels" && message.vsCodeLmModels) {
			setVsCodeLmModels(message.vsCodeLmModels)
		}
	}, [])
	useEvent("message", handleMessage)

	/*
	VSCodeDropdown has an open bug where dynamically rendered options don't auto select the provided value prop. You can see this for yourself by comparing  it with normal select/option elements, which work as expected.
	https://github.com/microsoft/vscode-webview-ui-toolkit/issues/433

	In our case, when the user switches between providers, we recalculate the selectedModelId depending on the provider, the default model for that provider, and a modelId that the user may have selected. Unfortunately, the VSCodeDropdown component wouldn't select this calculated value, and would default to the first "Select a model..." option instead, which makes it seem like the model was cleared out when it wasn't.

	As a workaround, we create separate instances of the dropdown for each provider, and then conditionally render the one that matches the current provider.
	*/
	const createDropdown = (models: Record<string, ModelInfo>) => {
		return (
			<VSCodeDropdown
				id="model-id"
				value={selectedModelId}
				onChange={handleInputChange("apiModelId")}
				style={{ width: "100%" }}>
				<VSCodeOption value="">选择模型...</VSCodeOption>
				{Object.keys(models).map((modelId) => (
					<VSCodeOption
						key={modelId}
						value={modelId}
						style={{
							whiteSpace: "normal",
							wordWrap: "break-word",
							maxWidth: "100%",
						}}>
						{modelId}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
		)
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: isPopup ? -10 : 0 }}>
			<DropdownContainer className="dropdown-container">
				<label htmlFor="api-provider">
					<span style={{ fontWeight: 500 }}>API 供应商</span>
				</label>
				<VSCodeDropdown
					id="api-provider"
					value={selectedProvider}
					onChange={handleInputChange("apiProvider")}
					style={{
						minWidth: 130,
						position: "relative",
					}}>
					<VSCodeOption value="shengsuanyun">胜算云</VSCodeOption>
					<VSCodeOption value="cline">Cline</VSCodeOption>
					<VSCodeOption value="openrouter">OpenRouter</VSCodeOption>
					<VSCodeOption value="anthropic">Anthropic</VSCodeOption>
					<VSCodeOption value="bedrock">Amazon Bedrock</VSCodeOption>
					<VSCodeOption value="openai">OpenAI Compatible</VSCodeOption>
					<VSCodeOption value="vertex">GCP Vertex AI</VSCodeOption>
					<VSCodeOption value="gemini">Google Gemini</VSCodeOption>
					<VSCodeOption value="deepseek">DeepSeek</VSCodeOption>
					<VSCodeOption value="mistral">Mistral</VSCodeOption>
					<VSCodeOption value="openai-native">OpenAI</VSCodeOption>
					<VSCodeOption value="vscode-lm">VS Code LM API</VSCodeOption>
					<VSCodeOption value="requesty">Requesty</VSCodeOption>
					<VSCodeOption value="together">Together</VSCodeOption>
					<VSCodeOption value="qwen">Alibaba Qwen</VSCodeOption>
					<VSCodeOption value="doubao">Bytedance Doubao</VSCodeOption>
					<VSCodeOption value="lmstudio">LM Studio</VSCodeOption>
					<VSCodeOption value="ollama">Ollama</VSCodeOption>
					<VSCodeOption value="litellm">LiteLLM</VSCodeOption>
					<VSCodeOption value="asksage">AskSage</VSCodeOption>
					<VSCodeOption value="xai">xAI</VSCodeOption>
					<VSCodeOption value="sambanova">SambaNova</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>

			{selectedProvider === "cline" && (
				<div style={{ marginBottom: 14, marginTop: 4 }}>
					<ClineAccountInfoCard />
				</div>
			)}
			{selectedProvider === "asksage" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.asksageApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("asksageApiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>AskSage API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						API key 保存在本地，只会被本插件用来请求API.
					</p>
					<VSCodeTextField
						value={apiConfiguration?.asksageApiUrl || askSageDefaultURL}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("asksageApiUrl")}
						placeholder="输入 AskSage API URL...">
						<span style={{ fontWeight: 500 }}>AskSage API URL</span>
					</VSCodeTextField>
				</div>
			)}

			{selectedProvider === "anthropic" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("apiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>Anthropic API Key</span>
					</VSCodeTextField>

					<VSCodeCheckbox
						checked={anthropicBaseUrlSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setAnthropicBaseUrlSelected(isChecked)
							if (!isChecked) {
								setApiConfiguration({
									...apiConfiguration,
									anthropicBaseUrl: "",
								})
							}
						}}>
						使用自定义 base URL
					</VSCodeCheckbox>

					{anthropicBaseUrlSelected && (
						<VSCodeTextField
							value={apiConfiguration?.anthropicBaseUrl || ""}
							style={{ width: "100%", marginTop: 3 }}
							type="url"
							onInput={handleInputChange("anthropicBaseUrl")}
							placeholder="Default: https://api.anthropic.com"
						/>
					)}

					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						API key 保存在本地，只会被本插件用来请求API.
						{!apiConfiguration?.apiKey && (
							<VSCodeLink
								href="https://console.anthropic.com/settings/keys"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								注册获取 Anthropic API key.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "openai-native" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.openAiNativeApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("openAiNativeApiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>OpenAI API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						API key 保存在本地，只会被本插件用来请求API.
						{!apiConfiguration?.openAiNativeApiKey && (
							<VSCodeLink
								href="https://platform.openai.com/api-keys"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								注册获取 OpenAI API key.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "deepseek" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.deepSeekApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("deepSeekApiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>DeepSeek API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						API key 保存在本地，只会被本插件用来请求API.
						{!apiConfiguration?.deepSeekApiKey && (
							<VSCodeLink
								href="https://www.deepseek.com/"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								注册获取 DeepSeek API key.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "qwen" && (
				<div>
					<DropdownContainer className="dropdown-container" style={{ position: "inherit" }}>
						<label htmlFor="qwen-line-provider">
							<span style={{ fontWeight: 500, marginTop: 5 }}>Alibaba API Line</span>
						</label>
						<VSCodeDropdown
							id="qwen-line-provider"
							value={apiConfiguration?.qwenApiLine || "china"}
							onChange={handleInputChange("qwenApiLine")}
							style={{
								minWidth: 130,
								position: "relative",
							}}>
							<VSCodeOption value="china">中国大陆 API</VSCodeOption>
							<VSCodeOption value="international">国际 API</VSCodeOption>
						</VSCodeDropdown>
					</DropdownContainer>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						请根据你的所在地选择合适的API。如果你在中国，选择“中国大陆 API”,否则，选择“国际 API”
					</p>
					<VSCodeTextField
						value={apiConfiguration?.qwenApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("qwenApiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>Qwen API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						API key 保存在本地，只会被本插件用来请求API.
						{!apiConfiguration?.qwenApiKey && (
							<VSCodeLink
								href="https://bailian.console.aliyun.com/"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								注册获取 Qwen API key .
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "doubao" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.doubaoApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("doubaoApiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>Doubao API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						API key 保存在本地，只会被本插件用来请求API.
						{!apiConfiguration?.doubaoApiKey && (
							<VSCodeLink
								href="https://console.volcengine.com/home"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								注册获取 Doubao API key.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "mistral" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.mistralApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("mistralApiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>Mistral API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						API key 保存在本地，只会被本插件用来请求API.
						{!apiConfiguration?.mistralApiKey && (
							<VSCodeLink
								href="https://console.mistral.ai/codestral"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								注册获取 Mistral API key.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "openrouter" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.openRouterApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("openRouterApiKey")}
						placeholder="输入 API Key...">
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
							<span style={{ fontWeight: 500 }}>OpenRouter API Key</span>
							{apiConfiguration?.openRouterApiKey && (
								<OpenRouterBalanceDisplay apiKey={apiConfiguration.openRouterApiKey} />
							)}
						</div>
					</VSCodeTextField>
					{!apiConfiguration?.openRouterApiKey && (
						<VSCodeButtonLink
							href={getOpenRouterAuthUrl(uriScheme)}
							style={{ margin: "5px 0 0 0" }}
							appearance="secondary">
							获取 OpenRouter API Key
						</VSCodeButtonLink>
					)}
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						API key 保存在本地，只会被本插件用来请求API.{" "}
						{/* {!apiConfiguration?.openRouterApiKey && (
							<span style={{ color: "var(--vscode-charts-green)" }}>
								(<span style={{ fontWeight: 500 }}>Note:</span> OpenRouter is recommended for high rate
								limits, prompt caching, and wider selection of models.)
							</span>
						)} */}
					</p>
				</div>
			)}

			{selectedProvider === "bedrock" && (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 5,
					}}>
					<VSCodeRadioGroup
						value={apiConfiguration?.awsUseProfile ? "profile" : "credentials"}
						onChange={(e) => {
							const value = (e.target as HTMLInputElement)?.value
							const useProfile = value === "profile"
							setApiConfiguration({
								...apiConfiguration,
								awsUseProfile: useProfile,
							})
						}}>
						<VSCodeRadio value="credentials">AWS 凭证</VSCodeRadio>
						<VSCodeRadio value="profile">AWS 账户</VSCodeRadio>
					</VSCodeRadioGroup>

					{apiConfiguration?.awsUseProfile ? (
						<VSCodeTextField
							value={apiConfiguration?.awsProfile || ""}
							style={{ width: "100%" }}
							onInput={handleInputChange("awsProfile")}
							placeholder="输入用户名 (默认为空)">
							<span style={{ fontWeight: 500 }}>AWS 用户名</span>
						</VSCodeTextField>
					) : (
						<>
							<VSCodeTextField
								value={apiConfiguration?.awsAccessKey || ""}
								style={{ width: "100%" }}
								type="password"
								onInput={handleInputChange("awsAccessKey")}
								placeholder="输入 Access Key...">
								<span style={{ fontWeight: 500 }}>AWS Access Key</span>
							</VSCodeTextField>
							<VSCodeTextField
								value={apiConfiguration?.awsSecretKey || ""}
								style={{ width: "100%" }}
								type="password"
								onInput={handleInputChange("awsSecretKey")}
								placeholder="输入 Secret Key...">
								<span style={{ fontWeight: 500 }}>AWS Secret Key</span>
							</VSCodeTextField>
							<VSCodeTextField
								value={apiConfiguration?.awsSessionToken || ""}
								style={{ width: "100%" }}
								type="password"
								onInput={handleInputChange("awsSessionToken")}
								placeholder="输入 Session Token...">
								<span style={{ fontWeight: 500 }}>AWS Session Token</span>
							</VSCodeTextField>
						</>
					)}
					<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 1} className="dropdown-container">
						<label htmlFor="aws-region-dropdown">
							<span style={{ fontWeight: 500 }}>AWS 地区</span>
						</label>
						<VSCodeDropdown
							id="aws-region-dropdown"
							value={apiConfiguration?.awsRegion || ""}
							style={{ width: "100%" }}
							onChange={handleInputChange("awsRegion")}>
							<VSCodeOption value="">选择地区...</VSCodeOption>
							{/* The user will have to choose a region that supports the model they use, but this shouldn't be a problem since they'd have to request access for it in that region in the first place. */}
							<VSCodeOption value="us-east-1">us-east-1</VSCodeOption>
							<VSCodeOption value="us-east-2">us-east-2</VSCodeOption>
							{/* <VSCodeOption value="us-west-1">us-west-1</VSCodeOption> */}
							<VSCodeOption value="us-west-2">us-west-2</VSCodeOption>
							{/* <VSCodeOption value="af-south-1">af-south-1</VSCodeOption> */}
							{/* <VSCodeOption value="ap-east-1">ap-east-1</VSCodeOption> */}
							<VSCodeOption value="ap-south-1">ap-south-1</VSCodeOption>
							<VSCodeOption value="ap-northeast-1">ap-northeast-1</VSCodeOption>
							<VSCodeOption value="ap-northeast-2">ap-northeast-2</VSCodeOption>
							<VSCodeOption value="ap-northeast-3">ap-northeast-3</VSCodeOption>
							<VSCodeOption value="ap-southeast-1">ap-southeast-1</VSCodeOption>
							<VSCodeOption value="ap-southeast-2">ap-southeast-2</VSCodeOption>
							<VSCodeOption value="ca-central-1">ca-central-1</VSCodeOption>
							<VSCodeOption value="eu-central-1">eu-central-1</VSCodeOption>
							<VSCodeOption value="eu-central-2">eu-central-2</VSCodeOption>
							<VSCodeOption value="eu-west-1">eu-west-1</VSCodeOption>
							<VSCodeOption value="eu-west-2">eu-west-2</VSCodeOption>
							<VSCodeOption value="eu-west-3">eu-west-3</VSCodeOption>
							<VSCodeOption value="eu-north-1">eu-north-1</VSCodeOption>
							{/* <VSCodeOption value="me-south-1">me-south-1</VSCodeOption> */}
							<VSCodeOption value="sa-east-1">sa-east-1</VSCodeOption>
							<VSCodeOption value="us-gov-east-1">us-gov-east-1</VSCodeOption>
							<VSCodeOption value="us-gov-west-1">us-gov-west-1</VSCodeOption>
							{/* <VSCodeOption value="us-gov-east-1">us-gov-east-1</VSCodeOption> */}
						</VSCodeDropdown>
					</DropdownContainer>

					<div style={{ display: "flex", flexDirection: "column" }}>
						<VSCodeCheckbox
							checked={awsEndpointSelected}
							onChange={(e: any) => {
								const isChecked = e.target.checked === true
								setAwsEndpointSelected(isChecked)
								if (!isChecked) {
									setApiConfiguration({
										...apiConfiguration,
										awsBedrockEndpoint: "",
									})
								}
							}}>
							使用自定义 VPC 接入点
						</VSCodeCheckbox>

						{awsEndpointSelected && (
							<VSCodeTextField
								value={apiConfiguration?.awsBedrockEndpoint || ""}
								style={{ width: "100%", marginTop: 3, marginBottom: 5 }}
								type="url"
								onInput={handleInputChange("awsBedrockEndpoint")}
								placeholder="输入 VPC 接入点 (可选)"
							/>
						)}

						<VSCodeCheckbox
							checked={apiConfiguration?.awsUseCrossRegionInference || false}
							onChange={(e: any) => {
								const isChecked = e.target.checked === true
								setApiConfiguration({
									...apiConfiguration,
									awsUseCrossRegionInference: isChecked,
								})
							}}>
							使用跨地区推理
						</VSCodeCheckbox>

						{selectedModelInfo.supportsPromptCache && (
							<>
								<VSCodeCheckbox
									checked={apiConfiguration?.awsBedrockUsePromptCache || false}
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										setApiConfiguration({
											...apiConfiguration,
											awsBedrockUsePromptCache: isChecked,
										})
									}}>
									使用提示词缓存
								</VSCodeCheckbox>
							</>
						)}
					</div>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						{apiConfiguration?.awsUseProfile ? (
							<>
								使用 ~/.aws/credentials 中的 AWS 配置文件凭证。将配置文件名称留空以使用默认
								轮廓。这些凭证仅在本地用于从此扩展发出 API 请求。
							</>
						) : (
							<>
								通过提供上述密钥或使用默认的 AWS 凭证提供程序进行身份验证，即 ~/.aws/credentials
								或环境变量。这些凭证仅在本地用于制作 API 来自此扩展的请求。
							</>
						)}
					</p>
				</div>
			)}

			{apiConfiguration?.apiProvider === "vertex" && (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 5,
					}}>
					<VSCodeTextField
						value={apiConfiguration?.vertexProjectId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("vertexProjectId")}
						placeholder="Enter Project ID...">
						<span style={{ fontWeight: 500 }}>Google Cloud Project ID</span>
					</VSCodeTextField>
					<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 1} className="dropdown-container">
						<label htmlFor="vertex-region-dropdown">
							<span style={{ fontWeight: 500 }}>Google Cloud 地区</span>
						</label>
						<VSCodeDropdown
							id="vertex-region-dropdown"
							value={apiConfiguration?.vertexRegion || ""}
							style={{ width: "100%" }}
							onChange={handleInputChange("vertexRegion")}>
							<VSCodeOption value="">选择地区...</VSCodeOption>
							<VSCodeOption value="us-east5">us-east5</VSCodeOption>
							<VSCodeOption value="us-central1">us-central1</VSCodeOption>
							<VSCodeOption value="europe-west1">europe-west1</VSCodeOption>
							<VSCodeOption value="europe-west4">europe-west4</VSCodeOption>
							<VSCodeOption value="asia-southeast1">asia-southeast1</VSCodeOption>
						</VSCodeDropdown>
					</DropdownContainer>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						To use Google Cloud Vertex AI, you need to
						<VSCodeLink
							href="https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin"
							style={{ display: "inline", fontSize: "inherit" }}>
							{"1) 创建 Google Cloud 账户 › 启用 Vertex AI API › 启用 desired Claude models,"}
						</VSCodeLink>{" "}
						<VSCodeLink
							href="https://cloud.google.com/docs/authentication/provide-credentials-adc#google-idp"
							style={{ display: "inline", fontSize: "inherit" }}>
							{"2) 安装 Google Cloud CLI › 配置 Application Default Credentials."}
						</VSCodeLink>
					</p>
				</div>
			)}

			{selectedProvider === "gemini" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.geminiApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("geminiApiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>Gemini API Key</span>
					</VSCodeTextField>

					<VSCodeCheckbox
						checked={geminiBaseUrlSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setGeminiBaseUrlSelected(isChecked)
							if (!isChecked) {
								setApiConfiguration({
									...apiConfiguration,
									geminiBaseUrl: "",
								})
							}
						}}>
						Use custom base URL
					</VSCodeCheckbox>

					{geminiBaseUrlSelected && (
						<VSCodeTextField
							value={apiConfiguration?.geminiBaseUrl || ""}
							style={{ width: "100%", marginTop: 3 }}
							type="url"
							onInput={handleInputChange("geminiBaseUrl")}
							placeholder="Default: https://generativelanguage.googleapis.com"
						/>
					)}

					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						API key 保存在本地，只会被本插件用来请求API.
						{!apiConfiguration?.geminiApiKey && (
							<VSCodeLink
								href="https://aistudio.google.com/apikey"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								注册获取 Gemini API key .
							</VSCodeLink>
						)}
					</p>

					{/* Add Thinking Budget Slider specifically for gemini-2.5-flash-preview-04-17 */}
					{selectedProvider === "gemini" && selectedModelId === "gemini-2.5-flash-preview-04-17" && (
						<ThinkingBudgetSlider
							apiConfiguration={apiConfiguration}
							setApiConfiguration={setApiConfiguration}
							maxBudget={selectedModelInfo.thinkingConfig?.maxBudget}
						/>
					)}
				</div>
			)}

			{selectedProvider === "openai" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.openAiBaseUrl || ""}
						style={{ width: "100%", marginBottom: 10 }}
						type="url"
						onInput={handleInputChange("openAiBaseUrl")}
						placeholder={"Enter base URL..."}>
						<span style={{ fontWeight: 500 }}>Base URL</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.openAiApiKey || ""}
						style={{ width: "100%", marginBottom: 10 }}
						type="password"
						onInput={handleInputChange("openAiApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>API Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.openAiModelId || ""}
						style={{ width: "100%", marginBottom: 10 }}
						onInput={handleInputChange("openAiModelId")}
						placeholder={"Enter Model ID..."}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>

					{/* OpenAI Compatible Custom Headers */}
					{(() => {
						const headerEntries = Object.entries(apiConfiguration?.openAiHeaders ?? {})
						return (
							<div style={{ marginBottom: 10 }}>
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
									<span style={{ fontWeight: 500 }}>Custom Headers</span>
									<VSCodeButton
										onClick={() => {
											const currentHeaders = { ...(apiConfiguration?.openAiHeaders || {}) }
											const headerCount = Object.keys(currentHeaders).length
											const newKey = `header${headerCount + 1}`
											currentHeaders[newKey] = ""
											handleInputChange("openAiHeaders")({
												target: {
													value: currentHeaders,
												},
											})
										}}>
										Add Header
									</VSCodeButton>
								</div>
								<div>
									{headerEntries.map(([key, value], index) => (
										<div key={index} style={{ display: "flex", gap: 5, marginTop: 5 }}>
											<VSCodeTextField
												value={key}
												style={{ width: "40%" }}
												placeholder="Header name"
												onInput={(e: any) => {
													const currentHeaders = apiConfiguration?.openAiHeaders ?? {}
													const newValue = e.target.value
													if (newValue && newValue !== key) {
														const { [key]: _, ...rest } = currentHeaders
														handleInputChange("openAiHeaders")({
															target: {
																value: {
																	...rest,
																	[newValue]: value,
																},
															},
														})
													}
												}}
											/>
											<VSCodeTextField
												value={value}
												style={{ width: "40%" }}
												placeholder="Header value"
												onInput={(e: any) => {
													handleInputChange("openAiHeaders")({
														target: {
															value: {
																...(apiConfiguration?.openAiHeaders ?? {}),
																[key]: e.target.value,
															},
														},
													})
												}}
											/>
											<VSCodeButton
												appearance="secondary"
												onClick={() => {
													const { [key]: _, ...rest } = apiConfiguration?.openAiHeaders ?? {}
													handleInputChange("openAiHeaders")({
														target: {
															value: rest,
														},
													})
												}}>
												Remove
											</VSCodeButton>
										</div>
									))}
								</div>
							</div>
						)
					})()}

					<VSCodeCheckbox
						checked={azureApiVersionSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setAzureApiVersionSelected(isChecked)
							if (!isChecked) {
								setApiConfiguration({
									...apiConfiguration,
									azureApiVersion: "",
								})
							}
						}}>
						设置 Azure API 版本
					</VSCodeCheckbox>
					{azureApiVersionSelected && (
						<VSCodeTextField
							value={apiConfiguration?.azureApiVersion || ""}
							style={{ width: "100%", marginTop: 3 }}
							onInput={handleInputChange("azureApiVersion")}
							placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
						/>
					)}
					<div
						style={{
							color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
							display: "flex",
							margin: "10px 0",
							cursor: "pointer",
							alignItems: "center",
						}}
						onClick={() => setModelConfigurationSelected((val) => !val)}>
						<span
							className={`codicon ${modelConfigurationSelected ? "codicon-chevron-down" : "codicon-chevron-right"}`}
							style={{
								marginRight: "4px",
							}}></span>
						<span
							style={{
								fontWeight: 700,
								textTransform: "uppercase",
							}}>
							Model 配置
						</span>
					</div>
					{modelConfigurationSelected && (
						<>
							<VSCodeCheckbox
								checked={!!apiConfiguration?.openAiModelInfo?.supportsImages}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									const modelInfo = apiConfiguration?.openAiModelInfo
										? apiConfiguration.openAiModelInfo
										: { ...openAiModelInfoSaneDefaults }
									modelInfo.supportsImages = isChecked
									setApiConfiguration({
										...apiConfiguration,
										openAiModelInfo: modelInfo,
									})
								}}>
								支持图片
							</VSCodeCheckbox>
							<VSCodeCheckbox
								checked={!!apiConfiguration?.openAiModelInfo?.supportsImages}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									let modelInfo = apiConfiguration?.openAiModelInfo
										? apiConfiguration.openAiModelInfo
										: { ...openAiModelInfoSaneDefaults }
									modelInfo.supportsImages = isChecked
									setApiConfiguration({
										...apiConfiguration,
										openAiModelInfo: modelInfo,
									})
								}}>
								支持 Computer Use
							</VSCodeCheckbox>
							<VSCodeCheckbox
								checked={!!apiConfiguration?.openAiModelInfo?.isR1FormatRequired}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									let modelInfo = apiConfiguration?.openAiModelInfo
										? apiConfiguration.openAiModelInfo
										: { ...openAiModelInfoSaneDefaults }
									modelInfo = { ...modelInfo, isR1FormatRequired: isChecked }

									setApiConfiguration({
										...apiConfiguration,
										openAiModelInfo: modelInfo,
									})
								}}>
								启用 R1 消息格式
							</VSCodeCheckbox>
							<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
								<VSCodeTextField
									value={
										apiConfiguration?.openAiModelInfo?.contextWindow
											? apiConfiguration.openAiModelInfo.contextWindow.toString()
											: openAiModelInfoSaneDefaults.contextWindow?.toString()
									}
									style={{ flex: 1 }}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.openAiModelInfo
											? apiConfiguration.openAiModelInfo
											: { ...openAiModelInfoSaneDefaults }
										modelInfo.contextWindow = Number(input.target.value)
										setApiConfiguration({
											...apiConfiguration,
											openAiModelInfo: modelInfo,
										})
									}}>
									<span style={{ fontWeight: 500 }}>上下文窗口大小</span>
								</VSCodeTextField>
								<VSCodeTextField
									value={
										apiConfiguration?.openAiModelInfo?.maxTokens
											? apiConfiguration.openAiModelInfo.maxTokens.toString()
											: openAiModelInfoSaneDefaults.maxTokens?.toString()
									}
									style={{ flex: 1 }}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.openAiModelInfo
											? apiConfiguration.openAiModelInfo
											: { ...openAiModelInfoSaneDefaults }
										modelInfo.maxTokens = input.target.value
										setApiConfiguration({
											...apiConfiguration,
											openAiModelInfo: modelInfo,
										})
									}}>
									<span style={{ fontWeight: 500 }}>最大输出 Tokens</span>
								</VSCodeTextField>
							</div>
							<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
								<VSCodeTextField
									value={
										apiConfiguration?.openAiModelInfo?.inputPrice
											? apiConfiguration.openAiModelInfo.inputPrice.toString()
											: openAiModelInfoSaneDefaults.inputPrice?.toString()
									}
									style={{ flex: 1 }}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.openAiModelInfo
											? apiConfiguration.openAiModelInfo
											: { ...openAiModelInfoSaneDefaults }
										modelInfo.inputPrice = input.target.value
										setApiConfiguration({
											...apiConfiguration,
											openAiModelInfo: modelInfo,
										})
									}}>
									<span style={{ fontWeight: 500 }}>输入价格 / 1M tokens</span>
								</VSCodeTextField>
								<VSCodeTextField
									value={
										apiConfiguration?.openAiModelInfo?.outputPrice
											? apiConfiguration.openAiModelInfo.outputPrice.toString()
											: openAiModelInfoSaneDefaults.outputPrice?.toString()
									}
									style={{ flex: 1 }}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.openAiModelInfo
											? apiConfiguration.openAiModelInfo
											: { ...openAiModelInfoSaneDefaults }
										modelInfo.outputPrice = input.target.value
										setApiConfiguration({
											...apiConfiguration,
											openAiModelInfo: modelInfo,
										})
									}}>
									<span style={{ fontWeight: 500 }}>输出价格 / 1M tokens</span>
								</VSCodeTextField>
							</div>
							<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
								<VSCodeTextField
									value={
										apiConfiguration?.openAiModelInfo?.temperature
											? apiConfiguration.openAiModelInfo.temperature.toString()
											: openAiModelInfoSaneDefaults.temperature?.toString()
									}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.openAiModelInfo
											? apiConfiguration.openAiModelInfo
											: { ...openAiModelInfoSaneDefaults }

										// Check if the input ends with a decimal point or has trailing zeros after decimal
										const value = input.target.value
										const shouldPreserveFormat =
											value.endsWith(".") || (value.includes(".") && value.endsWith("0"))

										modelInfo.temperature =
											value === ""
												? openAiModelInfoSaneDefaults.temperature
												: shouldPreserveFormat
													? value // Keep as string to preserve decimal format
													: parseFloat(value)

										setApiConfiguration({
											...apiConfiguration,
											openAiModelInfo: modelInfo,
										})
									}}>
									<span style={{ fontWeight: 500 }}>Temperature</span>
								</VSCodeTextField>
							</div>
						</>
					)}
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>注意:</span> Cline 使用复杂的提示，最适合与 Claude 配合使用
							模型。功能较弱的模型可能无法按预期工作。)
						</span>
					</p>
				</div>
			)}

			{selectedProvider === "requesty" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.requestyApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("requestyApiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>API Key</span>
					</VSCodeTextField>
					{!apiConfiguration?.requestyApiKey && <a href="https://app.requesty.ai/manage-api">获取 API Key</a>}
				</div>
			)}

			{selectedProvider === "together" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.togetherApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("togetherApiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>API Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.togetherModelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("togetherModelId")}
						placeholder={"输入 Model ID..."}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>注意:</span> Cline 使用复杂的提示，最适合与 Claude 配合使用
							模型。功能较弱的模型可能无法按预期工作。)
						</span>
					</p>
				</div>
			)}

			{selectedProvider === "vscode-lm" && (
				<div>
					<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 2} className="dropdown-container">
						<label htmlFor="vscode-lm-model">
							<span style={{ fontWeight: 500 }}>语言模型</span>
						</label>
						{vsCodeLmModels.length > 0 ? (
							<VSCodeDropdown
								id="vscode-lm-model"
								value={
									apiConfiguration?.vsCodeLmModelSelector
										? `${apiConfiguration.vsCodeLmModelSelector.vendor ?? ""}/${apiConfiguration.vsCodeLmModelSelector.family ?? ""}`
										: ""
								}
								onChange={(e) => {
									const value = (e.target as HTMLInputElement).value
									if (!value) {
										return
									}
									const [vendor, family] = value.split("/")
									handleInputChange("vsCodeLmModelSelector")({
										target: {
											value: { vendor, family },
										},
									})
								}}
								style={{ width: "100%" }}>
								<VSCodeOption value="">选择模型...</VSCodeOption>
								{vsCodeLmModels.map((model) => (
									<VSCodeOption
										key={`${model.vendor}/${model.family}`}
										value={`${model.vendor}/${model.family}`}>
										{model.vendor} - {model.family}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
						) : (
							<p
								style={{
									fontSize: "12px",
									marginTop: "5px",
									color: "var(--vscode-descriptionForeground)",
								}}>
								VS Code 语言模型 API 允许您运行其他 VS Code 扩展提供的模型 （包括但不限于 GitHub
								Copilot）。最简单的入门方法是安装 来自 VS Marketplace 的 Copilot 扩展并启用 Claude 3.7 Sonnet。
							</p>
						)}

						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-errorForeground)",
								fontWeight: 500,
							}}>
							注意: 这是一个非常实验性的集成，可能无法按预期工作。
						</p>
					</DropdownContainer>
				</div>
			)}

			{selectedProvider === "lmstudio" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.lmStudioBaseUrl || ""}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("lmStudioBaseUrl")}
						placeholder={"Default: http://localhost:1234"}>
						<span style={{ fontWeight: 500 }}>Base URL (可选)</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.lmStudioModelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("lmStudioModelId")}
						placeholder={"e.g. meta-llama-3.1-8b-instruct"}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>
					{lmStudioModels.length > 0 && (
						<VSCodeRadioGroup
							value={
								lmStudioModels.includes(apiConfiguration?.lmStudioModelId || "")
									? apiConfiguration?.lmStudioModelId
									: ""
							}
							onChange={(e) => {
								const value = (e.target as HTMLInputElement)?.value
								// need to check value first since radio group returns empty string sometimes
								if (value) {
									handleInputChange("lmStudioModelId")({
										target: { value },
									})
								}
							}}>
							{lmStudioModels.map((model) => (
								<VSCodeRadio key={model} value={model} checked={apiConfiguration?.lmStudioModelId === model}>
									{model}
								</VSCodeRadio>
							))}
						</VSCodeRadioGroup>
					)}
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						LM Studio 允许您在计算机上本地运行模型。有关如何开始的说明，请参阅 他们的
						<VSCodeLink href="https://lmstudio.ai/docs" style={{ display: "inline", fontSize: "inherit" }}>
							快速入门指南。
						</VSCodeLink>
						您还需要启动 LM Studio 的{" "}
						<VSCodeLink
							href="https://lmstudio.ai/docs/basics/server"
							style={{ display: "inline", fontSize: "inherit" }}>
							本地服务
						</VSCodeLink>{" "}
						功能将其与此扩展一起使用。{" "}
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>注意:</span> Cline 使用复杂的提示，最适合与 Claude 配合使用
							模型。功能较弱的模型可能无法按预期工作。)
						</span>
					</p>
				</div>
			)}

			{selectedProvider === "litellm" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.liteLlmApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("liteLlmApiKey")}
						placeholder="Default: noop">
						<span style={{ fontWeight: 500 }}>API Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.liteLlmBaseUrl || ""}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("liteLlmBaseUrl")}
						placeholder={"Default: http://localhost:4000"}>
						<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.liteLlmModelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("liteLlmModelId")}
						placeholder={"e.g. gpt-4"}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>

					<div style={{ display: "flex", flexDirection: "column", marginTop: 10, marginBottom: 10 }}>
						{selectedModelInfo.supportsPromptCache && (
							<>
								<VSCodeCheckbox
									checked={apiConfiguration?.liteLlmUsePromptCache || false}
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										setApiConfiguration({
											...apiConfiguration,
											liteLlmUsePromptCache: isChecked,
										})
									}}
									style={{ fontWeight: 500, color: "var(--vscode-charts-green)" }}>
									Use prompt caching (GA)
								</VSCodeCheckbox>
								<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-charts-green)" }}>
									提示缓存需要受支持的提供程序和模型
								</p>
							</>
						)}
					</div>

					<>
						<ThinkingBudgetSlider apiConfiguration={apiConfiguration} setApiConfiguration={setApiConfiguration} />
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							扩展思维可用于 Sonnet-3-7、o3-mini、Deepseek R1 等模型。更多信息{" "}
							<VSCodeLink
								href="https://docs.litellm.ai/docs/reasoning_content"
								style={{ display: "inline", fontSize: "inherit" }}>
								Thinking Mode 配置
							</VSCodeLink>
						</p>
					</>

					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						LiteLLM 提供了一个统一的接口来访问各种 LLM 提供商的模型。查看他们的{" "}
						<VSCodeLink href="https://docs.litellm.ai/docs/" style={{ display: "inline", fontSize: "inherit" }}>
							入门指南
						</VSCodeLink>{" "}
						获取更多信息。
					</p>
				</div>
			)}

			{selectedProvider === "ollama" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.ollamaBaseUrl || ""}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("ollamaBaseUrl")}
						placeholder={"Default: http://localhost:11434"}>
						<span style={{ fontWeight: 500 }}>Base URL (可选)</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.ollamaModelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("ollamaModelId")}
						placeholder={"e.g. llama3.1"}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.ollamaApiOptionsCtxNum || "32768"}
						style={{ width: "100%" }}
						onInput={handleInputChange("ollamaApiOptionsCtxNum")}
						placeholder={"e.g. 32768"}>
						<span style={{ fontWeight: 500 }}>上下文窗口</span>
					</VSCodeTextField>
					{ollamaModels.length > 0 && (
						<VSCodeRadioGroup
							value={
								ollamaModels.includes(apiConfiguration?.ollamaModelId || "")
									? apiConfiguration?.ollamaModelId
									: ""
							}
							onChange={(e) => {
								const value = (e.target as HTMLInputElement)?.value
								// need to check value first since radio group returns empty string sometimes
								if (value) {
									handleInputChange("ollamaModelId")({
										target: { value },
									})
								}
							}}>
							{ollamaModels.map((model) => (
								<VSCodeRadio key={model} value={model} checked={apiConfiguration?.ollamaModelId === model}>
									{model}
								</VSCodeRadio>
							))}
						</VSCodeRadioGroup>
					)}
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						Ollama 允许您在计算机上本地运行模型。有关如何开始的说明，请参阅他们
						<VSCodeLink
							href="https://github.com/ollama/ollama/blob/main/README.md"
							style={{ display: "inline", fontSize: "inherit" }}>
							入门指南
						</VSCodeLink>
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>注意:</span>Cline 使用复杂的提示，最适合与 Claude 配合使用
							模型。功能较弱的模型可能无法按预期工作。)
						</span>
					</p>
				</div>
			)}

			{selectedProvider === "xai" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.xaiApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("xaiApiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>X AI API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						API key 保存在本地，只会被本插件用来请求API.
						{!apiConfiguration?.xaiApiKey && (
							<VSCodeLink href="https://x.ai" style={{ display: "inline", fontSize: "inherit" }}>
								注册获取 X AI API key.
							</VSCodeLink>
						)}
					</p>
					{/* Note: To fully implement this, you would need to add a handler in ClineProvider.ts */}
					{/* {apiConfiguration?.xaiApiKey && (
						<button
							onClick={() => {
								vscode.postMessage({
									type: "requestXAIModels",
									text: apiConfiguration?.xaiApiKey,
								})
							}}
							style={{ margin: "5px 0 0 0" }}
							className="vscode-button">
							Fetch Available Models
						</button>
					)} */}
				</div>
			)}

			{selectedProvider === "sambanova" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.sambanovaApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("sambanovaApiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>SambaNova API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						API key 保存在本地，只会被本插件用来请求API.
						{!apiConfiguration?.sambanovaApiKey && (
							<VSCodeLink
								href="https://docs.sambanova.ai/cloud/docs/get-started/overview"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								注册获取 SambaNova API key.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}
			{selectedProvider === "shengsuanyun" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.shengsuanyunApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("shengsuanyunApiKey")}
						placeholder="输入 API Key...">
						<span style={{ fontWeight: 500 }}>API Key</span>
					</VSCodeTextField>
					{!apiConfiguration?.shengsuanyunApiKey && <a href="https://router.shengsuanyun.com/">获取 API Key</a>}
				</div>
			)}

			{apiErrorMessage && (
				<p
					style={{
						margin: "-10px 0 4px 0",
						fontSize: 12,
						color: "var(--vscode-errorForeground)",
					}}>
					{apiErrorMessage}
				</p>
			)}

			{selectedProvider === "ollama" && showModelOptions && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.requestTimeoutMs ? apiConfiguration.requestTimeoutMs.toString() : "30000"}
						style={{ width: "100%" }}
						onInput={(e: any) => {
							const value = e.target.value
							// Convert to number, with validation
							const numValue = parseInt(value, 10)
							if (!isNaN(numValue) && numValue > 0) {
								setApiConfiguration({
									...apiConfiguration,
									requestTimeoutMs: numValue,
								})
							}
						}}
						placeholder="Default: 30000 (30 seconds)">
						<span style={{ fontWeight: 500 }}>Request Timeout (ms)</span>
					</VSCodeTextField>
					<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
						Maximum time in milliseconds to wait for API responses before timing out.
					</p>
				</>
			)}

			{(selectedProvider === "openrouter" || selectedProvider === "cline") && showModelOptions && (
				<>
					<VSCodeCheckbox
						style={{ marginTop: -10 }}
						checked={providerSortingSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setProviderSortingSelected(isChecked)
							if (!isChecked) {
								setApiConfiguration({
									...apiConfiguration,
									openRouterProviderSorting: "",
								})
							}
						}}>
						对底层提供商路由进行排序
					</VSCodeCheckbox>

					{providerSortingSelected && (
						<div style={{ marginBottom: -6 }}>
							<DropdownContainer className="dropdown-container" zIndex={OPENROUTER_MODEL_PICKER_Z_INDEX + 1}>
								<VSCodeDropdown
									style={{ width: "100%", marginTop: 3 }}
									value={apiConfiguration?.openRouterProviderSorting}
									onChange={(e: any) => {
										setApiConfiguration({
											...apiConfiguration,
											openRouterProviderSorting: e.target.value,
										})
									}}>
									<VSCodeOption value="">默认</VSCodeOption>
									<VSCodeOption value="price">价格</VSCodeOption>
									<VSCodeOption value="throughput">吞吐量</VSCodeOption>
									<VSCodeOption value="latency">延迟</VSCodeOption>
								</VSCodeDropdown>
							</DropdownContainer>
							<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
								{!apiConfiguration?.openRouterProviderSorting &&
									"默认行为是跨提供商（如 AWS、Google Vertex、Anthropic）对请求进行负载均衡，在考虑提供商正常运行时间的同时优先考虑价格"}
								{apiConfiguration?.openRouterProviderSorting === "price" &&
									"按价格对提供商进行排序，优先考虑成本最低的提供商"}
								{apiConfiguration?.openRouterProviderSorting === "throughput" &&
									"按吞吐量对提供程序进行排序，优先考虑吞吐量最高的提供程序（可能会增加成本）"}
								{apiConfiguration?.openRouterProviderSorting === "latency" &&
									"按响应时间对提供商进行排序，优先考虑延迟最低的提供商"}
							</p>
						</div>
					)}
				</>
			)}

			{selectedProvider !== "openrouter" &&
				selectedProvider !== "cline" &&
				selectedProvider !== "openai" &&
				selectedProvider !== "ollama" &&
				selectedProvider !== "lmstudio" &&
				selectedProvider !== "vscode-lm" &&
				selectedProvider !== "litellm" &&
				selectedProvider !== "requesty" &&
				selectedProvider !== "shengsuanyun" &&
				showModelOptions && (
					<>
						<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 2} className="dropdown-container">
							<label htmlFor="model-id">
								<span style={{ fontWeight: 500 }}>模型</span>
							</label>
							{selectedProvider === "anthropic" && createDropdown(anthropicModels)}
							{selectedProvider === "bedrock" && createDropdown(bedrockModels)}
							{selectedProvider === "vertex" && createDropdown(vertexModels)}
							{selectedProvider === "gemini" && createDropdown(geminiModels)}
							{selectedProvider === "openai-native" && createDropdown(openAiNativeModels)}
							{selectedProvider === "deepseek" && createDropdown(deepSeekModels)}
							{selectedProvider === "qwen" &&
								createDropdown(
									apiConfiguration?.qwenApiLine === "china" ? mainlandQwenModels : internationalQwenModels,
								)}
							{selectedProvider === "doubao" && createDropdown(doubaoModels)}
							{selectedProvider === "mistral" && createDropdown(mistralModels)}
							{selectedProvider === "asksage" && createDropdown(askSageModels)}
							{selectedProvider === "xai" && createDropdown(xaiModels)}
							{selectedProvider === "sambanova" && createDropdown(sambanovaModels)}
						</DropdownContainer>

						{((selectedProvider === "anthropic" && selectedModelId === "claude-3-7-sonnet-20250219") ||
							(selectedProvider === "bedrock" && selectedModelId === "anthropic.claude-3-7-sonnet-20250219-v1:0") ||
							(selectedProvider === "vertex" && selectedModelId === "claude-3-7-sonnet@20250219")) && (
							<ThinkingBudgetSlider apiConfiguration={apiConfiguration} setApiConfiguration={setApiConfiguration} />
						)}

						{selectedProvider === "xai" && selectedModelId.includes("3-mini") && (
							<>
								<VSCodeCheckbox
									style={{ marginTop: 0 }}
									checked={reasoningEffortSelected}
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										setReasoningEffortSelected(isChecked)
										if (!isChecked) {
											setApiConfiguration({
												...apiConfiguration,
												reasoningEffort: "",
											})
										}
									}}>
									Modify reasoning effort
								</VSCodeCheckbox>

								{reasoningEffortSelected && (
									<div>
										<label htmlFor="reasoning-effort-dropdown">
											<span style={{}}>推理效果</span>
										</label>
										<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 100}>
											<VSCodeDropdown
												id="reasoning-effort-dropdown"
												style={{ width: "100%", marginTop: 3 }}
												value={apiConfiguration?.reasoningEffort || "high"}
												onChange={(e: any) => {
													setApiConfiguration({
														...apiConfiguration,
														reasoningEffort: e.target.value,
													})
												}}>
												<VSCodeOption value="low">弱</VSCodeOption>
												<VSCodeOption value="high">强</VSCodeOption>
											</VSCodeDropdown>
										</DropdownContainer>
										<p
											style={{
												fontSize: "12px",
												marginTop: 3,
												marginBottom: 0,
												color: "var(--vscode-descriptionForeground)",
											}}>
											强推理效果会进行更多的推理分析，但是耗时更久使用token更多。
										</p>
									</div>
								)}
							</>
						)}

						<ModelInfoView
							selectedModelId={selectedModelId}
							modelInfo={selectedModelInfo}
							isDescriptionExpanded={isDescriptionExpanded}
							setIsDescriptionExpanded={setIsDescriptionExpanded}
							isPopup={isPopup}
						/>
					</>
				)}

			{(selectedProvider === "openrouter" || selectedProvider === "cline") && showModelOptions && (
				<OpenRouterModelPicker isPopup={isPopup} />
			)}
			{selectedProvider === "requesty" && showModelOptions && <RequestyModelPicker isPopup={isPopup} />}
			{selectedProvider === "shengsuanyun" && showModelOptions && <SSYModelPicker isPopup={isPopup} />}
			{modelIdErrorMessage && (
				<p
					style={{
						margin: "-10px 0 4px 0",
						fontSize: 12,
						color: "var(--vscode-errorForeground)",
					}}>
					{modelIdErrorMessage}
				</p>
			)}
		</div>
	)
}

export function getOpenRouterAuthUrl(uriScheme?: string) {
	return `https://openrouter.ai/auth?callback_url=${uriScheme || "vscode"}://shengsuan-cloud.cline-shengsuan/openrouter`
}

export const formatPrice = (price: number) => {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(price)
}

// Returns an array of formatted tier strings
const formatTiers = (tiers: ModelInfo["inputPriceTiers"]): JSX.Element[] => {
	if (!tiers || tiers.length === 0) {
		return []
	}
	return tiers.map((tier, index, arr) => {
		const prevLimit = index > 0 ? arr[index - 1].tokenLimit : 0
		return (
			<span style={{ paddingLeft: "15px" }} key={index}>
				{formatPrice(tier.price)}/million tokens (
				{tier.tokenLimit === Number.POSITIVE_INFINITY ? (
					<span>
						{"> "}
						{prevLimit.toLocaleString()}
					</span>
				) : (
					<span>
						{"<= "}
						{tier.tokenLimit.toLocaleString()}
					</span>
				)}
				{" tokens)"}
				{index < arr.length - 1 && <br />}
			</span>
		)
	})
}

export const ModelInfoView = ({
	selectedModelId,
	modelInfo,
	isDescriptionExpanded,
	setIsDescriptionExpanded,
	isPopup,
}: {
	selectedModelId: string
	modelInfo: ModelInfo
	isDescriptionExpanded: boolean
	setIsDescriptionExpanded: (isExpanded: boolean) => void
	isPopup?: boolean
}) => {
	const isGemini = Object.keys(geminiModels).includes(selectedModelId)
	const hasThinkingConfig = !!modelInfo.thinkingConfig

	// Create elements for tiered pricing separately
	const inputPriceElement = modelInfo.inputPriceTiers ? (
		<Fragment key="inputPriceTiers">
			<span style={{ fontWeight: 500 }}>输入价格:</span>
			<br />
			{formatTiers(modelInfo.inputPriceTiers)}
		</Fragment>
	) : modelInfo.inputPrice !== undefined && modelInfo.inputPrice > 0 ? (
		<span key="inputPrice">
			<span style={{ fontWeight: 500 }}>输入价格:</span> {formatPrice(modelInfo.inputPrice)}/million tokens
		</span>
	) : null

	// --- Output Price Logic ---
	let outputPriceElement = null
	if (hasThinkingConfig && modelInfo.outputPrice !== undefined && modelInfo.thinkingConfig?.outputPrice !== undefined) {
		// Display both standard and thinking budget prices
		outputPriceElement = (
			<Fragment key="outputPriceConditional">
				<span style={{ fontWeight: 500 }}>输出价格 (标准):</span> {formatPrice(modelInfo.outputPrice)}/million tokens
				<br />
				<span style={{ fontWeight: 500 }}>输出价格 (推理预算 &gt; 0):</span>{" "}
				{formatPrice(modelInfo.thinkingConfig.outputPrice)}/million tokens
			</Fragment>
		)
	} else if (modelInfo.outputPriceTiers) {
		// Display tiered output pricing
		outputPriceElement = (
			<Fragment key="outputPriceTiers">
				<span style={{ fontWeight: 500 }}>输出价格:</span>
				<span style={{ fontStyle: "italic" }}> (基于输入token数)</span>
				<br />
				{formatTiers(modelInfo.outputPriceTiers)}
			</Fragment>
		)
	} else if (modelInfo.outputPrice !== undefined && modelInfo.outputPrice > 0) {
		// Display single standard output price
		outputPriceElement = (
			<span key="outputPrice">
				<span style={{ fontWeight: 500 }}>输出价格:</span> {formatPrice(modelInfo.outputPrice)}/million tokens
			</span>
		)
	}
	// --- End Output Price Logic ---

	const infoItems = [
		modelInfo.description && (
			<ModelDescriptionMarkdown
				key="description"
				markdown={modelInfo.description}
				isExpanded={isDescriptionExpanded}
				setIsExpanded={setIsDescriptionExpanded}
				isPopup={isPopup}
			/>
		),
		<ModelInfoSupportsItem
			key="supportsImages"
			isSupported={modelInfo.supportsImages ?? false}
			supportsLabel="支持图片"
			doesNotSupportLabel="不支持图片"
		/>,
		<ModelInfoSupportsItem
			key="supportsBrowserUse"
			isSupported={modelInfo.supportsImages ?? false} // cline browser tool uses image recognition for navigation (requires model image support).
			supportsLabel="支持浏览器操作"
			doesNotSupportLabel="不支持浏览器操作"
		/>,
		!isGemini && (
			<ModelInfoSupportsItem
				key="supportsPromptCache"
				isSupported={modelInfo.supportsPromptCache}
				supportsLabel="支持提示词缓存"
				doesNotSupportLabel="不支持提示词缓存"
			/>
		),
		modelInfo.maxTokens !== undefined && modelInfo.maxTokens > 0 && (
			<span key="maxTokens">
				<span style={{ fontWeight: 500 }}>最大输出:</span> {modelInfo.maxTokens?.toLocaleString()} tokens
			</span>
		),
		inputPriceElement, // Add the generated input price block
		modelInfo.supportsPromptCache && modelInfo.cacheWritesPrice && (
			<span key="cacheWritesPrice">
				<span style={{ fontWeight: 500 }}>写缓存价格:</span> {formatPrice(modelInfo.cacheWritesPrice || 0)}
				/million tokens
			</span>
		),
		modelInfo.supportsPromptCache && modelInfo.cacheReadsPrice && (
			<span key="cacheReadsPrice">
				<span style={{ fontWeight: 500 }}>读缓存价格:</span> {formatPrice(modelInfo.cacheReadsPrice || 0)}/million tokens
			</span>
		),
		outputPriceElement, // Add the generated output price block
		isGemini && (
			<span key="geminiInfo" style={{ fontStyle: "italic" }}>
				* 免费 {selectedModelId && selectedModelId.includes("flash") ? "15" : "2"} 每分钟请求. 之后按实际请求收费{" "}
				<VSCodeLink href="https://ai.google.dev/pricing" style={{ display: "inline", fontSize: "inherit" }}>
					查看更多价格详情
				</VSCodeLink>
			</span>
		),
	].filter(Boolean)

	return (
		<p
			style={{
				fontSize: "12px",
				marginTop: "2px",
				color: "var(--vscode-descriptionForeground)",
			}}>
			{infoItems.map((item, index) => (
				<Fragment key={index}>
					{item}
					{index < infoItems.length - 1 && <br />}
				</Fragment>
			))}
		</p>
	)
}

const ModelInfoSupportsItem = ({
	isSupported,
	supportsLabel,
	doesNotSupportLabel,
}: {
	isSupported: boolean
	supportsLabel: string
	doesNotSupportLabel: string
}) => (
	<span
		style={{
			fontWeight: 500,
			color: isSupported ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)",
		}}>
		<i
			className={`codicon codicon-${isSupported ? "check" : "x"}`}
			style={{
				marginRight: 4,
				marginBottom: isSupported ? 1 : -1,
				fontSize: isSupported ? 11 : 13,
				fontWeight: 700,
				display: "inline-block",
				verticalAlign: "bottom",
			}}></i>
		{isSupported ? supportsLabel : doesNotSupportLabel}
	</span>
)

export function normalizeApiConfiguration(apiConfiguration?: ApiConfiguration): {
	selectedProvider: ApiProvider
	selectedModelId: string
	selectedModelInfo: ModelInfo
} {
	const provider = apiConfiguration?.apiProvider || "anthropic"
	const modelId = apiConfiguration?.apiModelId

	const getProviderData = (models: Record<string, ModelInfo>, defaultId: string) => {
		let selectedModelId: string
		let selectedModelInfo: ModelInfo
		if (modelId && modelId in models) {
			selectedModelId = modelId
			selectedModelInfo = models[modelId]
		} else {
			selectedModelId = defaultId
			selectedModelInfo = models[defaultId]
		}
		return {
			selectedProvider: provider,
			selectedModelId,
			selectedModelInfo,
		}
	}
	switch (provider) {
		case "anthropic":
			return getProviderData(anthropicModels, anthropicDefaultModelId)
		case "bedrock":
			return getProviderData(bedrockModels, bedrockDefaultModelId)
		case "vertex":
			return getProviderData(vertexModels, vertexDefaultModelId)
		case "gemini":
			return getProviderData(geminiModels, geminiDefaultModelId)
		case "openai-native":
			return getProviderData(openAiNativeModels, openAiNativeDefaultModelId)
		case "deepseek":
			return getProviderData(deepSeekModels, deepSeekDefaultModelId)
		case "qwen":
			const qwenModels = apiConfiguration?.qwenApiLine === "china" ? mainlandQwenModels : internationalQwenModels
			const qwenDefaultId =
				apiConfiguration?.qwenApiLine === "china" ? mainlandQwenDefaultModelId : internationalQwenDefaultModelId
			return getProviderData(qwenModels, qwenDefaultId)
		case "doubao":
			return getProviderData(doubaoModels, doubaoDefaultModelId)
		case "mistral":
			return getProviderData(mistralModels, mistralDefaultModelId)
		case "asksage":
			return getProviderData(askSageModels, askSageDefaultModelId)
		case "openrouter":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
				selectedModelInfo: apiConfiguration?.openRouterModelInfo || openRouterDefaultModelInfo,
			}
		case "requesty":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.requestyModelId || requestyDefaultModelId,
				selectedModelInfo: apiConfiguration?.requestyModelInfo || requestyDefaultModelInfo,
			}
		case "cline":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
				selectedModelInfo: apiConfiguration?.openRouterModelInfo || openRouterDefaultModelInfo,
			}
		case "openai":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openAiModelId || "",
				selectedModelInfo: apiConfiguration?.openAiModelInfo || openAiModelInfoSaneDefaults,
			}
		case "ollama":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.ollamaModelId || "",
				selectedModelInfo: openAiModelInfoSaneDefaults,
			}
		case "lmstudio":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.lmStudioModelId || "",
				selectedModelInfo: openAiModelInfoSaneDefaults,
			}
		case "vscode-lm":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.vsCodeLmModelSelector
					? `${apiConfiguration.vsCodeLmModelSelector.vendor}/${apiConfiguration.vsCodeLmModelSelector.family}`
					: "",
				selectedModelInfo: {
					...openAiModelInfoSaneDefaults,
					supportsImages: false, // VSCode LM API currently doesn't support images
				},
			}
		case "litellm":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.liteLlmModelId || "",
				selectedModelInfo: liteLlmModelInfoSaneDefaults,
			}
		case "xai":
			return getProviderData(xaiModels, xaiDefaultModelId)
		case "sambanova":
			return getProviderData(sambanovaModels, sambanovaDefaultModelId)
		case "shengsuanyun":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.ssyModelId || ssyDefaultModelId,
				selectedModelInfo: apiConfiguration?.ssyModelInfo || ssyDefaultModelInfo,
			}
		default:
			return getProviderData(anthropicModels, anthropicDefaultModelId)
	}
}

export default memo(ApiOptions)
