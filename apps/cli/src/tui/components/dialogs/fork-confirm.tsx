import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";

export function ForkConfirmContent(ctx: ChoiceContext<boolean>) {
	useDialogKeyboard((key) => {
		if (key.name === "return" || key.name === "y") {
			ctx.resolve(true);
		} else if (key.name === "escape" || key.name === "n") {
			ctx.dismiss();
		}
	}, ctx.dialogId);

	return (
		<box flexDirection="column" paddingX={1}>
			<text>创建当前对话的分叉？</text>
			<text fg="gray" marginTop={1}>
				分叉将成为当前会话。使用 /history 可切回或打开另一个会话。
			</text>
			<text fg="gray" marginTop={1}>
				<em>Y/Enter 确认，N/Esc 取消</em>
			</text>
		</box>
	);
}
