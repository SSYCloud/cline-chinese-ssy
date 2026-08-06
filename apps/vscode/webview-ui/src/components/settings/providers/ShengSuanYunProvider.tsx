import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useSignIn as useShengSuanYunSignIn } from "@/context/ShengSuanYunAuthContext"
import { ApiKeyField } from "../common/ApiKeyField"
import ShengSuanYunModelPicker from "../ShengSuanYunModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ShengSuanYunProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}

const LoginBtn = () => {
	const { isLoginLoading, handleSignIn } = useShengSuanYunSignIn()

	return (
		<div className="mt-2 flex flex-col items-center gap-2">
			<VSCodeButton appearance="primary" className="w-full" disabled={isLoginLoading} onClick={handleSignIn}>
				登录胜算云
				{isLoginLoading && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh" />
					</span>
				)}
			</VSCodeButton>
			<span className="text-xs text-(--vscode-descriptionForeground)">登录后将自动同步 API Key。</span>
		</div>
	)
}

export const ShengSuanYunProvider = ({ showModelOptions, isPopup, currentMode, initialModelTab }: ShengSuanYunProviderProps) => {
	const { apiConfiguration, userInfo } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.shengSuanYunApiKey || ""}
				loginBtn={userInfo ? undefined : <LoginBtn />}
				onChange={(value) => handleFieldChange("shengSuanYunApiKey", value)}
				providerName="胜算云"
				signupUrl="https://console.shengsuanyun.com/user/keys"
			/>
			{showModelOptions && (
				<ShengSuanYunModelPicker currentMode={currentMode} initialModelTab={initialModelTab} isPopup={isPopup} />
			)}
		</div>
	)
}
