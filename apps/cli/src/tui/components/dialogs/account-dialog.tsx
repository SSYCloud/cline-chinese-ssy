// @jsxImportSource @opentui/react
import type { ClineAccountOrganization } from "@cline/core";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type ClineAccountSnapshot,
	formatClineCredits,
	isClineAccountAuthErrorMessage,
} from "../../cline-account";
import { palette } from "../../palette";

export type AccountDialogAction =
	| "change-model"
	| "change-provider"
	| "learn-more"
	| "login";

type AccountView = "overview" | "organizations";

type AccountState =
	| { status: "loading"; message: string }
	| { status: "loaded"; snapshot: ClineAccountSnapshot }
	| { status: "unauthenticated"; message: string }
	| { status: "error"; message: string };

interface OrganizationRowData {
	id: string;
	organizationId: string | null;
	label: string;
	description: string;
	active: boolean;
}

interface AccountAction {
	id:
		| "change-model"
		| "change-account"
		| "change-provider"
		| "learn-more"
		| "login";
	label: string;
	description: string;
	enabled: boolean;
}

const LOADED_ACTIONS: AccountAction[] = [
	{
		id: "change-model",
		label: "切换模型",
		description: "打开 Cline 模型选择器",
		enabled: true,
	},
	{
		id: "change-account",
		label: "切换账户",
		description: "切换个人账户或组织",
		enabled: true,
	},
	{
		id: "change-provider",
		label: "切换提供商",
		description: "打开提供商选择器",
		enabled: true,
	},
];

const UNAUTHENTICATED_ACTIONS: AccountAction[] = [
	{
		id: "login",
		label: "登录或创建账户",
		description: "使用 Cline OAuth",
		enabled: true,
	},
	{
		id: "learn-more",
		label: "了解更多",
		description: "打开 cline.bot",
		enabled: true,
	},
];

function clampIndex(index: number, total: number): number {
	if (total <= 0) return 0;
	if (index < 0) return total - 1;
	if (index >= total) return 0;
	return index;
}

function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	if (Number.isNaN(date.getTime())) {
		return dateStr;
	}
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function userInitial(snapshot: ClineAccountSnapshot): string {
	const candidate =
		snapshot.user.displayName?.trim() || snapshot.user.email?.trim() || "?";
	return candidate.charAt(0).toUpperCase();
}

function AccountField(props: { label: string; value: string }) {
	return (
		<box flexDirection="row" overflow="hidden">
			<text fg="gray" width={16} flexShrink={0}>
				{props.label}
			</text>
			<text selectable>{props.value}</text>
		</box>
	);
}

function AccountActionRow(props: {
	action: AccountAction;
	selected: boolean;
	onSelect: () => void;
}) {
	const fg = props.selected ? palette.textOnSelection : undefined;
	return (
		<box
			flexDirection="row"
			gap={1}
			paddingX={1}
			height={1}
			justifyContent="space-between"
			backgroundColor={props.selected ? palette.selection : undefined}
			onMouseDown={props.onSelect}
			overflow="hidden"
		>
			<box flexDirection="row" gap={1} flexShrink={0}>
				<text
					fg={props.selected ? palette.textOnSelection : "gray"}
					flexShrink={0}
				>
					{props.selected ? ">" : " "}
				</text>
				<text fg={fg} flexShrink={0}>
					{props.action.label}
				</text>
			</box>
			<text
				fg={props.selected ? palette.textOnSelection : "gray"}
				flexShrink={1}
			>
				{props.action.description}
			</text>
		</box>
	);
}

function OrganizationRow(props: {
	label: string;
	description: string;
	active: boolean;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<box
			flexDirection="row"
			gap={1}
			paddingX={1}
			height={1}
			justifyContent="space-between"
			backgroundColor={props.selected ? palette.selection : undefined}
			onMouseDown={props.onSelect}
			overflow="hidden"
		>
			<box flexDirection="row" gap={1} flexShrink={0}>
				<text
					fg={props.selected ? palette.textOnSelection : "gray"}
					flexShrink={0}
				>
					{props.selected ? ">" : " "}
				</text>
				<text
					fg={props.selected ? palette.textOnSelection : undefined}
					flexShrink={0}
				>
					{props.label}
				</text>
			</box>
			<box flexDirection="row" gap={1} flexShrink={1}>
				<text fg={props.selected ? palette.textOnSelection : "gray"}>
					{props.description}
				</text>
				{props.active && (
					<text fg={props.selected ? palette.textOnSelection : palette.success}>
						Active
					</text>
				)}
			</box>
		</box>
	);
}

