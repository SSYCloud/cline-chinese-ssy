import { openAiModelInfoSafeDefaults } from "@shared/api"
import { StringRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import OllamaModelPicker from "../OllamaModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

/**
 * Props for the OllamaProvider component
 */
interface OllamaProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Ollama provider configuration component
 */
export const OllamaProvider = ({ showModelOptions, isPopup, currentMode }: OllamaProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { config, write, commitSelection } = useProviderConfig("ollama")

	const [ollamaModels, setOllamaModels] = useState<string[]>([])

	const ollamaBaseUrl = config?.baseUrl ?? apiConfiguration?.ollamaBaseUrl
	// providers.json (config.contextWindow) is the source of truth; the legacy
	// apiConfiguration string is a migration fallback.
	const ollamaNumCtx = config?.contextWindow || Number.parseInt(apiConfiguration?.ollamaApiOptionsCtxNum || "", 10)
	const ollamaModelInfo = useMemo(() => {
		return {
			...openAiModelInfoSafeDefaults,
			...(Number.isFinite(ollamaNumCtx) && ollamaNumCtx > 0 ? { contextWindow: ollamaNumCtx } : {}),
		}
	}, [ollamaNumCtx])
	const ollamaModelInfoById = useMemo(
		() => Object.fromEntries(ollamaModels.map((modelId) => [modelId, { ...ollamaModelInfo, name: modelId }])),
		[ollamaModelInfo, ollamaModels],
	)
	const { selectedModel, commitModelSelection } = useProviderModelSelection("ollama", currentMode, {
		models: ollamaModelInfoById,
		config,
		commitSelection,
		fallbackModelInfo: ollamaModelInfo,
		customModelInfo: (modelId) => ({ ...ollamaModelInfo, name: modelId }),
	})
	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName: "Ollama",
		write,
	})

	const handleBaseUrlChange = useCallback(
		(value: string) => {
			void write({ baseUrl: value }).catch((error) => console.error("Failed to update Ollama base URL:", error))
		},
		[write],
	)
	const handleBaseUrlClear = useCallback(async () => {
		try {
			await write({ baseUrl: "" })
		} catch (error) {
			console.error("Failed to clear Ollama base URL:", error)
			throw error
		}
	}, [write])

	// Fetch ollama models on mount and whenever the base URL changes. The
	// picker also refetches on focus — do NOT poll on an interval: the base
	// URL is user-configurable, so an unbounded poll can hammer a remote or
	// metered endpoint for as long as the settings pane is open (ENG-2344).
	const requestOllamaModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getOllamaModels(
				StringRequest.create({
					value: ollamaBaseUrl || "",
				}),
			)
			if (response && response.values) {
				setOllamaModels(response.values)
			}
		} catch (error) {
			console.error("Failed to fetch Ollama models:", error)
			setOllamaModels([])
		}
	}, [ollamaBaseUrl])

	useEffect(() => {
		requestOllamaModels()
	}, [requestOllamaModels])

	return (
		<div className="flex flex-col gap-2">
			<BaseUrlField
				initialValue={ollamaBaseUrl}
				label="使用自定义基础 URL"
				onChange={handleBaseUrlChange}
				onClear={handleBaseUrlClear}
				placeholder="默认：http://localhost:11434"
			/>

			{ollamaBaseUrl && (
				<ApiKeyField
					helpText="用于需要身份验证的 Ollama 实例或云服务的可选 API 密钥。本地安装请留空。"
					initialValue={savedApiKeyMask}
					onChange={handleApiKeyChange}
					placeholder="输入 API 密钥（可选）..."
					providerName="Ollama"
				/>
			)}

			{/* Model selection - use filterable picker */}
			<label htmlFor="ollama-model-selection">
				<span className="font-semibold">模型</span>
			</label>
			<OllamaModelPicker
				ollamaModels={ollamaModels}
				onFocus={requestOllamaModels}
				onModelChange={(modelId) => {
					const trimmedModelId = modelId.trim()
					if (!trimmedModelId) {
						return
					}
					void commitModelSelection({
						modelId: trimmedModelId,
						modelInfo: { ...ollamaModelInfo, name: trimmedModelId },
					}).catch((error) => console.error("Failed to update Ollama model selection:", error))
				}}
				placeholder={ollamaModels.length > 0 ? "搜索并选择模型..." : "例如：llama3.1"}
				selectedModelId={selectedModel.modelId || ""}
			/>

			{/* Show status message based on model availability */}
			{ollamaModels.length === 0 && (
				<p className="text-sm mt-1 text-description italic">
					无法从 Ollama 服务器获取模型。请确保 Ollama 正在运行且可访问，或者在上方手动输入模型 ID。
				</p>
			)}

			{/* Render only after the provider config RPC has resolved: the
			    debounced input fires onChange for its initial value shortly
			    after mount, so mounting before `config` loads would persist
			    the 32768 fallback over a value saved in providers.json. */}
			{config !== undefined && (
				<DebouncedTextField
					initialValue={Number.isFinite(ollamaNumCtx) && ollamaNumCtx > 0 ? String(ollamaNumCtx) : ""}
					onChange={(v) => {
						const contextWindow = Number.parseInt(v, 10)
						const numCtx = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : undefined
						// The debounced input also fires for its initial value and
						// external prop syncs — only persist actual changes.
						const currentNumCtx = Number.isFinite(ollamaNumCtx) && ollamaNumCtx > 0 ? ollamaNumCtx : undefined
						if (numCtx === currentNumCtx) {
							return
						}
						// Persist to providers.json (`contextWindow`); the store
						// mirrors the value to the legacy state key for older
						// readers. Zero clears the setting.
						void write({ contextWindow: numCtx ?? 0 }).catch((error) =>
							console.error("Failed to update Ollama context window:", error),
						)

						if (selectedModel.modelId) {
							void commitModelSelection({
								modelId: selectedModel.modelId,
								modelInfo: {
									...openAiModelInfoSafeDefaults,
									name: selectedModel.modelId,
									...(numCtx ? { contextWindow: numCtx } : {}),
								},
							}).catch((error) => console.error("Failed to update Ollama context window:", error))
						}
					}}
					placeholder={"默认：32768"}
					style={{ width: "100%" }}>
					<span className="font-semibold">模型上下文窗口</span>
				</DebouncedTextField>
			)}

			{showModelOptions && (
				<>
					<DebouncedTextField
						initialValue={
							apiConfiguration?.requestTimeoutMs ? apiConfiguration.requestTimeoutMs.toString() : "300000"
						}
						onChange={(value) => {
							// Convert to number, with validation
							const numValue = Number.parseInt(value, 10)
							if (!Number.isNaN(numValue) && numValue > 0) {
								handleFieldChange("requestTimeoutMs", numValue)
							}
						}}
						placeholder="默认：300000（5 分钟）"
						style={{ width: "100%" }}>
						<span className="font-semibold">请求超时（毫秒）</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">等待 API 响应超时前的最长毫秒数。</p>
				</>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Ollama 允许你在本地计算机上运行模型。有关入门说明，请参阅其{" "}
				<VSCodeLink
					href="https://github.com/ollama/ollama/blob/main/README.md"
					style={{ display: "inline", fontSize: "inherit" }}>
					快速入门指南。
				</VSCodeLink>{" "}
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>注意：</span>Cline 使用复杂的提示词，因此不同模型的行为可能有所差异。
					能力较弱的模型可能无法按预期工作。)
				</span>
			</p>
		</div>
	)
}
