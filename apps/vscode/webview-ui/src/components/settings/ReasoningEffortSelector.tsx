import { isOpenaiReasoningEffort, Mode, OPENAI_REASONING_EFFORT_OPTIONS, OpenaiReasoningEffort } from "@shared/storage/types"
import { memo } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getModeSpecificFields } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

interface ReasoningEffortSelectorProps {
	currentMode: Mode
	label?: string
	description?: string
	allowedEfforts?: readonly OpenaiReasoningEffort[]
	defaultEffort?: OpenaiReasoningEffort
	/** Optional callback invoked after the effort value changes. Use to persist to provider-specific stores. */
	onEffortChange?: (effort: OpenaiReasoningEffort) => void
}

const ReasoningEffortSelector = ({
	currentMode,
	label = "推理强度",
	description = "更高的努力程度会提升思考深度，但会消耗更多 tokens。",
	allowedEfforts = OPENAI_REASONING_EFFORT_OPTIONS,
	defaultEffort = "medium",
	onEffortChange,
}: ReasoningEffortSelectorProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const selectedEffort =
		isOpenaiReasoningEffort(modeFields.reasoningEffort) && allowedEfforts.includes(modeFields.reasoningEffort)
			? modeFields.reasoningEffort
			: defaultEffort

	return (
		<div style={{ marginTop: 10, marginBottom: 5 }}>
			<Label className="text-xs font-medium">{label}</Label>
			<Select
				onValueChange={(value) => {
					handleModeFieldChange({ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" }, value, currentMode)
					if (onEffortChange && isOpenaiReasoningEffort(value)) {
						onEffortChange(value)
					}
				}}
				value={selectedEffort}>
				<SelectTrigger className="w-full mt-1">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{allowedEfforts.map((effort) => (
						<SelectItem key={effort} value={effort}>
							{
								(
									{ none: "无", low: "低", medium: "中", high: "高", xhigh: "极高" } as Record<
										OpenaiReasoningEffort,
										string
									>
								)[effort]
							}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					marginBottom: 0,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{description}
			</p>
		</div>
	)
}

export default memo(ReasoningEffortSelector)
