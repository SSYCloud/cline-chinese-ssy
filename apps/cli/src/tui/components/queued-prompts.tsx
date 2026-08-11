import "opentui-spinner/react";
import { useEffect, useState } from "react";
import { useSession } from "../contexts/session-context";
import { useTheme } from "../hooks/use-theme";
import type { QueuedPromptItem } from "../types";

function truncatePrompt(prompt: string): string {
	return prompt.length > 64 ? `${prompt.slice(0, 64)}...` : prompt;
}

function attachmentLabel(count: number): string {
	if (count <= 0) return "";
	return count === 1 ? " 1 attachment" : ` ${count} attachments`;
}

export function QueuedPrompts(props: {
	items: QueuedPromptItem[];
	selectedId: string | null;
	editingId: string | null;
	onEditConfirm: (id: string, prompt: string) => void;
}) {
	const session = useSession();
	const theme = useTheme();
	if (props.items.length === 0) return null;

	const selected = props.selectedId
		? props.items.find((item) => item.id === props.selectedId)
		: undefined;
	const selectedIsEditing = selected?.id === props.editingId;
	const escapeHint = session.isRunning ? "Esc 取消本轮" : "Esc 返回";
	const hint = selected
		? selectedIsEditing
			? "Enter 确认，Esc 取消"
			: selected.steer
				? session.isRunning
					? "等待中。↑/↓ 导航，Tab 编辑，Esc 取消本轮"
					: `已转向下一步。↑/↓ 导航，Tab 编辑，${escapeHint}`
				: `↑/↓ 导航，Enter 转向，Tab 编辑，${escapeHint}`
		: "↑ 转向或编辑消息";

	return (
		<box
			flexDirection="column"
			border
			borderStyle="rounded"
			borderColor={selected ? theme.selection : "gray"}
			paddingX={1}
		>
			<text fg="gray">
				<em>已排队的消息：</em>
			</text>
			{props.items.map((item) => {
				const isSelected = item.id === props.selectedId;
				const isEditing = item.id === props.editingId;
				return (
					<QueuedPromptRow
						key={item.id}
						item={item}
						selected={isSelected}
						editing={isEditing}
						onEditConfirm={(prompt) => props.onEditConfirm(item.id, prompt)}
					/>
				);
			})}
			<text fg="gray">
				<em>{hint}</em>
			</text>
		</box>
	);
}

function QueuedPromptRow(props: {
	item: QueuedPromptItem;
	selected: boolean;
	editing: boolean;
	onEditConfirm: (prompt: string) => void;
}) {
	const { item, selected, editing } = props;
	const theme = useTheme();
	const [editValue, setEditValue] = useState(item.prompt);

	useEffect(() => {
		if (editing) {
			setEditValue(item.prompt);
		}
	}, [editing, item.prompt]);

	return (
		<box
			paddingX={1}
			flexDirection="row"
			gap={1}
			backgroundColor={selected ? theme.selection : undefined}
		>
			{item.steer && !editing ? (
				<spinner
					name="dots"
					color={selected ? theme.textOnSelection : "gray"}
				/>
			) : (
				<text fg={selected ? theme.textOnSelection : "gray"} flexShrink={0}>
					{selected ? "❯" : " "}
				</text>
			)}
			{editing ? (
				<input
					value={editValue}
					onInput={setEditValue}
					onSubmit={() => props.onEditConfirm(editValue)}
					placeholder="编辑消息..."
					backgroundColor={theme.selection}
					focusedBackgroundColor={theme.selection}
					textColor={theme.textOnSelection}
					cursorColor={theme.textOnSelection}
					placeholderColor={theme.textOnSelection}
					focused
					flexGrow={1}
				/>
			) : (
				<text
					fg={selected ? theme.textOnSelection : theme.defaultForeground}
					flexGrow={1}
				>
					{truncatePrompt(item.prompt)}
				</text>
			)}
			{!editing && item.attachmentCount > 0 && (
				<text fg={selected ? theme.textOnSelection : "gray"} flexShrink={0}>
					{attachmentLabel(item.attachmentCount)}
				</text>
			)}
		</box>
	);
}
