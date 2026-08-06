import type { ApiConfiguration } from "@shared/api"
import { UpdateApiConfigurationRequest } from "@shared/proto/cline/models"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

interface ClinePassLimitErrorProps {
	message: string
}

const CLINE_PROVIDER_ID = "cline"

const getProviderSwitchConfig = (apiConfiguration: ApiConfiguration): ApiConfiguration => {
	return {
		...apiConfiguration,
		planModeApiProvider: CLINE_PROVIDER_ID,
		actModeApiProvider: CLINE_PROVIDER_ID,
	}
}

const ClinePassLimitError = ({ message }: ClinePassLimitErrorProps) => {
	const { apiConfiguration } = useExtensionState()
	const [isSwitching, setIsSwitching] = useState(false)
	const [didSwitch, setDidSwitch] = useState(false)
	const [error, setError] = useState<string | undefined>()

	const handleSwitchToUsageBasedBilling = async () => {
		setIsSwitching(true)
		setError(undefined)
		try {
			const protoConfig = convertApiConfigurationToProto(getProviderSwitchConfig(apiConfiguration ?? {}))
			await ModelsServiceClient.updateApiConfigurationProto(
				UpdateApiConfigurationRequest.create({
					apiConfiguration: protoConfig,
				}),
			)
			setDidSwitch(true)
		} catch (error) {
			console.error("Failed to switch to Cline usage-based billing:", error)
			setError("切换提供商失败。请在 API 配置设置中选择 Cline 按用量计费。")
		} finally {
			setIsSwitching(false)
		}
	}

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="cline-pass-limit-error">
			<div className="text-error mb-2">ClinePass 限额已用尽</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">{message}</div>
			<div className="text-(--vscode-descriptionForeground) text-xs mt-2">
				是否要切换到按用量计费，并使用 Cline 提供商重试？
			</div>
			<VSCodeButton
				appearance="primary"
				className="w-full mt-3"
				disabled={isSwitching || didSwitch}
				onClick={handleSwitchToUsageBasedBilling}>
				{isSwitching ? "切换中..." : didSwitch ? "已切换到按用量计费" : "切换到按用量计费"}
			</VSCodeButton>
			{didSwitch && <div className="text-(--vscode-descriptionForeground) text-xs mt-2">切换后请重试该请求。</div>}
			{error && <div className="text-error text-xs mt-2">{error}</div>}
		</div>
	)
}

export default ClinePassLimitError
