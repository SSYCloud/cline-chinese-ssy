import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "@/utils/vscode"
import styled from "styled-components"
import { LINKS } from "@/constants"

type AddLocalServerFormProps = {
	onServerAdded: () => void
}

const AddLocalServerForm = ({ onServerAdded }: AddLocalServerFormProps) => {
	return (
		<FormContainer>
			<div className="text-[var(--vscode-foreground)]">
				通过在 <code>cline_mcp_settings.json</code> 中配置本地 MCP 服务器来添加本地 MCP 服务器。您需要指定 JSON
				配置中的服务器名称、命令、参数和任何必需的环境变量。
				<VSCodeLink href={LINKS.DOCUMENTATION.LOCAL_MCP_SERVER_DOCS} style={{ display: "inline" }}>
					了解更多信息
				</VSCodeLink>
			</div>

			<VSCodeButton
				appearance="primary"
				style={{ width: "100%", marginBottom: "5px", marginTop: 8 }}
				onClick={() => {
					vscode.postMessage({ type: "openMcpSettings" })
				}}>
				打开 cline_mcp_settings.json
			</VSCodeButton>
		</FormContainer>
	)
}

const FormContainer = styled.div`
	padding: 16px 20px;
	display: flex;
	flex-direction: column;
	gap: 8px;
`

export default AddLocalServerForm
