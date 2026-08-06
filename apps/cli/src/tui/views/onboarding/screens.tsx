import "opentui-spinner/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import {
	CODEX_CLI_INSTALL_URL,
	type CodexCliStatus,
} from "../../../utils/codex-cli";
import {
	ClineModelPicker,
	type ClineModelPickerEntry,
} from "../../components/model-selector/cline-model-picker";
import {
	type SearchableItem,
	SearchableList,
	type SearchableListState,
} from "../../components/searchable-list";
import {
	TrackedRobot,
	type useMouseTracker,
} from "../../components/tracked-robot";
import { useTheme } from "../../hooks/use-theme";
import { getInputRuleColor, getUserMessageBackground } from "../../palette";
import { FIELD_ORDER } from "./fields";
import {
	type ClinePassSubscriptionOption,
	type ClinePassSubscriptionStatus,
	type MenuOption,
	THINKING_LEVELS,
} from "./model";

type MouseTrackerState = ReturnType<typeof useMouseTracker>;

function useDefaultFg(): string | undefined {
	return useTheme().defaultForeground;
}

/**
 * Theme-derived colors for the onboarding surface. The subtle border/detail
 * tones used to be fixed dark grays (#333333 / #555555), which disappear on
 * light or tinted theme backgrounds; they now lift from the theme background.
 */
function useOnboardingColors() {
	const theme = useTheme();
	return {
		accent: theme.accents.act,
		success: theme.accents.success,
		selection: theme.selection,
		textOnSelection: theme.textOnSelection,
		subtleBorder: getUserMessageBackground(theme.background),
		mutedDetail: getInputRuleColor(theme.background),
	};
}

function getClinePassSubscriptionOptionId(index: number): string {
	return `cline-pass-subscription-option-${index}`;
}

interface OnboardingFrameProps {
	children: ReactNode;
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
}

function OnboardingFrame({
	children,
	compact,
	contentWidth,
	mouse,
}: OnboardingFrameProps) {
	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
			onMouseMove={mouse.onMouseMove}
		>
			{!compact && (
				<TrackedRobot cursorX={mouse.cursor.x} cursorY={mouse.cursor.y} />
			)}
			<box
				flexDirection="column"
				width={contentWidth}
				marginTop={compact ? 0 : 1}
				gap={1}
			>
				{children}
			</box>
		</box>
	);
}

export function OnboardingDoneScreen(props: { mouse: MouseTrackerState }) {
	const colors = useOnboardingColors();
	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
			onMouseMove={props.mouse.onMouseMove}
		>
			<text fg={colors.success}>{"\u2714"} \u4e00\u5207\u5c31\u7eea\uff01</text>
		</box>
	);
}

export function OnboardingOAuthPendingScreen(props: {
	authError: string;
	authStatus: string;
	authUrl: string;
	compact: boolean;
	contentWidth: number;
	label: string;
	mouse: MouseTrackerState;
	oauthProvider: string;
}) {
	const defaultFg = useDefaultFg();
	const colors = useOnboardingColors();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<box flexDirection="column" alignItems="center" gap={1}>
				<text fg={defaultFg}>正在使用 {props.label} 登录</text>

				{!props.authError && (
					<box flexDirection="row" gap={1} justifyContent="center">
						<spinner name="dots" color={colors.accent} />
						<text fg="gray">{props.authStatus}</text>
					</box>
				)}

				{props.authError && (
					<box flexDirection="column" alignItems="center" gap={1}>
						<text fg="red">{props.authError}</text>
						<text fg="gray">按 Esc 返回</text>
					</box>
				)}

				{props.authUrl && !props.authError && (
					<box
						flexDirection="column"
						border
						borderStyle="rounded"
						borderColor={colors.subtleBorder}
						paddingX={2}
						paddingY={1}
						width={props.contentWidth}
					>
						<text fg="gray">如果浏览器没有打开：</text>
						<text fg={colors.accent} marginTop={1} selectable>
							<a href={props.authUrl}>{props.authUrl}</a>
						</text>
					</box>
				)}

				<text fg="gray">
					<em>按 Esc 取消，Ctrl+C 退出</em>
				</text>
			</box>
		</OnboardingFrame>
	);
}

