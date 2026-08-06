import { ActionMetadata } from "./types"

export const ACTION_METADATA: ActionMetadata[] = [
	{
		id: "readFiles",
		label: "读取文件",
		shortName: "读取",
		icon: "codicon-search",
	},
	{
		id: "editFiles",
		label: "编辑文件",
		shortName: "编辑",
		icon: "codicon-edit",
	},
	{
		id: "executeSafeCommands",
		label: "执行命令",
		shortName: "命令",
		icon: "codicon-terminal",
	},
	{
		id: "useBrowser",
		label: "获取网页内容",
		shortName: "网页获取",
		icon: "codicon-globe",
	},
	{
		id: "useMcp",
		label: "使用 MCP 服务器",
		shortName: "MCP",
		icon: "codicon-server",
	},
]
