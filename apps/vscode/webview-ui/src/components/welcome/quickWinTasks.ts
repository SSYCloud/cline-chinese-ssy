export interface QuickWinTask {
	id: string
	title: string
	description: string
	icon?: string
	actionCommand: string
	prompt: string
	buttonText?: string
}

export const quickWinTasks: QuickWinTask[] = [
	{
		id: "nextjs_notetaking_app",
		title: "构建 Next.js 应用",
		description: "用 Next.js 和 Tailwind 创建精美的笔记应用",
		icon: "WebAppIcon",
		actionCommand: "cline/createNextJsApp",
		prompt: "使用 Next.js 和 Tailwind CSS 创建一个精美的笔记应用。搭建基本结构，并实现一个简单的界面用于添加和查看笔记。",
		buttonText: ">",
	},
	{
		id: "terminal_cli_tool",
		title: "制作 CLI 工具",
		description: "开发强大的终端 CLI 来自动化酷炫任务",
		icon: "TerminalIcon",
		actionCommand: "cline/createCliTool",
		prompt: "使用 Node.js 制作一个终端 CLI 工具，按类型、大小或日期整理目录中的文件。它应具备将文件分类到文件夹、显示文件统计信息、查找重复文件以及清理空目录等选项。包含彩色输出和进度指示。",
		buttonText: ">",
	},
	{
		id: "snake_game",
		title: "开发小游戏",
		description: "编写可在浏览器中运行的经典贪吃蛇游戏。",
		icon: "GameIcon",
		actionCommand: "cline/createSnakeGame",
		prompt: "使用 HTML、CSS 和 JavaScript 制作一个经典的贪吃蛇游戏。游戏应在浏览器中可玩，支持键盘控制蛇的移动、计分系统和游戏结束状态。",
		buttonText: ">",
	},
]