export function OnboardingDeviceCodeScreen(props: {
	compact: boolean;
	contentWidth: number;
	deviceError: string;
	deviceStatus: string;
	deviceUserCode: string;
	deviceVerifyUrl: string;
	label: string;
	mouse: MouseTrackerState;
}) {
	const defaultFg = useDefaultFg();
	const colors = useOnboardingColors();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<box flexDirection="column" alignItems="center" gap={1}>
				<text fg={defaultFg}>正在使用 {props.label} 登录</text>

				{!props.deviceUserCode && !props.deviceError && (
					<box flexDirection="row" gap={1} justifyContent="center">
						<spinner name="dots" color={colors.accent} />
						<text fg="gray">{props.deviceStatus}</text>
					</box>
				)}

				{props.deviceError && (
					<box flexDirection="column" alignItems="center" gap={1}>
						<text fg="red">{props.deviceError}</text>
						<text fg="gray">按 Esc 返回</text>
					</box>
				)}

				{props.deviceUserCode && !props.deviceError && (
					<box
						flexDirection="column"
						border
						borderStyle="rounded"
						borderColor={colors.accent}
						paddingX={2}
						paddingY={1}
						width={props.contentWidth}
						alignItems="center"
						gap={1}
					>
						<text fg="gray">你的代码：</text>
						<text fg={defaultFg} selectable>
							<strong>{props.deviceUserCode}</strong>
						</text>
						<text fg="gray" marginTop={1}>
							访问此网址并输入上面的代码：
						</text>
						<text fg={colors.accent} selectable>
							<a href={props.deviceVerifyUrl}>{props.deviceVerifyUrl}</a>
						</text>
					</box>
				)}

				{props.deviceUserCode && !props.deviceError && (
					<box flexDirection="row" gap={1} justifyContent="center">
						<spinner name="dots" color={colors.accent} />
						<text fg="gray">正在等待登录...</text>
					</box>
				)}

				<text fg="gray">
					<em>按 Esc 取消，Ctrl+C 退出</em>
				</text>
			</box>
		</OnboardingFrame>
	);
}

import type {
	ProviderConfigFieldKey,
	ProviderConfigFieldRequirement,
} from "@cline/core";

const DEFAULT_FIELD_LABELS: Partial<Record<ProviderConfigFieldKey, string>> = {
	apiKey: "API 密钥",
	baseUrl: "Base URL",
	azureApiVersion: "Azure API Version",
	awsRegion: "AWS Region",
	awsProfile: "AWS Profile Name",
	sapClientId: "客户端 ID",
	sapClientSecret: "客户端密钥",
	sapTokenUrl: "Token URL",
	sapResourceGroup: "资源组",
	sapDeploymentId: "部署 ID",
};

const DEFAULT_FIELD_PLACEHOLDERS: Partial<
	Record<ProviderConfigFieldKey, string>
> = {
	apiKey: "在此粘贴你的 API 密钥...",
	baseUrl: "",
	azureApiVersion: "2025-01-01-preview",
	awsRegion: "us-east-1",
	awsProfile: "default",
	sapClientId: "sb-...|xsuaa_std!b...",
	sapClientSecret: "SAP AI Core 客户端密钥",
	sapTokenUrl: "https://<subdomain>.authentication.sap.hana.ondemand.com",
	sapResourceGroup: "default",
	sapDeploymentId: "",
};

