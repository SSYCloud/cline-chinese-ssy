import type { EnterpriseBillItem } from "@shared/proto/cline/account"
import { VSCodeDataGrid, VSCodeDataGridCell, VSCodeDataGridRow } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { formatTimestamp } from "@/utils/format"

interface EnterpriseBillTableProps {
	bills: EnterpriseBillItem[]
	isLoading: boolean
}

const EnterpriseBillTable = memo(({ bills, isLoading }: EnterpriseBillTableProps) => {
	return (
		<div className="flex flex-col grow h-full">
			<div className="flex border-b border-(--vscode-panel-border)">
				<span className="px-3 py-2 text-sm font-medium border-b-2 border-(--vscode-focusBorder) text-(--vscode-foreground)">
					使用记录
				</span>
			</div>
			<div className="mt-[15px] rounded-md overflow-auto grow">
				{isLoading ? (
					<div className="flex justify-center items-center p-4">
						<div className="text-(--vscode-descriptionForeground)">加载中...</div>
					</div>
				) : bills.length > 0 ? (
					<VSCodeDataGrid>
						<VSCodeDataGridRow row-type="header">
							<VSCodeDataGridCell cell-type="columnheader" grid-column="1">
								时间
							</VSCodeDataGridCell>
							<VSCodeDataGridCell cell-type="columnheader" grid-column="2">
								模型
							</VSCodeDataGridCell>
							<VSCodeDataGridCell cell-type="columnheader" grid-column="3">
								输入 Tokens
							</VSCodeDataGridCell>
							<VSCodeDataGridCell cell-type="columnheader" grid-column="4">
								输出 Tokens
							</VSCodeDataGridCell>
							<VSCodeDataGridCell cell-type="columnheader" grid-column="5">
								总 Tokens
							</VSCodeDataGridCell>
						</VSCodeDataGridRow>
						{bills.map((bill, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: use index as key
							<VSCodeDataGridRow key={index}>
								<VSCodeDataGridCell grid-column="1">{formatTimestamp(bill.hourTime, "zh-CN")}</VSCodeDataGridCell>
								<VSCodeDataGridCell grid-column="2">{bill.modelName}</VSCodeDataGridCell>
								<VSCodeDataGridCell grid-column="3">{bill.totalPromptTokens}</VSCodeDataGridCell>
								<VSCodeDataGridCell grid-column="4">{bill.totalCompletionTokens}</VSCodeDataGridCell>
								<VSCodeDataGridCell grid-column="5">{bill.totalTokens}</VSCodeDataGridCell>
							</VSCodeDataGridRow>
						))}
					</VSCodeDataGrid>
				) : (
					<div className="flex justify-center items-center p-4">
						<div className="text-(--vscode-descriptionForeground)">没有使用记录</div>
					</div>
				)}
			</div>
		</div>
	)
})

export default EnterpriseBillTable