function accountActions(snapshot: ClineAccountSnapshot): AccountAction[] {
	return LOADED_ACTIONS.map((action) => {
		if (action.id !== "change-account") {
			return action;
		}
		return {
			...action,
			enabled:
				snapshot.organizations.length > 0 ||
				Boolean(snapshot.activeOrganization),
		};
	});
}

function organizationDescription(org: ClineAccountOrganization): string {
	const roles = org.roles.length > 0 ? org.roles.join(", ") : "member";
	return roles;
}

export function AccountDialogContent(
	props: ChoiceContext<AccountDialogAction> & {
		loadAccount: () => Promise<ClineAccountSnapshot>;
		switchAccount: (organizationId?: string | null) => Promise<void>;
		onAccountChange?: () => Promise<void>;
	},
) {
	const {
		dismiss,
		resolve,
		dialogId,
		loadAccount,
		switchAccount,
		onAccountChange,
	} = props;
	const [state, setState] = useState<AccountState>({
		status: "loading",
		message: "正在加载账户详情...",
	});
	const [view, setView] = useState<AccountView>("overview");
	const [selectedAction, setSelectedAction] = useState(0);
	const [selectedOrganization, setSelectedOrganization] = useState(0);
	const generation = useRef(0);

	const reload = useCallback(async () => {
		const currentGeneration = generation.current + 1;
		generation.current = currentGeneration;
		setState({ status: "loading", message: "正在加载账户详情..." });
		try {
			const snapshot = await loadAccount();
			if (generation.current === currentGeneration) {
				setState({ status: "loaded", snapshot });
				setSelectedAction(0);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (generation.current === currentGeneration) {
				setState({
					status: isClineAccountAuthErrorMessage(message)
						? "unauthenticated"
						: "error",
					message,
				});
				setSelectedAction(0);
			}
		}
	}, [loadAccount]);

	useEffect(() => {
		void reload();
	}, [reload]);

	const snapshot = state.status === "loaded" ? state.snapshot : undefined;
	const actions = useMemo(
		() =>
			snapshot
				? accountActions(snapshot)
				: state.status === "unauthenticated"
					? UNAUTHENTICATED_ACTIONS
					: LOADED_ACTIONS,
		[snapshot, state.status],
	);
	const orgRows = useMemo(() => {
		if (!snapshot) {
			return [];
		}
		return [
			{
				id: "personal",
				organizationId: null,
				label: "个人账户",
				description: snapshot.user.email,
				active: snapshot.activeOrganization === null,
			},
			...snapshot.organizations.map((org) => ({
				id: org.organizationId,
				organizationId: org.organizationId,
				label: org.name,
				description: organizationDescription(org),
				active: org.active,
			})),
		];
	}, [snapshot]);

	const switchToOrganization = useCallback(
		async (row: OrganizationRowData) => {
			setState({
				status: "loading",
				message: row.organizationId
					? `正在切换到 ${row.label}...`
					: "正在切换到个人账户...",
			});
			try {
				await switchAccount(row.organizationId);
				await onAccountChange?.();
				setView("overview");
				await reload();
			} catch (error) {
				setView("overview");
				setState({
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		},
		[onAccountChange, reload, switchAccount],
	);

	const runSelectedOrganization = useCallback(async () => {
		const row = orgRows[selectedOrganization];
		if (!row) return;
		await switchToOrganization(row);
	}, [orgRows, selectedOrganization, switchToOrganization]);

	const setActiveOrganizationSelection = useCallback(() => {
		const activeIndex = orgRows.findIndex((row) => row.active);
		setSelectedOrganization(activeIndex >= 0 ? activeIndex : 0);
	}, [orgRows]);

	const openOrganizationView = useCallback(() => {
		setView("organizations");
		setActiveOrganizationSelection();
	}, [setActiveOrganizationSelection]);

	const runAction = useCallback(
		(action: AccountAction) => {
			if (!action.enabled) return;
			if (action.id === "change-model") {
				resolve("change-model");
				return;
			}
			if (action.id === "login") {
				resolve("login");
				return;
			}
			if (action.id === "learn-more") {
				resolve("learn-more");
				return;
			}
			if (action.id === "change-provider") {
				resolve("change-provider");
				return;
			}
			if (action.id === "change-account") {
				openOrganizationView();
			}
		},
		[openOrganizationView, resolve],
	);

	const runSelectedAction = useCallback(() => {
		const action = actions[selectedAction];
		if (!action) return;
		runAction(action);
	}, [actions, runAction, selectedAction]);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			if (view === "organizations") {
				setView("overview");
				return;
			}
			dismiss();
			return;
		}
		if (state.status === "loading") {
			return;
		}
		if (state.status === "error") {
			return;
		}
		if (view === "organizations") {
			if (key.name === "up" || (key.ctrl && key.name === "p")) {
				setSelectedOrganization((index) =>
					clampIndex(index - 1, orgRows.length),
				);
				return;
			}
			if (key.name === "down" || (key.ctrl && key.name === "n")) {
				setSelectedOrganization((index) =>
					clampIndex(index + 1, orgRows.length),
				);
				return;
			}
			if (key.name === "return" || key.name === "enter") {
				void runSelectedOrganization();
			}
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			setSelectedAction((index) => clampIndex(index - 1, actions.length));
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			setSelectedAction((index) => clampIndex(index + 1, actions.length));
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			runSelectedAction();
		}
	}, dialogId);

	if (state.status === "loading") {
		return (
			<box flexDirection="column" paddingX={1} gap={1}>
				<text fg={palette.act}>Cline 账户</text>
				<text fg="gray">{state.message}</text>
				<text fg="gray">按 Esc 关闭</text>
			</box>
		);
	}

	if (state.status === "error") {
		return (
			<box flexDirection="column" paddingX={1} gap={1}>
				<text fg={palette.act}>Cline 账户</text>
				<text fg="red">{state.message}</text>
				<text fg="gray">按 Esc 关闭</text>
			</box>
		);
	}

	if (state.status === "unauthenticated") {
		return (
			<box flexDirection="column" paddingX={1} gap={1}>
				<text fg={palette.act}>Cline 账户</text>
				<text>登录或创建 Cline 账户。</text>
				<text fg="gray">
					定期免费促销和折扣，获取最新模型的使用权限。
				</text>

				<box flexDirection="column">
					{actions.map((action, index) => (
						<AccountActionRow
							key={action.id}
							action={action}
							selected={index === selectedAction}
							onSelect={() => {
								setSelectedAction(index);
								runAction(action);
							}}
						/>
					))}
				</box>

				<text fg="gray">↑/↓ 导航，Enter 选择，Esc 关闭</text>
			</box>
		);
	}

	if (view === "organizations") {
		return (
			<box flexDirection="column" paddingX={1}>
				<text fg={palette.act}>切换账户</text>
				<box flexDirection="column" gap={0}>
					{orgRows.map((row, index) => (
						<OrganizationRow
							key={row.id}
							label={row.label}
							description={row.description}
							active={row.active}
							selected={index === selectedOrganization}
							onSelect={() => {
								setSelectedOrganization(index);
								void switchToOrganization(row);
							}}
						/>
					))}
				</box>
				<text fg="gray">↑/↓ 导航，Enter 选择，Esc 返回</text>
			</box>
		);
	}

	const { snapshot: loaded } = state;
	const displayName =
		loaded.user.displayName?.trim() ||
		loaded.user.email?.trim() ||
		"Cline 用户";
	const activeAccount = loaded.activeOrganization?.name ?? "个人账户";

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg={palette.act}>Cline 账户</text>

			<box flexDirection="row" gap={2}>
				<box
					width={5}
					height={3}
					alignItems="center"
					justifyContent="center"
					border
					borderColor="gray"
				>
					<text fg={palette.act}>{userInitial(loaded)}</text>
				</box>
				<box flexDirection="column" flexGrow={1}>
					<text selectable>{displayName}</text>
					<text fg="gray" selectable>
						{loaded.user.email}
					</text>
					<text fg="gray">
						注册于 {formatDate(loaded.user.createdAt)}
					</text>
				</box>
			</box>

			<box flexDirection="column" border borderColor="gray" paddingX={1}>
				<AccountField label="当前账户" value={activeAccount} />
				<AccountField
					label="积分"
					value={formatClineCredits(loaded.displayedBalance)}
				/>
				{loaded.activeOrganization && (
					<AccountField
						label="个人"
						value={formatClineCredits(loaded.balance.balance)}
					/>
				)}
				<AccountField
					label="组织"
					value={String(loaded.organizations.length)}
				/>
			</box>

			<box flexDirection="column">
				{actions.map((action, index) => (
					<AccountActionRow
						key={action.id}
						action={action}
						selected={index === selectedAction}
						onSelect={() => {
							setSelectedAction(index);
							runAction(action);
						}}
					/>
				))}
			</box>

			<text fg="gray">↑/↓ 导航，Enter 选择，Esc 关闭</text>
		</box>
	);
}