export function OnboardingProviderConfigScreen(props: {
	activeProviderName: string;
	compact: boolean;
	contentWidth: number;
	description?: string;
	fields: Partial<
		Record<ProviderConfigFieldKey, ProviderConfigFieldRequirement>
	>;
	focusedField: ProviderConfigFieldKey;
	mouse: MouseTrackerState;
	values: Partial<Record<ProviderConfigFieldKey, string>>;
	onFieldInput: (field: ProviderConfigFieldKey, value: string) => void;
	onSubmit: () => void;
}) {
	const defaultFg = useDefaultFg();
	const colors = useOnboardingColors();
	const visibleFields = FIELD_ORDER.filter(
		(key) => props.fields[key] !== undefined,
	);

	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<box flexDirection="column" gap={1} alignItems="center">
				<text fg={defaultFg}>{props.activeProviderName}</text>

				{props.description && <text fg="gray">{props.description}</text>}

				{visibleFields.map((key) => {
					const requirement = props.fields[key];
					if (!requirement) return null;
					const label = requirement.label ?? DEFAULT_FIELD_LABELS[key] ?? key;
					const placeholder =
						requirement.placeholder ??
						(key === "baseUrl" && requirement.defaultValue
							? requirement.defaultValue
							: (DEFAULT_FIELD_PLACEHOLDERS[key] ?? ""));
					const value = props.values[key] ?? "";
					const isFocused = props.focusedField === key;
					return (
						<box
							key={key}
							flexDirection="column"
							gap={0}
							width={props.contentWidth}
						>
							<text fg="gray">{label}</text>
							{requirement.note && <text fg="gray">{requirement.note}</text>}
							<box
								border
								borderStyle="rounded"
								borderColor={isFocused ? colors.accent : "gray"}
								paddingX={1}
							>
								<input
									value={value}
									onInput={(v: string) => props.onFieldInput(key, v)}
									onSubmit={props.onSubmit}
									placeholder={placeholder}
									textColor={defaultFg}
									focusedTextColor={defaultFg}
									cursorColor={defaultFg}
									focused={isFocused}
									flexGrow={1}
								/>
							</box>
						</box>
					);
				})}

				<text fg="gray">
					<em>
						{visibleFields.length > 1
							? "按 Tab 切换字段，按 Enter 保存，按 Esc 返回，Ctrl+C 退出"
							: "按 Enter 保存，按 Esc 返回，Ctrl+C 退出"}
					</em>
				</text>
			</box>
		</OnboardingFrame>
	);
}

export function OnboardingCodexCliScreen(props: {
	activeProviderName: string;
	checking: boolean;
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
	status?: CodexCliStatus;
}) {
	const defaultFg = useDefaultFg();
	const colors = useOnboardingColors();
	const installedStatus =
		props.status?.installed === true ? props.status : undefined;
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<box flexDirection="column" gap={1} alignItems="center">
				<text fg={defaultFg}>{props.activeProviderName}</text>

				{props.checking && (
					<box flexDirection="row" gap={1}>
						<spinner name="dots" color="gray" />
						<text fg="gray">\u6b63\u5728\u68c0\u67e5 Codex CLI...</text>
					</box>
				)}

				{installedStatus && (
					<box flexDirection="column" gap={1} alignItems="center">
						<text fg={colors.success}>{"\u25cf"} Codex CLI \u5df2\u5b89\u88c5</text>
						<text fg="gray">{installedStatus.version}</text>
					</box>
				)}

				{props.status && !props.status.installed && (
					<box flexDirection="column" gap={1} width={props.contentWidth}>
						<text fg="yellow">未找到 Codex CLI</text>
						<text fg="gray">{props.status.reason}</text>
						<text fg="gray">从此处安装 Codex CLI：</text>
						<text fg={colors.accent} selectable>
							{CODEX_CLI_INSTALL_URL}
						</text>
					</box>
				)}

				<text fg="gray">
					<em>
						{installedStatus
							? "按 Enter 继续，按 R 重新检查，按 Esc 返回，Ctrl+C 退出"
							: "按 R 重新检查，按 Esc 返回，Ctrl+C 退出"}
					</em>
				</text>
			</box>
		</OnboardingFrame>
	);
}

