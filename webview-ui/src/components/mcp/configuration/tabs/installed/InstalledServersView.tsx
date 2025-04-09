import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import ServersToggleList from "./ServersToggleList"
const InstalledServersView = () => {
	const { mcpServers: servers } = useExtensionState()

	return (
		<div style={{ padding: "16px 20px" }}>
			<div
				style={{
					color: "var(--vscode-foreground)",
					fontSize: "13px",
					marginBottom: "16px",
					marginTop: "5px",
				}}>
				The{" "}
				<VSCodeLink href="https://github.com/modelcontextprotocol" style={{ display: "inline" }}>
					模型上下文协议
				</VSCodeLink>{" "}
				支持与本地运行的 MCP 服务器通信，这些服务器提供额外的工具和资源来扩展 Cline 的能力。您可以使用{" "}
				<VSCodeLink href="https://github.com/modelcontextprotocol/servers" style={{ display: "inline" }}>
					社区版服务器
				</VSCodeLink>{" "}
				或要求 Cline 创建特定于您的工作流程的新工具（例如，“添加获取最新 npm 文档的工具”）.{" "}
				<VSCodeLink href="https://x.com/sdrzn/status/1867271665086074969" style={{ display: "inline" }}>
					查看 demo.
				</VSCodeLink>
			</div>

			<ServersToggleList servers={servers} isExpandable={true} hasTrashIcon={false} />

			{/* Settings Section */}
			<div style={{ marginBottom: "20px", marginTop: 10 }}>
				<VSCodeButton
					appearance="secondary"
					style={{ width: "100%", marginBottom: "5px" }}
					onClick={() => {
						vscode.postMessage({ type: "openMcpSettings" })
					}}>
					<span className="codicon codicon-server" style={{ marginRight: "6px" }}></span>
					配置 MCP 服务
				</VSCodeButton>

				<div style={{ textAlign: "center" }}>
					<VSCodeLink
						onClick={() => {
							vscode.postMessage({
								type: "openExtensionSettings",
								text: "cline.mcp",
							})
						}}
						style={{ fontSize: "12px" }}>
						MCP 高级设置
					</VSCodeLink>
				</div>
			</div>
		</div>
	)
}

export default InstalledServersView
