import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import ClineLogoPanda from "@/assets/ClineLogoPanda"
import { ClineAuthStatus } from "@/components/account/ClineAuthStatus"
import { useClineSignIn } from "@/context/ClineAuthContext"
import { useSignIn as useShengSuanYunSignIn } from "@/context/ShengSuanYunAuthContext"

export const AccountWelcomeView = () => {
	const { isLoginLoading: isClineLoginLoading, authStatusMessage, handleSignIn: handleClineSignIn } = useClineSignIn()
	const { isLoginLoading: isShengSuanYunLoginLoading, handleSignIn: handleShengSuanYunSignIn } = useShengSuanYunSignIn()

	return (
		<div className="flex flex-col items-center gap-2.5">
			<ClineLogoPanda className="size-16 mb-4" />
			<p>注册账户，即可使用最新模型、通过计费仪表板查看使用情况与额度，以及体验更多即将推出的功能。</p>

			<VSCodeButton
				className="w-full mb-4"
				disabled={isClineLoginLoading || isShengSuanYunLoginLoading}
				onClick={handleShengSuanYunSignIn}>
				注册胜算云
				{isShengSuanYunLoginLoading && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh" />
					</span>
				)}
			</VSCodeButton>

			<p className="w-full mb-4 text-foreground/75 text-center cursor-pointer" onClick={handleClineSignIn}>
				注册 Cline
				{isClineLoginLoading && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh" />
					</span>
				)}
			</p>

			<ClineAuthStatus message={authStatusMessage} />

			<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">
				继续操作即表示您同意 <VSCodeLink href="https://cline.bot/tos">服务条款</VSCodeLink> 和{" "}
				<VSCodeLink href="https://cline.bot/privacy">隐私政策.</VSCodeLink>
			</p>
		</div>
	)
}