export function OnboardingProviderPickerScreen(props: {
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
	providerList: SearchableListState;
	providersLoading: boolean;
}) {
	const defaultFg = useDefaultFg();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text fg={defaultFg} paddingX={1}>
				选择提供商
			</text>

			{props.providersLoading ? (
				<box flexDirection="row" gap={1} paddingX={1}>
					<spinner name="dots" color="gray" />
					<text fg="gray">正在加载提供商...</text>
				</box>
			) : (
				<SearchableList
					items={props.providerList.filtered}
					selected={props.providerList.safeSelected}
					onSearchChange={props.providerList.setSearch}
					placeholder="搜索提供商..."
					emptyText="没有匹配的提供商"
				/>
			)}

			<text fg="gray" paddingX={1}>
				<em>
					输入搜索，↑/↓ 导航，按 Enter 选择，按 Esc 返回，Ctrl+C
					退出
				</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingClineModelScreen(props: {
	clineEntries: ClineModelPickerEntry[];
	clineModelSelected: number;
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
	recommendedLoading: boolean;
}) {
	const defaultFg = useDefaultFg();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text fg={defaultFg} paddingX={1}>
				<strong>选择模型</strong>
			</text>
			<text fg="gray" paddingX={1}>
				你可以随时更改
			</text>

			<ClineModelPicker
				entries={props.clineEntries}
				selected={props.clineModelSelected}
				loading={props.recommendedLoading}
			/>

			<text fg="gray" paddingX={1}>
				<em>↑/↓ 导航，按 Enter 选择，按 Esc 返回，Ctrl+C 退出</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingClinePassSubscriptionScreen(props: {
	compact: boolean;
	contentWidth: number;
	currentPlanName: string;
	error: string;
	mouse: MouseTrackerState;
	openStatus: string;
	options: ClinePassSubscriptionOption[];
	planFeatures: string[];
	selected: number;
	status: ClinePassSubscriptionStatus;
	subscriptionUrl: string;
}) {
	const defaultFg = useDefaultFg();
	const planAccent = useTheme().accents.plan;
	const colors = useOnboardingColors();
	const scrollRef = useRef<ScrollBoxRenderable | null>(null);
	const isLoading = props.status === "loading";
	const isSubscribed = props.status === "subscribed";
	const isError = props.status === "error";
	const bodyHeight = props.compact ? 17 : 19;

	useEffect(() => {
		if (isSubscribed) {
			return;
		}
		const scrollSelectedOptionIntoView = () => {
			scrollRef.current?.scrollChildIntoView(
				getClinePassSubscriptionOptionId(props.selected),
			);
		};
		scrollSelectedOptionIntoView();
		queueMicrotask(scrollSelectedOptionIntoView);
		const timeout = setTimeout(scrollSelectedOptionIntoView, 0);
		return () => clearTimeout(timeout);
	}, [isSubscribed, props.selected]);

	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<box
				flexDirection="column"
				border
				borderStyle="rounded"
				borderColor={isSubscribed ? colors.success : planAccent}
				paddingX={1}
				paddingY={1}
				height={bodyHeight}
				overflow="hidden"
			>
				<scrollbox
					ref={scrollRef}
					width="100%"
					height="100%"
					scrollY
					scrollX={false}
					viewportOptions={{ overflow: "hidden" }}
					contentOptions={{ flexDirection: "column" }}
				>
					<box flexDirection="column" width="100%" flexShrink={0}>
						<text
							fg={isSubscribed ? colors.success : planAccent}
							flexShrink={0}
						>
							{isSubscribed
								? "ClinePass 订阅已激活"
								: "需要 ClinePass 订阅"}
						</text>

						{isLoading ? (
							<box flexDirection="row" gap={1} flexShrink={0}>
								<spinner name="dots" color="gray" />
								<text fg="gray">正在检查你的 ClinePass 订阅...</text>
							</box>
						) : isSubscribed ? (
							<text fg={defaultFg} selectable flexShrink={0}>
								当前套餐：{props.currentPlanName || "ClinePass"}
							</text>
						) : isError ? (
							<text
								fg={defaultFg}
								selectable
								flexShrink={0}
								content="无法验证你的 ClinePass 订阅。选择 ClinePass 模型前请重新检查。"
							/>
						) : (
							<text
								fg={defaultFg}
								selectable
								flexShrink={0}
								content="尚无法使用 ClinePass 订阅模型。订阅 ClinePass，这是低成本的开放权重模型编程套餐。"
							/>
						)}

						{props.status === "error" &&
							props.error &&
							props.error !== "no plan found for user" && (
								<text fg="red" selectable flexShrink={0}>
									{props.error}
								</text>
							)}

						{!isSubscribed && props.planFeatures.length > 0 && (
							<box flexDirection="column" marginTop={1} flexShrink={0}>
								{props.planFeatures.map((feature) => {
									if (
										feature === "Low cost subscription pricing" ||
										feature === "Generous limits and reliable access" ||
										feature === "Built for as many programmers as possible"
									) {
										return null;
									}

									return (
										<text
											key={feature}
											fg={defaultFg}
											selectable
											flexShrink={0}
										>
											<span fg="green">✓ </span>
											<span>{feature}</span>
										</text>
									);
								})}
							</box>
						)}

						{!isSubscribed && (
							<box flexDirection="column" marginTop={1} flexShrink={0}>
								{props.options.map((option, i) => {
									const isSel = i === props.selected;
									return (
										<box
											id={getClinePassSubscriptionOptionId(i)}
											key={option.value}
											paddingX={1}
											flexDirection="row"
											gap={1}
											backgroundColor={isSel ? colors.selection : undefined}
											height={1}
											flexShrink={0}
											overflow="hidden"
										>
											<text
												fg={isSel ? colors.textOnSelection : "gray"}
												flexShrink={0}
											>
												{isSel ? "\u276f" : " "}
											</text>
											<text
												fg={isSel ? colors.textOnSelection : defaultFg}
												flexShrink={0}
											>
												{option.label}
											</text>
										</box>
									);
								})}
							</box>
						)}

						{props.openStatus && (
							<text fg="gray" selectable flexShrink={0}>
								{props.openStatus}
							</text>
						)}

						{!isSubscribed && (
							<box flexDirection="column" marginTop={1} flexShrink={0}>
								<text fg="gray" flexShrink={0}>
									如果浏览器按钮不起作用：
								</text>
								<text fg={colors.accent} selectable flexShrink={0}>
									<a href={props.subscriptionUrl}>{props.subscriptionUrl}</a>
								</text>
							</box>
						)}
					</box>
				</scrollbox>
			</box>

			<text fg="gray" paddingX={1}>
				<em>↑/↓ 导航，按 Enter 选择，按 Esc 返回，Ctrl+C 退出</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingModelPickerScreen(props: {
	activeProviderName: string;
	compact: boolean;
	contentWidth: number;
	modelList: SearchableListState;
	modelsLoading: boolean;
	mouse: MouseTrackerState;
	onModelItemSelect: (item: SearchableItem) => void;
}) {
	const defaultFg = useDefaultFg();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text fg={defaultFg} paddingX={1}>
				<strong>为 {props.activeProviderName} 选择模型</strong>
			</text>
			<text fg="gray" paddingX={1}>
				你可以随时更改
			</text>

			{props.modelsLoading ? (
				<box flexDirection="row" gap={1} paddingX={1}>
					<spinner name="dots" color="gray" />
					<text fg="gray">正在加载模型...</text>
				</box>
			) : (
				<SearchableList
					items={props.modelList.filtered}
					selected={props.modelList.safeSelected}
					onSearchChange={props.modelList.setSearch}
					onItemSelect={props.onModelItemSelect}
					placeholder="搜索模型..."
					emptyText="创建自定义模型 ID 以手动输入"
				/>
			)}

			<text fg="gray" paddingX={1}>
				<em>
					输入搜索，↑/↓ 导航，按 Enter 选择，按 Esc 返回，Ctrl+C
					退出
				</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingCustomModelIdScreen(props: {
	activeProviderName: string;
	compact: boolean;
	contentWidth: number;
	error: string;
	mouse: MouseTrackerState;
	onInput: (value: string) => void;
	onSubmit: () => void;
	title: string;
	value: string;
}) {
	const defaultFg = useDefaultFg();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text fg={defaultFg} paddingX={1}>
				{props.title}
			</text>
			<text fg="gray" paddingX={1}>
				{props.activeProviderName}
			</text>

			<box flexDirection="column" gap={0} paddingX={1}>
				<text fg="gray">模型 ID</text>
				<box
					border
					borderStyle="rounded"
					borderColor={props.error ? "red" : "gray"}
					paddingX={1}
				>
					<input
						value={props.value}
						onInput={props.onInput}
						onSubmit={props.onSubmit}
						placeholder=""
						textColor={defaultFg}
						focusedTextColor={defaultFg}
						cursorColor={defaultFg}
						flexGrow={1}
						focused
					/>
				</box>
				{props.error && <text fg="red">{props.error}</text>}
			</box>

			<text fg="gray" paddingX={1}>
				<em>
					按 Enter 创建，按 Esc 返回模型选择，Ctrl+C 退出
				</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingThinkingLevelScreen(props: {
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
	selectedModelName: string;
	thinkingSelected: number;
}) {
	const defaultFg = useDefaultFg();
	const colors = useOnboardingColors();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text fg={defaultFg} paddingX={1}>
				为 {props.selectedModelName} 设置思考级别
				</text>
				<text fg="gray" paddingX={1}>
					扩展思考让模型能够推理复杂问题
				</text>

			<box flexDirection="column">
				{THINKING_LEVELS.map((level, i) => {
					const isSel = i === props.thinkingSelected;
					return (
						<box
							key={level.value}
							paddingX={1}
							flexDirection="row"
							gap={1}
							backgroundColor={isSel ? colors.selection : undefined}
							height={1}
						>
							<text fg={isSel ? colors.textOnSelection : "gray"} flexShrink={0}>
								{isSel ? "\u276f" : " "}
							</text>
							<text fg={isSel ? colors.textOnSelection : defaultFg}>
								{level.label}
							</text>
							<text fg={isSel ? colors.textOnSelection : "gray"}>
								{level.desc}
							</text>
						</box>
					);
				})}
			</box>

			<text fg="gray" paddingX={1}>
				<em>↑/↓ 导航，按 Enter 选择，按 Esc 返回，Ctrl+C 退出</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingMainMenuScreen(props: {
	contentWidth: number;
	menuOptions: MenuOption[];
	menuSelected: number;
	mouse: MouseTrackerState;
}) {
	const defaultFg = useDefaultFg();
	const colors = useOnboardingColors();
	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
			onMouseMove={props.mouse.onMouseMove}
		>
			<TrackedRobot
				cursorX={props.mouse.cursor.x}
				cursorY={props.mouse.cursor.y}
			/>

			<box
				flexDirection="column"
				width={props.contentWidth}
				alignItems="center"
				marginTop={1}
			>
				<text fg={defaultFg}>
					<strong>欢迎使用 Cline</strong>
				</text>
				<text fg="gray" marginTop={1}>
					连接一个模型提供商即可开始。
				</text>
			</box>

			<box
				flexDirection="column"
				width={props.contentWidth}
				marginTop={1}
				gap={0}
			>
				{props.menuOptions.map((option, i) => {
					const isSel = i === props.menuSelected;
					return (
						<box
							key={option.value}
							flexDirection="row"
							border
							borderStyle="rounded"
							borderColor={isSel ? colors.accent : colors.subtleBorder}
							paddingX={1}
							gap={1}
							alignItems="center"
						>
							<text
								fg={isSel ? colors.accent : colors.mutedDetail}
								flexShrink={0}
							>
								{option.icon}
							</text>
							<box flexDirection="column" flexGrow={1}>
								<text fg={isSel ? defaultFg : "gray"}>{option.label}</text>
								<text fg={isSel ? "gray" : colors.mutedDetail}>
									{option.detail}
								</text>
							</box>
							{isSel && (
								<text fg={colors.accent} flexShrink={0}>
									{"\u2192"}
								</text>
							)}
						</box>
					);
				})}
			</box>

			<text fg="gray" marginTop={1}>
				<em>↑/↓ 导航，按 Enter 选择，Ctrl+C 退出</em>
			</text>
		</box>
	);
}
