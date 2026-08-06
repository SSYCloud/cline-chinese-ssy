// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useCallback, useMemo, useState } from "react";
import { palette } from "../tui/palette";
import {
	type DialogDismissKey,
	isAnyKeyDismiss,
} from "../tui/utils/dialog-keys";
import { getCliSubscriptionUrl } from "../utils/cline-pass-errors";
import open from "../utils/open";
import type { CliMigrationNotice } from "./notice";

/**
 * Enter opens the subscription page; any other (unmodified) key dismisses the
 * dialog; modifier-held keys are ignored.
 *
 * The dialog used to be dismissible only with Esc, but Esc is the least
 * reliable key across terminals (it arrives as a bare `\x1b` that needs
 * timeout disambiguation, and Windows console input layers are known to
 * swallow it), which left users stuck behind the promo with no way out.
 * Modifier-held keys are ignored so that holding Cmd/Ctrl to click the
 * subscription link never dismisses the dialog mid-click.
 */
export function resolveMigrationNoticeKeyAction(
	key: DialogDismissKey,
): "open" | "dismiss" | "ignore" {
	if (!isAnyKeyDismiss(key)) return "ignore";
	return key.name === "return" || key.name === "enter" ? "open" : "dismiss";
}

export function MigrationNoticeContent(
	props: ChoiceContext<boolean> & {
		notice: CliMigrationNotice;
	},
) {
	const { dialogId, notice, resolve } = props;
	const subscriptionUrl = useMemo(() => getCliSubscriptionUrl(), []);
	const [status, setStatus] = useState<string | undefined>();

	const openSubscriptionPage = useCallback(() => {
		setStatus("正在浏览器中打开 ClinePass...");
		void open(subscriptionUrl, { wait: false })
			.then(() => {
				setStatus("已在你的浏览器中打开 ClinePass。");
			})
			.catch(() => {
				setStatus(
					"无法自动打开浏览器。请使用下面的网址。",
				);
			});
	}, [subscriptionUrl]);

	useDialogKeyboard((key) => {
		const action = resolveMigrationNoticeKeyAction(key);
		if (action === "ignore") return;
		if (action === "open") {
			openSubscriptionPage();
			return;
		}
		resolve(true);
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg={palette.act}>{notice.title}</text>
			<box flexDirection="column">
				<text selectable>
					ClinePass 是一个每月 $9.99 的订阅套餐，可访问最新的开放权重编程模型，
					配额足以满足日常工作需要，成本远低于直接支付 API 费用。
				</text>
				<text selectable>现在以限时促销价 $4.99 试用。</text>
			</box>
			<box flexDirection="row">
				<text fg={palette.act} selectable>
					<a href={subscriptionUrl}>{subscriptionUrl}</a>
				</text>
			</box>
			<box flexDirection="row">
				<box paddingX={1} backgroundColor={palette.act}>
					<text fg={palette.textOnSelection}>打开 ClinePass</text>
				</box>
			</box>
			{status && <text fg={palette.muted}>{status}</text>}
			<text fg={palette.muted}>
				按 Enter 打开，按任意其他键关闭
				</text>
		</box>
	);
}
