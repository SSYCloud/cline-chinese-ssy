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
		prompt: "Make a beautiful Next.js notetaking app, using Tailwind CSS for styling. Set up the basic structure and a simple UI for adding and viewing notes.",
		buttonText: ">",
	},
	{
		id: "terminal_cli_tool",
		title: "制作 CLI 工具",
		description: "开发强大的终端 CLI 来自动化酷炫任务",
		icon: "TerminalIcon",
		actionCommand: "cline/createCliTool",
		prompt: "Make a terminal CLI tool using Node.js that organizes files in a directory by type, size, or date. It should have options to sort files into folders, show file statistics, find duplicates, and clean up empty directories. Include colorful output and progress indicators.",
		buttonText: ">",
	},
	{
		id: "snake_game",
		title: "开发小游戏",
		description: "编写可在浏览器中运行的经典贪吃蛇游戏。",
		icon: "GameIcon",
		actionCommand: "cline/createSnakeGame",
		prompt: "Make a classic Snake game using HTML, CSS, and JavaScript. The game should be playable in the browser, with keyboard controls for the snake, a scoring system, and a game over state.",
		buttonText: ">",
	},
]
