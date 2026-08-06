import type { InteractiveConfigItem } from "../../interactive-config";
import { isToggleableInteractiveConfigItem } from "../../interactive-config";

export type ExtDetailRow =
	| { kind: "header"; name: string; source: string }
	| { kind: "field"; label: "路径" | "描述" | "错误"; value: string[] }
	| { kind: "status"; enabled: boolean };

const TOGGLE_FOOTER = "空格切换状态，Tab/Enter/Esc 返回";
const DETAIL_FOOTER = "Tab/Enter/Esc 返回";

const MAX_DESCRIPTION_LINES = 12;
const MAX_DESCRIPTION_COLUMNS = 78;

function wrapDetailLine(line: string): string[] {
	if (line.length <= MAX_DESCRIPTION_COLUMNS) {
		return [line];
	}
	const wrapped: string[] = [];
	let remaining = line;
	while (remaining.length > MAX_DESCRIPTION_COLUMNS) {
		let splitAt = remaining.lastIndexOf(" ", MAX_DESCRIPTION_COLUMNS);
		if (splitAt <= 0) {
			splitAt = MAX_DESCRIPTION_COLUMNS;
		}
		wrapped.push(remaining.slice(0, splitAt));
		remaining = remaining.slice(splitAt).trimStart();
	}
	wrapped.push(remaining);
	return wrapped;
}

function truncateDescription(description: string): string[] {
	const lines = description.split("\n").flatMap(wrapDetailLine);
	if (lines.length <= MAX_DESCRIPTION_LINES) {
		return lines;
	}
	return [
		...lines.slice(0, MAX_DESCRIPTION_LINES),
		`… 已截断 ${lines.length - MAX_DESCRIPTION_LINES} 行`,
	];
}

export function shouldCloseExtDetailForKey(keyName: string): boolean {
	return keyName === "escape" || keyName === "return" || keyName === "tab";
}

export function shouldToggleExtDetailForKey(
	keyName: string,
	item: Pick<InteractiveConfigItem, "kind" | "source" | "enabled">,
): boolean {
	return (
		keyName === "space" &&
		typeof item.enabled === "boolean" &&
		isToggleableInteractiveConfigItem(item)
	);
}

export function getExtDetailFooterText(
	item: Pick<InteractiveConfigItem, "kind" | "source" | "enabled">,
): string {
	return typeof item.enabled === "boolean" &&
		isToggleableInteractiveConfigItem(item)
		? TOGGLE_FOOTER
		: DETAIL_FOOTER;
}

export function getExtDetailRows(item: InteractiveConfigItem): ExtDetailRow[] {
	const rows: ExtDetailRow[] = [
		{ kind: "header", name: item.name, source: item.source },
		{ kind: "field", label: "路径", value: [item.path] },
	];
	if (item.description) {
		rows.push({
			kind: "field",
			label: "描述",
			value: truncateDescription(item.description),
		});
	}
	if (item.loadError) {
		rows.push({
			kind: "field",
			label: "错误",
			value: truncateDescription(item.loadError),
		});
	}
	if (
		typeof item.enabled === "boolean" &&
		isToggleableInteractiveConfigItem(item)
	) {
		rows.push({ kind: "status", enabled: item.enabled });
	}
	return rows;
}
