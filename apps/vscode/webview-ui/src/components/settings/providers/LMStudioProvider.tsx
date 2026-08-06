import { type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeLink, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { ModelsServiceClient } from "@/services/grpc-client"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { DropdownContainer } from "../common/ModelSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the LMStudioProvider component
 */
interface LMStudioProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

interface LMStudioApiModel {
	id: string
	object?: "model"
	type?: string
	publisher?: string
	arch?: string
	compatibility_type?: string
	quantization?: string
	state?: string
	max_context_length?: number
	loaded_context_length?: number
}

/**
 * The LM Studio provider configuration component
 */
export const LMStudioProvider = ({ currentMode }: LMStudioProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { config, write, commitSelection } = useProviderConfig("lmstudio")

	const [lmStudioModels, setLmStudioModels] = useState<LMStudioApiModel[]>([])
	const [pendingSelectedModelId, setPendingSelectedModelId] = useState<string | undefined>(undefined)

	const toLmStudioModelInfo = useCallback((model: LMStudioApiModel | undefined, modelId: string): ModelInfo => {
		const contextWindow = model?.loaded_context_length ?? model?.max_context_length
		return {
			...openAiModelInfoSafeDefaults,
			name: modelId,
			...(contextWindow !== undefined && contextWindow > 0 ? { contextWindow } : {}),
			...(model?.max_context_length !== undefined && model.max_context_length > 0
				? { maxTokens: model.max_context_length }
				: {}),
		}
	}, [])
	const lmStudioModelInfoById = useMemo(
		() => Object.fromEntries(lmStudioModels.map((model) => [model.id, toLmStudioModelInfo(model, model.id)])),
		[lmStudioModels, toLmStudioModelInfo],
	)
	const { selectedModel, commitModelSelection } = useProviderModelSelection("lmstudio", currentMode, {
		models: lmStudioModelInfoById,
		config,
		commitSelection,
		fallbackModelInfo: openAiModelInfoSafeDefaults,
		customModelInfo: (modelId) => toLmStudioModelInfo(undefined, modelId),
	})
	const displayedSelectedModelId = pendingSelectedModelId ?? selectedModel.modelId
	const currentLMStudioModel = useMemo(
		() => lmStudioModels.find((model) => model.id === displayedSelectedModelId),
		[displayedSelectedModelId, lmStudioModels],
	)
	const endpoint = useMemo(
		() => config?.baseUrl ?? apiConfiguration?.lmStudioBaseUrl ?? "http://localhost:1234",
		[apiConfiguration?.lmStudioBaseUrl, config?.baseUrl],
	)

	const handleBaseUrlChange = useCallback(
		(value: string) => {
			void write({ baseUrl: value }).catch((error) => console.error("Failed to update LM Studio base URL:", error))
		},
		[write],
	)
	const handleBaseUrlClear = useCallback(async () => {
		try {
			await write({ baseUrl: "" })
		} catch (error) {
			console.error("Failed to clear LM Studio base URL:", error)
			throw error
		}
	}, [write])

	const handleModelChange = useCallback(
		(modelId: string) => {
			const trimmedModelId = modelId.trim()
			if (!trimmedModelId) {
				return
			}
			setPendingSelectedModelId(trimmedModelId)
			const model = lmStudioModels.find((candidate) => candidate.id === trimmedModelId)
			void commitModelSelection({
				modelId: trimmedModelId,
				modelInfo: toLmStudioModelInfo(model, trimmedModelId),
			}).catch((error) => {
				console.error("Failed to update LM Studio model selection:", error)
				setPendingSelectedModelId(undefined)
			})
		},
		[commitModelSelection, lmStudioModels, toLmStudioModelInfo],
	)

	// Fetch LM Studio models on mount, whenever the endpoint changes, and when
	// the model control gains focus (no interval polling — the endpoint is
	// user-configurable, see ENG-2344), so a server started after mount is
	// still discovered.
	const requestLmStudioModels = useCallback(async () => {
		await ModelsServiceClient.getLmStudioModels({
			value: endpoint,
		})
			.then((response) => {
				if (response?.values) {
					const models = response.values.map((v) => JSON.parse(v) as LMStudioApiModel)
					setLmStudioModels(models)
				}
			})
			.catch((error) => {
				console.error("Failed to parse LM Studio models:", error)
			})
	}, [endpoint])

	useEffect(() => {
		requestLmStudioModels()
	}, [requestLmStudioModels])

	const lmStudioMaxTokens = currentLMStudioModel?.max_context_length?.toString()
	const currentLoadedContext = currentLMStudioModel?.loaded_context_length?.toString()

	useEffect(() => {
		if (pendingSelectedModelId && selectedModel.modelId === pendingSelectedModelId) {
			setPendingSelectedModelId(undefined)
		}
	}, [pendingSelectedModelId, selectedModel.modelId])

	useEffect(() => {
		const curr = currentLMStudioModel?.loaded_context_length?.toString()
		const max = currentLMStudioModel?.max_context_length?.toString()
		const choice = apiConfiguration?.lmStudioMaxTokens ?? max
		if (curr && curr !== choice) {
			handleFieldChange("lmStudioMaxTokens", curr)
		}
	}, [
		currentLMStudioModel?.loaded_context_length,
		currentLMStudioModel?.max_context_length,
		apiConfiguration?.lmStudioMaxTokens,
		handleFieldChange,
	])

	return (
		<div className="flex flex-col gap-2">
			<BaseUrlField
				initialValue={config?.baseUrl ?? apiConfiguration?.lmStudioBaseUrl}
				label="使用自定义基础 URL"
				onChange={handleBaseUrlChange}
				onClear={handleBaseUrlClear}
				placeholder="默认：http://localhost:1234"
			/>

			<div className="font-semibold">模型</div>
			{lmStudioModels.length > 0 ? (
				<DropdownContainer className="dropdown-container" onFocusCapture={() => void requestLmStudioModels()} zIndex={10}>
					<VSCodeDropdown
						className="w-full mb-3"
						onChange={(e: any) => {
							const value = e?.target?.value
							if (typeof value === "string") {
								handleModelChange(value)
							}
						}}
						value={displayedSelectedModelId}>
						{lmStudioModels.map((model) => (
							<VSCodeOption className="w-full" key={model.id} value={model.id}>
								{model.id}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</DropdownContainer>
			) : (
				<div onFocusCapture={() => void requestLmStudioModels()}>
					<DebouncedTextField
						initialValue={displayedSelectedModelId || ""}
						onChange={handleModelChange}
						placeholder={"例如：meta-llama-3.1-8b-instruct"}
						style={{ width: "100%" }}
					/>
				</div>
			)}

			<div className="font-semibold">上下文窗口</div>
			<VSCodeTextField
				className="w-full pointer-events-none"
				disabled={true}
				title="不可编辑 - 该值由连接的端点返回"
				value={String(currentLoadedContext ?? lmStudioMaxTokens ?? "0")}
			/>

			<div className="text-xs text-description">
				LM Studio 允许你在本地计算机上运行模型。有关入门说明，请参阅其
				<VSCodeLink href="https://lmstudio.ai/docs" style={{ display: "inline", fontSize: "inherit" }}>
					快速入门指南。
				</VSCodeLink>
				你还需要启动 LM Studio 的{" "}
				<VSCodeLink className="inline" href="https://lmstudio.ai/docs/basics/server">
					本地服务器
				</VSCodeLink>{" "}
				功能并使用 <code>lms server start</code> 命令来配合此扩展使用。{" "}
				<div className="text-error">
					<span className="font-semibold">注意：</span>Cline 使用复杂的提示词，因此不同模型的行为可能有所差异。
					能力较弱的模型可能无法按预期工作。
				</div>
			</div>
		</div>
	)
}
