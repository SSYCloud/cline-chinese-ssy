export type CommandPaletteAction =
	| "settings"
	| "change-model"
	| "change-provider"
	| "theme"
	| "account"
	| "mcp"
	| "plugins"
	| "compact"
	| "skills"
	| "fork"
	| "undo"
	| "clear"
	| "history"
	| "help"
	| "quit";

export interface CommandPaletteResult {
	kind: "action";
	action: CommandPaletteAction;
}

export interface CommandPaletteItem {
	id: string;
	label: string;
	description: string;
	shortcut: string;
	keywords: string[];
	result: CommandPaletteResult;
}

const ACTION_ITEMS: Array<{
	action: CommandPaletteAction;
	label: string;
	shortcut: string;
	description: string;
	keywords: string[];
	requiresFork?: boolean;
}> = [
	{
		action: "settings",
		label: "打开设置",
		shortcut: "Opt+S",
		description: "查看并编辑 CLI 配置",
		keywords: ["config", "preferences", "general", "tools"],
	},
	{
		action: "change-model",
		label: "切换模型",
		shortcut: "Opt+M",
		description: "为后续请求选择其他模型",
		keywords: ["model", "provider", "llm", "reasoning", "thinking"],
	},
	{
		action: "change-provider",
		label: "切换提供商",
		shortcut: "Opt+P",
		description: "切换提供商并配置凭据",
		keywords: ["provider", "api key", "account", "auth"],
	},
	{
		action: "theme",
		label: "切换主题",
		shortcut: "Opt+T",
		description: "为 TUI 选择配色主题",
		keywords: ["theme", "colors", "dark", "light", "appearance"],
	},
	{
		action: "mcp",
		label: "管理 MCP 服务器",
		shortcut: "Opt+C",
		description: "启用、禁用或查看 MCP 服务器",
		keywords: ["mcp", "server", "tool", "toggle"],
	},
	{
		action: "plugins",
		label: "管理插件",
		shortcut: "Opt+G",
		description: "打开插件设置",
		keywords: ["plugins", "extensions", "settings"],
	},
	{
		action: "account",
		label: "打开账户",
		shortcut: "Opt+A",
		description: "查看或切换你的 Cline 账户",
		keywords: ["account", "login", "auth", "cline"],
	},
	{
		action: "compact",
		label: "压缩上下文",
		shortcut: "Opt+X",
		description: "压缩上下文",
		keywords: ["compact", "context", "compress"],
	},
	{
		action: "skills",
		label: "浏览技能",
		shortcut: "Opt+W",
		description: "插入已安装的技能或工作流命令",
		keywords: ["skills", "workflows", "marketplace"],
	},
	{
		action: "fork",
		label: "创建会话分叉",
		shortcut: "Opt+R",
		description: "将当前对话分支到新会话",
		keywords: ["fork", "session", "branch"],
		requiresFork: true,
	},
	{
		action: "undo",
		label: "恢复检查点",
		shortcut: "Opt+U",
		description: "返回到更早的检查点",
		keywords: ["undo", "checkpoint", "restore"],
	},
	{
		action: "clear",
		label: "开始新会话",
		shortcut: "Opt+L",
		description: "清空对话并重新开始会话",
		keywords: ["clear", "new", "reset"],
	},
	{
		action: "history",
		label: "会话历史",
		shortcut: "Opt+H",
		description: "恢复之前的会话",
		keywords: ["history", "resume", "sessions"],
	},
	{
		action: "help",
		label: "打开帮助",
		shortcut: "Opt+K",
		description: "显示 CLI 快捷键和命令",
		keywords: ["help", "shortcuts", "commands"],
	},
	{
		action: "quit",
		label: "退出 Cline",
		shortcut: "Opt+Q",
		description: "关闭交互式 CLI",
		keywords: ["quit", "exit"],
	},
];

function normalize(value: string): string {
	return value
		.toLowerCase()
		.replace(/[+-]/g, " ")
		.replace(/[^a-z0-9/ ]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function includesAllTokens(haystack: string, tokens: string[]): boolean {
	return tokens.every((token) => haystack.includes(token));
}

function scoreItem(item: CommandPaletteItem, query: string): number {
	const normalizedQuery = normalize(query.trim());
	if (!normalizedQuery) return 1;

	const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
	const label = normalize(item.label);
	const description = normalize(item.description);
	const keywordText = normalize(item.keywords.join(" "));
	const shortcut = normalize(item.shortcut);
	const searchText = `${label} ${description} ${keywordText} ${shortcut}`;

	if (!includesAllTokens(searchText, tokens)) return 0;
	if (label === normalizedQuery) return 120;
	if (label.startsWith(normalizedQuery)) return 100;
	if (label.includes(normalizedQuery)) return 75;
	if (shortcut.includes(normalizedQuery)) return 70;
	if (keywordText.includes(normalizedQuery)) return 60;
	if (description.includes(normalizedQuery)) return 45;
	return 20;
}

export function buildCommandPaletteItems(input: {
	canForkSession: boolean;
}): CommandPaletteItem[] {
	return ACTION_ITEMS.filter(
		(item) => !item.requiresFork || input.canForkSession,
	).map((item) => ({
		id: `action:${item.action}`,
		label: item.label,
		description: item.description,
		shortcut: item.shortcut,
		keywords: item.keywords,
		result: { kind: "action" as const, action: item.action },
	}));
}

export function filterCommandPaletteItems(
	items: CommandPaletteItem[],
	query: string,
): CommandPaletteItem[] {
	return items
		.map((item, index) => ({
			item,
			index,
			score: scoreItem(item, query),
		}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.index - b.index;
		})
		.map((entry) => entry.item);
}

export function findCommandPaletteShortcut(
	items: readonly CommandPaletteItem[],
	key: { name: string; meta: boolean; option?: boolean; shift: boolean },
): CommandPaletteItem | undefined {
	if (!key.meta && key.option !== true) return undefined;
	const keyName = key.name.toLowerCase();
	return items.find((item) => {
		const [, shortcutKey] = item.shortcut.toLowerCase().split("+");
		if (!shortcutKey) return false;
		return shortcutKey === keyName;
	});
}
