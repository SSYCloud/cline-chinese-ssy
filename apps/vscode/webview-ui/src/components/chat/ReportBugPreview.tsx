import React from "react"
import MarkdownBlock from "../common/MarkdownBlock"

interface ReportBugPreviewProps {
	data: string
}

const ReportBugPreview: React.FC<ReportBugPreviewProps> = ({ data }) => {
	// Parse the JSON data from the context string
	const bugData = React.useMemo(() => {
		try {
			return JSON.parse(data || "{}")
		} catch (e) {
			console.error("Failed to parse bug report data", e)
			return {}
		}
	}, [data])

	return (
		<div className="bg-badge-background/50 text-badge-foreground rounded-xs p-3">
			<h2 className="font-bold mb-3">{bugData.title || "Bug 报告"}</h2>

			<div className="space-y-3 text-sm">
				{bugData.what_happened && (
					<div>
						<div className="font-semibold">发生了什么？</div>
						<MarkdownBlock markdown={bugData.what_happened} />
					</div>
				)}

				{bugData.steps_to_reproduce && (
					<div>
						<div className="font-semibold">复现步骤</div>
						<MarkdownBlock markdown={bugData.steps_to_reproduce} />
					</div>
				)}

				{bugData.api_request_output && (
					<div>
						<div className="font-semibold">相关 API 请求输出</div>
						<MarkdownBlock markdown={bugData.api_request_output} />
					</div>
				)}

				{bugData.provider_and_model && (
					<div>
						<div className="font-semibold">提供商/模型</div>
						<MarkdownBlock markdown={bugData.provider_and_model} />
					</div>
				)}

				{bugData.operating_system && (
					<div>
						<div className="font-semibold">操作系统</div>
						<MarkdownBlock markdown={bugData.operating_system} />
					</div>
				)}

				{bugData.system_info && (
					<div>
						<div className="font-semibold">系统信息</div>
						<MarkdownBlock markdown={bugData.system_info} />
					</div>
				)}

				{bugData.cline_version && (
					<div>
						<div className="font-semibold">Cline 版本</div>
						<MarkdownBlock markdown={bugData.cline_version} />
					</div>
				)}

				{bugData.additional_context && (
					<div>
						<div className="font-semibold">补充上下文</div>
						<MarkdownBlock markdown={bugData.additional_context} />
					</div>
				)}
			</div>
		</div>
	)
}

export default ReportBugPreview
