import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { AccountServiceClient } from "@/services/grpc-client"

const ORG_CLINE_PASS_RESTRICTION_MESSAGE = "组织账户无法使用 ClinePass 订阅。"

const OrgClinePassRestrictionError = () => {
	const [isSwitching, setIsSwitching] = useState(false)
	const [didSwitch, setDidSwitch] = useState(false)
	const [error, setError] = useState<string | undefined>()

	const handleSwitchToPersonalAccount = async () => {
		setIsSwitching(true)
		setError(undefined)
		try {
			await AccountServiceClient.setUserOrganization({})
			setDidSwitch(true)
		} catch (error) {
			console.error("Failed to switch to personal Cline account:", error)
			setError("切换账户失败。请使用 /accounts 切换到个人账户。")
		} finally {
			setIsSwitching(false)
		}
	}

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="org-cline-pass-restriction-error">
			<div className="text-error mb-2">组织账户无法使用 ClinePass</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">
				{ORG_CLINE_PASS_RESTRICTION_MESSAGE}
			</div>
			<VSCodeButton className="w-full mt-3" disabled={isSwitching || didSwitch} onClick={handleSwitchToPersonalAccount}>
				{isSwitching ? "切换中..." : didSwitch ? "已切换到个人账户" : "切换到个人账户"}
			</VSCodeButton>
			{didSwitch && <div className="text-(--vscode-descriptionForeground) text-xs mt-2">切换后请重试该请求。</div>}
			{error && <div className="text-error text-xs mt-2">{error}</div>}
		</div>
	)
}

export { ORG_CLINE_PASS_RESTRICTION_MESSAGE }
export default OrgClinePassRestrictionError
