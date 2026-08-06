import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useDynamicProviderSelection } from "@/hooks/useDynamicProviderSelection"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useDebouncedInput } from "../utils/useDebouncedInput"

interface DifyProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const DifyProvider = ({ showModelOptions, isPopup, currentMode }: DifyProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Use debounced input for proper state management
	const [baseUrlValue, setBaseUrlValue] = useDebouncedInput(apiConfiguration?.difyBaseUrl || "", (value) =>
		handleFieldChange("difyBaseUrl", value),
	)

	const [apiKeyValue, setApiKeyValue] = useDebouncedInput(apiConfiguration?.difyApiKey || "", (value) =>
		handleFieldChange("difyApiKey", value),
	)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = useDynamicProviderSelection("dify", apiConfiguration, currentMode)

	return (
		<div>
			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				<DebouncedTextField
					initialValue={apiConfiguration?.difyBaseUrl || ""}
					onChange={(value) => {
						handleFieldChange("difyBaseUrl", value)
					}}
					placeholder={"输入基础 URL..."}
					style={{ width: "100%", marginBottom: 10 }}
					type="text">
					<span style={{ fontWeight: 500 }}>基础 URL</span>
				</DebouncedTextField>

				<ApiKeyField
					initialValue={apiConfiguration?.difyApiKey || ""}
					onChange={(value) => {
						handleFieldChange("difyApiKey", value)
					}}
					providerName="Dify"
				/>

				<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "5px" }}>
					<p>Dify 是一个通过统一 API 提供多种 AI 模型访问的平台。配置你的 Dify 实例 URL 和 API 密钥即可开始使用。</p>
					<p style={{ marginTop: "8px" }}>
						<strong>注意：</strong>模型选择在你的 Dify 应用配置中完成。
					</p>
				</div>
			</div>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
