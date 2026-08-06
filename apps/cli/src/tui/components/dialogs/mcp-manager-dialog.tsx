import {
	resolveDefaultMcpSettingsPath,
	setMcpServerDisabled,
} from "@cline/core";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useState } from "react";
import { palette } from "../../palette";

export interface McpEntry {
	name: string;
	path: string;
	enabled?: boolean;
	description?: string;
	lastError?: string;
	pluginName?: string;
}

export type McpServerToggleResult =
	| { ok: true; server: McpEntry }
	| { ok: false; message: string };

function stringifyError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function getMcpManagerFooterText(hasServers: boolean): string {
	return hasServers
		? "空格切换所选，Esc 返回"
		: "按 Esc 返回";
}

export function getMcpManagerEntryStatus(
	server: Pick<McpEntry, "description" | "lastError">,
): string {
	return server.lastError ? "oauth error" : (server.description ?? "");
}

export function toggleMcpServer(server: McpEntry): McpServerToggleResult {
	if (server.pluginName) {
		return {
			ok: false,
			message: `MCP 服务器 "${server.name}" 由插件 "${server.pluginName}" 管理。禁用该插件即可禁用此服务器。`,
		};
	}
	try {
		const currentlyEnabled = server.enabled !== false;
		setMcpServerDisabled({
			filePath: server.path,
			name: server.name,
			disabled: currentlyEnabled,
		});
		return {
			ok: true,
			server: {
				...server,
				enabled: !currentlyEnabled,
			},
		};
	} catch (error) {
		return {
			ok: false,
			message: `无法切换 MCP 服务器 "${server.name}"：${stringifyError(error)}`,
		};
	}
}

export function McpManagerContent(
	props: ChoiceContext<boolean> & {
		servers: McpEntry[];
	},
) {
	const [selected, setSelected] = useState(0);
	const [servers, setServers] = useState(props.servers);
	const [changed, setChanged] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const settingsPath = servers[0]?.path ?? resolveDefaultMcpSettingsPath();
	const itemCount = servers.length;
	const selectedServer = servers[selected];
	const hasPluginOwnedServers = servers.some((server) => server.pluginName);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			if (changed) {
				props.resolve(true);
			} else {
				props.dismiss();
			}
			return;
		}
		if (itemCount > 0) {
			if (key.name === "up") {
				setError(null);
				setSelected((s) => (s > 0 ? s - 1 : itemCount - 1));
				return;
			}
			if (key.name === "down") {
				setError(null);
				setSelected((s) => (s < itemCount - 1 ? s + 1 : 0));
				return;
			}
			if (key.name === "space") {
				const target = servers[selected];
				const result = target ? toggleMcpServer(target) : undefined;
				if (result?.ok) {
					setServers((current) =>
						current.map((server, index) =>
							index === selected ? result.server : server,
						),
					);
					setChanged(true);
					setError(null);
				} else if (result) {
					setError(result.message);
				}
				return;
			}
		}
	}, props.dialogId);

	return (
		<box flexDirection="column" paddingX={1}>
			<text fg={palette.act}>MCP 服务器</text>

			<text fg="gray" marginTop={1}>
				设置文件：
			</text>
			<text selectable>{settingsPath}</text>

			<text fg="gray" marginTop={1}>
				运行 cline mcp 可添加、编辑或移除服务器。
			</text>

			{servers.length > 0 && (
				<box flexDirection="column" marginTop={1}>
					{servers.map((srv, i) => {
						const isSel = i === selected;
						const enabled =
							typeof srv.enabled === "boolean" ? srv.enabled : true;
						const enabledIcon =
							typeof srv.enabled === "boolean" ? (enabled ? "● " : "○ ") : "";
						const status = getMcpManagerEntryStatus(srv);
						let rowColor = isSel ? palette.act : "gray";
						if (enabled && typeof srv.enabled === "boolean") {
							rowColor = palette.success;
						}
						if (srv.lastError) {
							rowColor = palette.error;
						}
						return (
							<box
								key={srv.name}
								flexDirection="row"
								justifyContent="space-between"
							>
								<text fg={rowColor}>
									{isSel ? "\u25b8 " : "  "}
									{enabledIcon}
									{srv.name}
									{srv.pluginName ? " *" : ""}
								</text>
								{status && (
									<text fg={srv.lastError ? palette.error : "gray"}>
										{status}
									</text>
								)}
							</box>
						);
					})}
				</box>
			)}

			{servers.length === 0 && (
				<text fg="gray" marginTop={1}>
					尚未配置服务器。
				</text>
			)}

			{error && (
				<text fg={palette.error} marginTop={1}>
					{error}
				</text>
			)}

			{selectedServer?.lastError && (
				<box flexDirection="column" marginTop={1}>
					<text fg={palette.error}>OAuth 错误</text>
					<text fg={palette.error}>{selectedServer.lastError}</text>
					<text fg="gray">
						运行 cline mcp 并选择"授权 OAuth"以重试。
					</text>
				</box>
			)}

			{hasPluginOwnedServers && (
				<text fg="gray" marginTop={1}>
					* 由插件管理；禁用该插件即可禁用此服务器。
				</text>
			)}

			<text fg="gray" marginTop={1}>
				<em>{getMcpManagerFooterText(servers.length > 0)}</em>
			</text>
		</box>
	);
}
