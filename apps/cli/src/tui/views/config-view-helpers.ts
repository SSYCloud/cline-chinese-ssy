import type {
	InteractiveConfigData,
	InteractiveConfigItem,
	InteractiveConfigTab,
} from "../../tui/interactive-config";
import { isToggleableInteractiveConfigItem } from "../../tui/interactive-config";

export type ConfigAction =
	| { kind: "open-provider" }
	| { kind: "open-model" }
	| { kind: "open-theme" }
	| { kind: "toggle-item"; item: InteractiveConfigItem }
	| { kind: "delete-item"; item: InteractiveConfigItem }
	| {
			kind: "ext-detail";
			item: InteractiveConfigItem;
	  }
	| { kind: "open-mcp" };

const CONFIG_TABS: InteractiveConfigTab[] = [
	"general",
	"mcp",
	"skills",
	"rules",
	"tools",
	"plugins",
	"agents",
	"hooks",
];

export function getConfigTabs(): InteractiveConfigTab[] {
	return CONFIG_TABS;
}

export function resolveInitialConfigTab(
	tab: InteractiveConfigTab | undefined,
): InteractiveConfigTab {
	return tab && CONFIG_TABS.includes(tab) ? tab : "general";
}

export function getAdjacentConfigTab(
	currentTab: InteractiveConfigTab,
	direction: "left" | "right",
): InteractiveConfigTab {
	const currentIndex = CONFIG_TABS.indexOf(currentTab);
	const safeIndex = currentIndex >= 0 ? currentIndex : 0;
	const delta = direction === "left" ? -1 : 1;
	const nextIndex =
		(safeIndex + delta + CONFIG_TABS.length) % CONFIG_TABS.length;
	return CONFIG_TABS[nextIndex] ?? "general";
}

export function toTabLabel(tab: InteractiveConfigTab): string {
	switch (tab) {
		case "general":
			return "常规";
		case "tools":
			return "工具";
		case "plugins":
			return "插件";
		case "agents":
			return "代理";
		case "hooks":
			return "钩子";
		case "skills":
			return "技能";
		case "rules":
			return "规则";
		case "mcp":
			return "MCP";
		case "workflows":
			return "工作流";
	}
}

function sourceRank(source: InteractiveConfigItem["source"]): number {
	switch (source) {
		case "builtin":
			return 0;
		case "workspace":
			return 1;
		case "workspace-plugin":
			return 2;
		case "global":
			return 3;
		case "global-plugin":
			return 4;
	}
}

function sortBySourceThenName(
	items: InteractiveConfigItem[],
): InteractiveConfigItem[] {
	return [...items].sort((a, b) => {
		if (a.source !== b.source) {
			return sourceRank(a.source) - sourceRank(b.source);
		}
		return a.name.localeCompare(b.name);
	});
}

export function resolveActiveConfigItems(
	configData: InteractiveConfigData,
	configTab: InteractiveConfigTab,
): InteractiveConfigItem[] {
	switch (configTab) {
		case "general":
			return [];
		case "tools":
			return sortBySourceThenName(configData.tools);
		case "plugins":
			return sortBySourceThenName(configData.plugins);
		case "agents":
			return sortBySourceThenName(configData.agents);
		case "hooks":
			return sortBySourceThenName(configData.hooks);
		case "skills":
			return sortBySourceThenName([
				...configData.workflows,
				...configData.skills,
			]);
		case "rules":
			return sortBySourceThenName(configData.rules);
		case "mcp":
			return sortBySourceThenName(configData.mcp);
		case "workflows":
			return sortBySourceThenName(configData.workflows);
	}
}

export function isToggleableConfigItem(item: InteractiveConfigItem): boolean {
	return isToggleableInteractiveConfigItem(item);
}

export function isDeletableConfigItem(item: InteractiveConfigItem): boolean {
	return item.kind === "plugin";
}

export function resolveConfigItemSelectAction(
	item: InteractiveConfigItem,
): ConfigAction {
	if (
		typeof item.enabled === "boolean" &&
		item.kind !== "skill" &&
		isToggleableConfigItem(item)
	) {
		return { kind: "toggle-item", item };
	}

	return {
		kind: "ext-detail",
		item,
	};
}

export function resolveConfigItemToggleAction(
	item: InteractiveConfigItem,
): ConfigAction | undefined {
	if (typeof item.enabled !== "boolean" || !isToggleableConfigItem(item)) {
		return undefined;
	}
	return { kind: "toggle-item", item };
}

export function resolveConfigItemDeleteAction(
	item: InteractiveConfigItem,
): ConfigAction | undefined {
	if (!isDeletableConfigItem(item)) {
		return undefined;
	}
	return { kind: "delete-item", item };
}

export function isInlineConfigAction(
	action: ConfigAction | undefined,
): boolean {
	return action?.kind === "toggle-item";
}

export function canToggleConfigFooterRow(
	row:
		| { kind: "toggle" }
		| { kind: "ext"; enabled?: boolean; item: InteractiveConfigItem }
		| { kind: string }
		| undefined,
): boolean {
	if (!row) {
		return false;
	}
	if (row.kind === "toggle") {
		return true;
	}
	return (
		row.kind === "ext" &&
		"item" in row &&
		typeof row.enabled === "boolean" &&
		isToggleableConfigItem(row.item)
	);
}

export function canDeleteConfigFooterRow(
	row:
		| { kind: "ext"; item: InteractiveConfigItem }
		| { kind: string }
		| undefined,
): boolean {
	return (
		row?.kind === "ext" && "item" in row && isDeletableConfigItem(row.item)
	);
}

export function getConfigFooterText({
	canToggle = false,
	canDelete = false,
}: {
	canToggle?: boolean;
	canDelete?: boolean;
} = {}): string {
	const actions = ["←/→ 切换标签页", "↑/↓ 导航", "Tab/Enter 选择"];
	if (canToggle) {
		actions.push("空格 切换");
	}
	if (canDelete) {
		actions.push("D 删除");
	}
	actions.push("Esc 关闭");
	return actions.join(", ");
}

export function getConfigItemDisplayName(name: string): string {
	return name;
}

export function getPluginDiagnosticsLoadingText(
	tab: InteractiveConfigTab,
): string | undefined {
	if (tab === "tools") {
		return "正在加载插件工具...";
	}
	if (tab === "plugins") {
		return "正在加载插件诊断...";
	}
	return undefined;
}
