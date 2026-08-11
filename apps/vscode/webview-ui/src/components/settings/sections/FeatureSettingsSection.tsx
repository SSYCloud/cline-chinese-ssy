import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { memo, type ReactNode } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

// Reusable checkbox component for feature settings
interface FeatureCheckboxProps {
	checked: boolean | undefined
	onChange: (checked: boolean) => void
	label: string
	description: ReactNode
	disabled?: boolean
	isRemoteLocked?: boolean
	remoteTooltip?: string
	isVisible?: boolean
}

// Interface for feature toggle configuration
interface FeatureToggle {
	id: string
	label: string
	description: ReactNode
	settingKey: keyof UpdateSettingsRequest
	stateKey: string
}

const agentFeatures: FeatureToggle[] = [
	{
		id: "auto-compact",
		label: "自动压缩",
		description: "自动压缩对话历史。",
		stateKey: "useAutoCondense",
		settingKey: "useAutoCondense",
	},
]

const editorFeatures: FeatureToggle[] = [
	{
		id: "show-feature-tips",
		label: "功能提示",
		description: "在思考阶段轮换显示提示，帮助你发现 Cline 功能。",
		stateKey: "showFeatureTips",
		settingKey: "showFeatureTips",
	},
	{
		id: "background-edit",
		label: "后台编辑",
		description: "允许在不抢占编辑器焦点的情况下进行编辑",
		stateKey: "backgroundEditEnabled",
		settingKey: "backgroundEditEnabled",
	},
	{
		id: "checkpoints",
		label: "检查点",
		description: "在关键节点保存进度，便于回滚",
		stateKey: "enableCheckpointsSetting",
		settingKey: "enableCheckpointsSetting",
	},
	{
		id: "worktrees",
		label: "工作树",
		description: "启用 git worktree 管理，以并行运行 Cline 任务。",
		stateKey: "worktreesEnabled",
		settingKey: "worktreesEnabled",
	},
]

const advancedFeatures: FeatureToggle[] = [
	{
		id: "hooks",
		label: "钩子",
		description: "在任务执行期间启用生命周期和工具 hooks。",
		stateKey: "hooksEnabled",
		settingKey: "hooksEnabled",
	},
]

const FeatureRow = memo(
	({
		checked = false,
		onChange,
		label,
		description,
		disabled,
		isRemoteLocked,
		isVisible = true,
		remoteTooltip,
	}: FeatureCheckboxProps) => {
		if (!isVisible) {
			return null
		}

		const checkbox = (
			<div className="flex items-center justify-between w-full">
				<div>{label}</div>
				<div>
					<Switch
						checked={checked}
						className="shrink-0"
						disabled={disabled || isRemoteLocked}
						id={label}
						onCheckedChange={onChange}
						size="lg"
					/>
					{isRemoteLocked && <i className="codicon codicon-lock text-description text-sm" />}
				</div>
			</div>
		)

		return (
			<div className="flex flex-col items-start justify-between gap-4 py-3 w-full">
				<div className="space-y-0.5 flex-1 w-full">
					{isRemoteLocked ? (
						<Tooltip>
							<TooltipTrigger asChild>{checkbox}</TooltipTrigger>
							<TooltipContent className="max-w-xs" side="top">
								{remoteTooltip}
							</TooltipContent>
						</Tooltip>
					) : (
						checkbox
					)}
				</div>
				<div className="text-xs text-description">{description}</div>
			</div>
		)
	},
)

interface FeatureSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const FeatureSettingsSection = ({ renderSectionHeader }: FeatureSettingsSectionProps) => {
	const {
		enableCheckpointsSetting,
		hooksEnabled,
		mcpDisplayMode,
		useAutoCondense,
		compactionStrategy,
		subagentsEnabled,
		worktreesEnabled,
		backgroundEditEnabled,
		showFeatureTips,
	} = useExtensionState()

	// State lookup for mapped features
	const featureState: Record<string, boolean | undefined> = {
		showFeatureTips,
		enableCheckpointsSetting,
		hooksEnabled,
		useAutoCondense,
		subagentsEnabled,
		worktreesEnabled: worktreesEnabled?.user,
		backgroundEditEnabled,
	}

	// Visibility lookup for features with feature flags
	const featureVisibility: Record<string, boolean | undefined> = {
		worktreesEnabled: worktreesEnabled?.featureFlag,
	}

	return (
		<div className="mb-2">
			{renderSectionHeader("features")}
			<Section>
				<div className="mb-5 flex flex-col gap-3">
					{/* Core features */}
					<div>
						<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">智能体</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50"
							id="agent-features">
							{agentFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => updateSetting(feature.settingKey, checked)}
								/>
							))}
							<div className="space-y-2 py-3">
								<Label className="text-sm font-medium text-foreground">自动压缩策略</Label>
								<p className="text-xs text-muted-foreground">控制自动压缩如何改写上下文。</p>
								<Select
									disabled={!useAutoCondense}
									onValueChange={(value) => updateSetting("compactionStrategy", value)}
									value={compactionStrategy ?? "agentic"}>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="basic">基础</SelectItem>
										<SelectItem value="agentic">智能体</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
					</div>

					{/* Editor features */}
					<div>
						<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">编辑器</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50"
							id="optional-features">
							{editorFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => updateSetting(feature.settingKey, checked)}
								/>
							))}
						</div>
					</div>
				</div>

				{/* Advanced */}
				<div>
					<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">高级</div>
					<div className="relative p-3 my-3 rounded-md border border-editor-widget-border/50" id="advanced-features">
						<div className="space-y-3">
							{advancedFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => updateSetting(feature.settingKey, checked)}
								/>
							))}

							{/* MCP Display Mode */}
							<div className="space-y-2">
								<Label className="text-sm font-medium text-foreground">MCP 显示模式</Label>
								<p className="text-xs text-muted-foreground">控制 MCP 响应的显示方式</p>
								<Select onValueChange={(v) => updateSetting("mcpDisplayMode", v)} value={mcpDisplayMode}>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="plain">纯文本</SelectItem>
										<SelectItem value="rich">富文本显示</SelectItem>
										<SelectItem value="markdown">Markdown</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
export default memo(FeatureSettingsSection)
