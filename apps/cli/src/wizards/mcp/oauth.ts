import * as p from "@clack/prompts";
import {
	authorizeMcpServerOAuth,
	resolveDefaultMcpSettingsPath,
} from "@cline/core";
import open from "../../utils/open";

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const message = error.message.trim();
		if (message.length > 0) {
			return message;
		}
	}
	return String(error);
}

export async function authorizeMcpServerOAuthWithBrowser(
	name: string,
	options: { throwOnError?: boolean } = {},
): Promise<void> {
	p.log.info("正在打开浏览器以进行 MCP OAuth 授权");
	try {
		const result = await authorizeMcpServerOAuth({
			serverName: name,
			filePath: resolveDefaultMcpSettingsPath(),
			openUrl: async (url) => {
				p.log.message(`授权网址：${url}`);
				await open(url, { wait: false });
			},
			onServerListening: (info) => {
				p.log.message(`正在等待位于 ${info.callbackUrl} 的 OAuth 回调`);
			},
		});
		p.log.success(result.message);
	} catch (error) {
		if (options.throwOnError === true) {
			throw error instanceof Error ? error : new Error(toErrorMessage(error));
		}
		p.log.error(`OAuth 授权失败：${toErrorMessage(error)}`);
		p.log.warn(
			`服务器 "${name}" 仍已保存。请选择"授权 OAuth"以重试。`,
		);
	}
}
