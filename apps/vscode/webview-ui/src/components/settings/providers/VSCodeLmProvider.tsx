import { EmptyRequest } from "@shared/proto/cline/common"
import type { Mode } from "@shared/storage/types"
import { parseVsCodeLmModelSelector, stringifyVsCodeLmModelSelector } from "@shared/vsCodeSelectorUtils"
import { VSCodeDropdown, VSCodeLink, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import type * as vscodemodels from "vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { ModelsServiceClient } from "@/services/grpc-client"
import { DROPDOWN_Z_INDEX, DropdownContainer } from "../ApiOptions"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface VSCodeLmProviderProps {
	currentMode: Mode
}

export const VSCodeLmProvider = ({ currentMode }: VSCodeLmProviderProps) => {
	const [vsCodeLmModels, setVsCodeLmModels] = useState<vscodemodels.LanguageModelChatSelector[]>([])
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const { config, commitSelection } = useProviderConfig("vscode-lm")

	const { vsCodeLmModelSelector } = getModeSpecificFields(apiConfiguration, currentMode)
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const selectedModelId = vsCodeLmModelSelector
		? stringifyVsCodeLmModelSelector(vsCodeLmModelSelector)
		: (committedSelection?.modelId ?? "")

	// Fetch VS Code LM models on mount, when the dropdown is focused, and via
	// the explicit refresh link (no interval polling — ENG-2344), so models
	// registered after mount (e.g. Copilot enabled later) are still discovered.
	const requestVsCodeLmModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getVsCodeLmModels(EmptyRequest.create({}))
			if (response?.models) {
				setVsCodeLmModels(response.models)
			}
		} catch (error) {
			console.error("Failed to fetch VS Code LM models:", error)
			setVsCodeLmModels([])
		}
	}, [])

	useEffect(() => {
		requestVsCodeLmModels()
	}, [requestVsCodeLmModels])

	const handleModelSelect = (modelId: string) => {
		if (!modelId) {
			return
		}

		const selector = parseVsCodeLmModelSelector(modelId)
		void handleModeFieldChange(
			{
				plan: "planModeVsCodeLmModelSelector",
				act: "actModeVsCodeLmModelSelector",
			},
			selector,
			currentMode,
		).catch((err) => console.error("Failed to update VS Code LM selector:", err))

		void commitSelection(currentMode, {
			providerId: "vscode-lm",
			modelId,
			overrides: {
				name: [selector.vendor, selector.family].filter(Boolean).join(" - ") || modelId,
			},
		}).catch((err) => console.error("Failed to commit VS Code LM model selection:", err))
	}

	return (
		<div>
			<DropdownContainer
				className="dropdown-container"
				onFocusCapture={() => void requestVsCodeLmModels()}
				zIndex={DROPDOWN_Z_INDEX - 2}>
				<label htmlFor="vscode-lm-model">
					<span style={{ fontWeight: 500 }}>语言模型</span>
				</label>
				{vsCodeLmModels.length > 0 ? (
					<VSCodeDropdown
						id="vscode-lm-model"
						onChange={(e) => handleModelSelect((e.target as HTMLInputElement).value)}
						style={{ width: "100%" }}
						value={selectedModelId}>
						<VSCodeOption value="">选择模型...</VSCodeOption>
						{vsCodeLmModels.map((model) => {
							const value = stringifyVsCodeLmModelSelector(model)
							return (
								<VSCodeOption key={value} value={value}>
									{model.vendor} - {model.family}
								</VSCodeOption>
							)
						})}
					</VSCodeDropdown>
				) : (
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						使用其他扩展通过 VS Code 语言模型 API 贡献的模型。最常见的来源是 GitHub Copilot —— 安装{" "}
						<a href="https://marketplace.visualstudio.com/items?itemName=GitHub.copilot">Copilot 扩展</a> 并在 Copilot
						设置中启用模型 —— 但任何注册了语言模型提供程序的扩展都会显示在这里。{" "}
						<VSCodeLink
							onClick={() => void requestVsCodeLmModels()}
							style={{ display: "inline", fontSize: "inherit" }}>
							刷新模型列表
						</VSCodeLink>{" "}
						启用模型后进行刷新。
					</p>
				)}
			</DropdownContainer>
		</div>
	)
}
