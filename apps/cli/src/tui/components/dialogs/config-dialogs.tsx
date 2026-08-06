import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useState } from "react";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
	LoadInteractiveConfigDataOptions,
} from "../../interactive-config";
import { palette } from "../../palette";
import {
	getExtDetailFooterText,
	getExtDetailRows,
	shouldCloseExtDetailForKey,
	shouldToggleExtDetailForKey,
} from "./config-dialogs-helpers";

export function ExtDetailContent(
	props: ChoiceContext<void> & {
		item: InteractiveConfigItem;
		onToggleConfigItem?: (
			item: InteractiveConfigItem,
			options?: LoadInteractiveConfigDataOptions,
		) => Promise<InteractiveConfigData | undefined>;
	},
) {
	const [item, setItem] = useState(props.item);
	const [toggleError, setToggleError] = useState<string | undefined>();

	const toggleStatus = async () => {
		if (
			!props.onToggleConfigItem ||
			!shouldToggleExtDetailForKey("space", item)
		) {
			return;
		}
		const previousItem = item;
		setToggleError(undefined);
		if (typeof item.enabled === "boolean") {
			setItem({ ...item, enabled: !item.enabled });
		}
		try {
			const nextData = await props.onToggleConfigItem(item, {
				includePluginTools: false,
			});
			if (nextData) {
				const nextItem = [
					...nextData.workflows,
					...nextData.rules,
					...nextData.skills,
					...nextData.hooks,
					...nextData.agents,
					...nextData.plugins,
					...nextData.mcp,
					...nextData.tools,
				].find(
					(candidate) =>
						candidate.id === item.id && candidate.path === item.path,
				);
				if (nextItem) {
					setItem(nextItem);
				}
			}
		} catch (error) {
			setItem(previousItem);
			const message = error instanceof Error ? error.message : String(error);
			setToggleError(`更新 ${item.name} 失败：${message}`);
		}
	};

	useDialogKeyboard((key) => {
		if (shouldToggleExtDetailForKey(key.name, item)) {
			void toggleStatus();
			return;
		}
		if (shouldCloseExtDetailForKey(key.name)) {
			props.dismiss();
		}
	}, props.dialogId);
	const rows = getExtDetailRows(item);
	const footerText = getExtDetailFooterText(item);

	return (
		<box flexDirection="column" paddingX={1}>
			{rows.map((row) => {
				switch (row.kind) {
					case "header":
						return (
							<box
								key="header"
								flexDirection="row"
								justifyContent="space-between"
							>
								<text fg={palette.act}>
									<strong>{row.name}</strong>
								</text>
								<text
									fg={row.source === "workspace" ? palette.success : "gray"}
								>
									{row.source}
								</text>
							</box>
						);
					case "field":
						return (
							<box key={row.label} flexDirection="column" marginTop={1}>
								<text fg="gray">{row.label}</text>
								{row.value.map((line) => (
									<text key={`${row.label}-${line}`}>{line || " "}</text>
								))}
							</box>
						);
					case "status":
						return (
							<box
								key="status"
								flexDirection="row"
								marginTop={1}
								justifyContent="space-between"
							>
								<text fg="gray">状态</text>
								<text fg={row.enabled ? palette.success : "red"}>
									{row.enabled ? "已启用" : "已禁用"}
								</text>
							</box>
						);
				}
				return null;
			})}
			<text fg="gray" marginTop={1}>
				<em>{footerText}</em>
			</text>
			{toggleError && (
				<text fg="red" marginTop={1}>
					{toggleError}
				</text>
			)}
		</box>
	);
}

export function DeleteConfigItemConfirmContent(
	props: ChoiceContext<boolean> & {
		item: InteractiveConfigItem;
	},
) {
	useDialogKeyboard((key) => {
		if (key.name === "return" || key.name === "y") {
			props.resolve(true);
		} else if (key.name === "escape" || key.name === "n") {
			props.dismiss();
		}
	}, props.dialogId);

	return (
		<box flexDirection="column" paddingX={1}>
			<text>删除插件 {props.item.name}？</text>
			<text fg="gray" marginTop={1}>
				这将从 {props.item.path} 移除已安装的插件文件。
			</text>
			<text fg="gray" marginTop={1}>
				<em>Y/Enter 确认，N/Esc 取消</em>
			</text>
		</box>
	);
}

export function ConfigErrorContent(
	props: ChoiceContext<void> & {
		title: string;
		message: string;
	},
) {
	useDialogKeyboard((key) => {
		if (key.name === "return" || key.name === "escape") {
			props.dismiss();
		}
	}, props.dialogId);

	return (
		<box flexDirection="column" paddingX={1}>
			<text fg="red">{props.title}</text>
			<text fg="gray" marginTop={1}>
				{props.message}
			</text>
			<text fg="gray" marginTop={1}>
				<em>Enter/Esc 关闭</em>
			</text>
		</box>
	);
}
