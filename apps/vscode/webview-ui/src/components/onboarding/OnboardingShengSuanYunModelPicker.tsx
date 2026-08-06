import { shengSuanYunDefaultModelId, shengSuanYunDefaultModelInfo } from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import type { Mode } from "@shared/storage/types"
import { useEffect, useMemo, useState } from "react"
import { useMount } from "react-use"
import { Input } from "@/components/ui/input"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { getModeSpecificFields } from "../settings/utils/providerUtils"
import { useApiConfigurationHandlers } from "../settings/utils/useApiConfigurationHandlers"
import { ModelItem } from "./ModelItem"

type OnboardingShengSuanYunModelPickerProps = {
	currentMode: Mode
	/** Reports the effective selected model id (including the default fallback) up to the parent. */
	onSelectModel?: (modelId: string) => void
}

/** A self-contained model list for onboarding, kept separate from the settings picker. */
const OnboardingShengSuanYunModelPicker = ({ currentMode, onSelectModel }: OnboardingShengSuanYunModelPickerProps) => {
	const { apiConfiguration, setShengSuanYunModels, shengSuanYunModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const [searchTerm, setSearchTerm] = useState("")
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const selectedModelId = modeFields.shengSuanYunModelId || shengSuanYunDefaultModelId

	useEffect(() => {
		onSelectModel?.(selectedModelId)
	}, [selectedModelId, onSelectModel])

	useMount(() => {
		ModelsServiceClient.refreshShengSuanYunModels(EmptyRequest.create({}))
			.then((response) => {
				setShengSuanYunModels({
					[shengSuanYunDefaultModelId]: shengSuanYunDefaultModelInfo,
					...response.models,
				})
			})
			.catch((error: Error) => console.error("Failed to refresh ShengSuanYun models during onboarding:", error))
	})

	const modelIds = useMemo(() => {
		const query = searchTerm.trim().toLowerCase()
		return Object.keys(shengSuanYunModels)
			.sort((a, b) => a.localeCompare(b))
			.filter((id) => !query || id.toLowerCase().includes(query))
	}, [searchTerm, shengSuanYunModels])

	const selectModel = (modelId: string) => {
		handleModeFieldsChange(
			{
				shengSuanYunModelId: { plan: "planModeShengSuanYunModelId", act: "actModeShengSuanYunModelId" },
				shengSuanYunModelInfo: { plan: "planModeShengSuanYunModelInfo", act: "actModeShengSuanYunModelInfo" },
			},
			{
				shengSuanYunModelId: modelId,
				shengSuanYunModelInfo: shengSuanYunModels[modelId],
			},
			currentMode,
		)
	}

	return (
		<div className="flex w-full flex-col gap-3 px-2">
			<label className="text-sm font-bold text-foreground/70 uppercase" htmlFor="onboarding-ssy-model-search">
				胜算云实时模型
			</label>
			<Input
				id="onboarding-ssy-model-search"
				onChange={(event) => setSearchTerm(event.target.value)}
				placeholder="搜索模型..."
				type="search"
				value={searchTerm}
			/>
			<div className="flex-1 overflow-y-auto rounded-sm border border-input-foreground/30 bg-input-background/20 flex flex-col gap-3">
				{modelIds.length > 0 ? (
					modelIds.map((modelId) => {
						const isSelected = modelId === selectedModelId
						return (
							<ModelItem
								hidePrice={false}
								id={modelId}
								isSelected={isSelected}
								key={modelId}
								model={shengSuanYunModels[modelId]}
								onSelectModel={selectModel}
							/>
						)
					})
				) : (
					<p className="m-0 px-3 py-6 text-center text-sm text-foreground/60">未找到匹配的模型</p>
				)}
			</div>
			<p className="m-0 text-xs text-foreground/60">模型列表会自动从胜算云刷新。</p>
		</div>
	)
}

export default OnboardingShengSuanYunModelPicker
