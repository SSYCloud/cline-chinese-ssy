import type { OpenRouterModelInfo, ShengSuanYunModelInfo } from "@shared/proto/cline/models"
import type { OnboardingModel } from "@shared/proto/cline/state"
import { ListIcon, ZapIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Item, ItemContent, ItemDescription, ItemHeader, ItemTitle } from "@/components/ui/item"
import { cn } from "@/lib/utils"
import { getCapabilities, getPriceRange, getSpeedLabel } from "./data-models"

interface ModelItemProps {
	id: string
	model: OnboardingModel | ShengSuanYunModelInfo | OpenRouterModelInfo
	isSelected: boolean
	hidePrice: boolean
	onSelectModel: (id: string) => void
}

function isOnboardingModel(model: OnboardingModel | ShengSuanYunModelInfo | OpenRouterModelInfo): model is OnboardingModel {
	return "info" in model
}

export const ModelItem = ({ id, model, isSelected, onSelectModel, hidePrice }: ModelItemProps) => {
	const onboardingModel = isOnboardingModel(model)
	const modelInfo = onboardingModel ? model.info : model
	const displayName = onboardingModel ? model.name || id : id
	const badge = onboardingModel ? model.badge : undefined
	const latency = onboardingModel ? model.latency : undefined
	const desc = onboardingModel ? "" : model.description
	const contextWindow = modelInfo?.contextWindow
	return (
		<Item
			className={cn("cursor-pointer hover:cursor-pointer", {
				"bg-input-background/80 border border-button-background": isSelected,
			})}
			onClick={() => onSelectModel(id)}
			variant="outline">
			<ItemHeader className="flex flex-col w-full align-baseline">
				<ItemTitle className="flex w-full justify-between">
					<span className="font-semibold">{displayName}</span>
					{badge ? (
						<Badge className="capitalize" variant="info">
							{badge}
						</Badge>
					) : !hidePrice && modelInfo ? (
						getPriceRange(modelInfo) == "免费" ? (
							<Badge>{getPriceRange(modelInfo)}</Badge>
						) : null
					) : null}
				</ItemTitle>
				{isSelected && modelInfo && (
					<>
						{desc == "" ? null : (
							<ItemDescription className="mt-3">
								<span className="text-foreground text-sm">{desc}</span>
							</ItemDescription>
						)}
						<ItemDescription>
							<span className="text-foreground/70 text-sm">支持: </span>
							<span className="text-foreground text-sm">{getCapabilities(modelInfo).join(", ")}</span>

							{modelInfo.contextWindow ? (
								<>
									<span className="text-foreground/70 text-sm ml-3">上下文: </span>
									<span className="text-foreground text-sm">{modelInfo.contextWindow / 1000}k</span>
								</>
							) : null}

							{modelInfo.maxTokens ? (
								<>
									<span className="text-foreground/70 text-sm ml-3">最大输出: </span>
									<span className="text-foreground text-sm">{modelInfo.maxTokens / 1000}k</span>
								</>
							) : null}
						</ItemDescription>
					</>
				)}
			</ItemHeader>
			{badge && isSelected && (
				<ItemContent className="w-full border-t border-muted-foreground pt-5 text-ellipsis overflow-hidden">
					<div className="flex flex-col gap-3">
						<div className="inline-flex gap-1 [&_svg]:stroke-success [&_svg]:size-3 items-center text-sm">
							<ZapIcon />
							<span>速度: </span>
							<span className="text-foreground/70">{getSpeedLabel(latency)}</span>
						</div>
						{modelInfo && (
							<div className="flex w-full justify-between">
								<div className="inline-flex gap-1 [&_svg]:stroke-foreground [&_svg]:size-3 items-center text-sm">
									<ListIcon />
									<span>上下文: </span>
									<span className="text-foreground/70">{(contextWindow ?? 0) / 1000}k</span>
								</div>
								{!hidePrice && <Badge>{getPriceRange(modelInfo)}</Badge>}
							</div>
						)}
					</div>
				</ItemContent>
			)}
		</Item>
	)
}
