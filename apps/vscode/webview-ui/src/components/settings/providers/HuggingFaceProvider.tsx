import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useDynamicProviderSelection } from "@/hooks/useDynamicProviderSelection"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { HuggingFaceModelPicker } from "../HuggingFaceModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the HuggingFaceProvider component
 */
interface HuggingFaceProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Hugging Face provider configuration component
 */
export const HuggingFaceProvider = ({ showModelOptions, isPopup, currentMode }: HuggingFaceProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = useDynamicProviderSelection("huggingface", apiConfiguration, currentMode)

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.huggingFaceApiKey || ""}
				onChange={(value) => handleFieldChange("huggingFaceApiKey", value)}
				placeholder="输入 API 密钥..."
				style={{ width: "100%" }}
				type="password">
				<span style={{ fontWeight: 500 }}>Hugging Face API 密钥</span>
			</DebouncedTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				此密钥仅存储在本地，仅用于从此扩展发起 API 请求。我们在此不显示定价，因为它取决于你的 Hugging Face
				提供商设置，且并非始终可通过其 API 获取{" "}
				<a href="https://huggingface.co/settings/tokens" rel="noopener noreferrer" target="_blank">
					在此获取你的 API 密钥
				</a>
			</p>

			{showModelOptions && <HuggingFaceModelPicker currentMode={currentMode} isPopup={isPopup} />}
		</div>
	)
}
