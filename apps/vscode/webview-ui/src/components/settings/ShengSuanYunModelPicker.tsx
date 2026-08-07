import { shengSuanYunDefaultModelId, shengSuanYunDefaultModelInfo } from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import styled from "styled-components"
import { useDynamicProviderSelection } from "@/hooks/useDynamicProviderSelection"
import { ModelsServiceClient } from "@/services/grpc-client"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ModelInfoView } from "./common/ModelInfoView"
import FeaturedModelCard from "./FeaturedModelCard"
import { getModeSpecificFields } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

export interface ShengSuanYunModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}
// Star icon for favorites
const StarIcon = ({ isFavorite, onClick }: { isFavorite: boolean; onClick: (e: React.MouseEvent) => void }) => {
	return (
		<div
			onClick={onClick}
			style={{
				cursor: "pointer",
				color: isFavorite ? "var(--vscode-terminal-ansiBlue)" : "var(--vscode-descriptionForeground)",
				marginLeft: "8px",
				fontSize: "16px",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				userSelect: "none",
				WebkitUserSelect: "none",
			}}>
			{isFavorite ? "★" : "☆"}
		</div>
	)
}

export const recommendedModels = [
	{
		id: "anthropic/claude-opus-5",
		name: "",
		description: "opus系列性能飞跃", // gitleaks:allow
		label: "NEW",
	},
	{
		id: "bigmodel/glm-5.2",
		name: "",
		description: "国产编程性价比",
		label: "NEW",
	},
	{
		id: "anthropic/claude-fable-5",
		name: "",
		description: "Anthropic当下最强模型",
		label: "NEW",
	},
	{
		id: "openai/gpt-5.6-sol",
		name: "",
		description: "编程排行当下第一",
		label: "NEW",
	},
	{
		id: "moonshotai/kimi-k3",
		name: "",
		description: "国产最强开源编码模型",
		label: "NEW",
	},
]

export const freeModels = [
	{
		id: "xiaomi/mimo-v2-flash",
		name: "",
		description: "MiMo V2 Flash (Free)",
		label: "免费",
	},
]

const ShengSuanYunModelPicker: React.FC<ShengSuanYunModelPickerProps> = ({ isPopup, currentMode, initialModelTab }) => {
	const { apiConfiguration, shengSuanYunModels, setShengSuanYunModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.shengSuanYunModelId || shengSuanYunDefaultModelId)
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)
	const [activeTab, setActiveTab] = useState<"recommended" | "free">("recommended")

	const handleModelChange = (newModelId: string) => {
		// could be setting invalid model id/undefined info but validation will catch it
		handleModeFieldsChange(
			{
				shengSuanYunModelId: { plan: "planModeShengSuanYunModelId", act: "actModeShengSuanYunModelId" },
				shengSuanYunModelInfo: { plan: "planModeShengSuanYunModelInfo", act: "actModeShengSuanYunModelInfo" },
			},
			{
				shengSuanYunModelId: newModelId,
				shengSuanYunModelInfo: shengSuanYunModels[newModelId],
			},
			currentMode,
		)
		setSearchTerm(newModelId)
	}
	const { selectedModelId, selectedModelInfo } = useDynamicProviderSelection("shengsuanyun", apiConfiguration, currentMode)

	useMount(() => {
		ModelsServiceClient.refreshShengSuanYunModels(EmptyRequest.create({}))
			.then((res) => {
				console.log("refreshShengSuanYunModels():", res.models)
				setShengSuanYunModels({
					[shengSuanYunDefaultModelId]: shengSuanYunDefaultModelInfo,
					...res.models,
				})
			})
			.catch((error: Error) => console.error("Failed to refresh ShengSuanYun models:", error))
	})

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [])

	const modelIds = useMemo(() => {
		return Object.keys(shengSuanYunModels).sort((a, b) => a.localeCompare(b))
	}, [shengSuanYunModels])

	const searchableItems = useMemo(() => {
		return modelIds.map((id) => ({ id, html: id }))
	}, [modelIds])

	const modelSearchResults = useMemo(() => {
		if (!searchTerm) {
			return searchableItems
		}
		const lowerSearchTerm = searchTerm.toLowerCase()
		return searchableItems
			.filter((item) => item.id.toLowerCase().includes(lowerSearchTerm))
			.map((item) => {
				const escapedSearchTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
				const regex = new RegExp(`(${escapedSearchTerm})`, "gi")
				const highlightedHtml = item.id.replace(regex, '<span class="model-item-highlight">$1</span>')
				return {
					id: item.id,
					html: highlightedHtml,
				}
			})
	}, [searchableItems, searchTerm])

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) {
			return
		}

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setSelectedIndex((prev) => (prev < modelSearchResults.length - 1 ? prev + 1 : prev))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
				break
			case "Enter":
				event.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < modelSearchResults.length) {
					handleModelChange(modelSearchResults[selectedIndex].id)
					setIsDropdownVisible(false)
				}
				break
			case "Escape":
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
				break
		}
	}

	const hasInfo = useMemo(() => {
		try {
			return modelIds.some((id) => id.toLowerCase() === searchTerm.toLowerCase())
		} catch {
			return false
		}
	}, [modelIds, searchTerm])

	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0
		}
	}, [searchTerm])

	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			})
		}
	}, [selectedIndex])

	const showBudgetSlider = useMemo(() => {
		setSearchTerm(selectedModelId)
		return (
			selectedModelId?.toLowerCase().includes("claude-sonnet-4") ||
			selectedModelId?.toLowerCase().includes("claude-opus-4") ||
			selectedModelId?.toLowerCase().includes("claude-3-7-sonnet") ||
			selectedModelId?.toLowerCase().includes("claude-3.7-sonnet") ||
			selectedModelId?.toLowerCase().includes(":thinking")
		)
	}, [selectedModelId])

	return (
		<div style={{ width: "100%" }}>
			<style>
				{`
				.model-item-highlight {
					background-color: var(--vscode-editor-findMatchHighlightBackground);
					color: inherit;
				}
				`}
			</style>
			<div style={{ display: "flex", flexDirection: "column" }}>
				<label htmlFor="model-search">
					<span style={{ fontWeight: 500 }}>模型</span>
				</label>
				<TabsContainer style={{ marginTop: 4 }}>
					<Tab active={activeTab === "recommended"} onClick={() => setActiveTab("recommended")}>
						推荐
					</Tab>
					{/* <Tab active={activeTab === "free"} onClick={() => setActiveTab("free")}>
						免费
					</Tab> */}
				</TabsContainer>

				{/* Model Cards */}
				<div style={{ marginBottom: "6px" }}>
					{activeTab === "recommended" &&
						recommendedModels.map((model) => (
							<FeaturedModelCard
								description={model.description}
								displayName={model.name || model.id}
								isSelected={selectedModelId === model.id}
								key={model.id}
								label={model.label}
								onClick={() => {
									handleModelChange(model.id)
									setIsDropdownVisible(false)
								}}
							/>
						))}
					{activeTab === "free" &&
						freeModels.map((model) => (
							<FeaturedModelCard
								description={model.description}
								displayName={model.name || model.id}
								isSelected={selectedModelId === model.id}
								key={model.id}
								label={model.label}
								onClick={() => {
									handleModelChange(model.id)
									setIsDropdownVisible(false)
								}}
							/>
						))}
				</div>
				<DropdownWrapper ref={dropdownRef}>
					<VSCodeTextField
						id="model-search"
						onFocus={() => setIsDropdownVisible(true)}
						onInput={(e) => {
							handleModelChange((e.target as HTMLInputElement)?.value?.toLowerCase())
							setIsDropdownVisible(true)
						}}
						onKeyDown={handleKeyDown}
						placeholder="搜索模型..."
						style={{
							width: "100%",
							zIndex: REQUESTY_MODEL_PICKER_Z_INDEX,
							position: "relative",
						}}
						value={searchTerm}>
						{searchTerm && (
							<div
								aria-label="清除"
								className="input-icon-button codicon codicon-close"
								onClick={() => {
									handleModelChange("")
									setIsDropdownVisible(true)
								}}
								slot="end"
								style={{
									display: "flex",
									justifyContent: "center",
									alignItems: "center",
									height: "100%",
								}}
							/>
						)}
					</VSCodeTextField>
					{isDropdownVisible && (
						<DropdownList ref={dropdownListRef}>
							{modelSearchResults.map((item, index) => {
								return (
									<DropdownItem
										isSelected={index === selectedIndex}
										key={item.id}
										onClick={() => {
											handleModelChange(item.id)
											setIsDropdownVisible(false)
										}}
										onMouseEnter={() => setSelectedIndex(index)}
										ref={(el) => (itemRefs.current[index] = el)}>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
											<span dangerouslySetInnerHTML={{ __html: item.html }} />
										</div>
									</DropdownItem>
								)
							})}
						</DropdownList>
					)}
				</DropdownWrapper>
			</div>

			{hasInfo ? (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			) : (
				<p
					style={{
						fontSize: "12px",
						marginTop: 0,
						color: "var(--vscode-descriptionForeground)",
					}}>
					该扩展会自动获取胜算云上可用的最新模型列表{" "}
					<VSCodeLink href="https://router.shengsuanyun.com/model" style={{ display: "inline", fontSize: "inherit" }}>
						胜算云
					</VSCodeLink>
					如果你不确定使用哪个模型, Cline 可以和{" "}
					<VSCodeLink
						onClick={() => handleModelChange("anthropic/claude-sonnet-5")}
						style={{ display: "inline", fontSize: "inherit" }}>
						anthropic/claude-sonnet-5
					</VSCodeLink>
					很好的工作
				</p>
			)}
		</div>
	)
}

export default ShengSuanYunModelPicker

// Dropdown

const DropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

export const REQUESTY_MODEL_PICKER_Z_INDEX = 1_000

const DropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${REQUESTY_MODEL_PICKER_Z_INDEX - 1};
	border-bottom-left-radius: 3px;
	border-bottom-right-radius: 3px;
`

const DropdownItem = styled.div<{ isSelected: boolean }>`
	padding: 5px 10px;
	cursor: pointer;
	word-break: break-all;
	white-space: normal;

	background-color: ${({ isSelected }) => (isSelected ? "var(--vscode-list-activeSelectionBackground)" : "inherit")};

	&:hover {
		background-color: var(--vscode-list-activeSelectionBackground);
	}
`

// Markdown

const _StyledMarkdown = styled.div`
	font-family:
		var(--vscode-font-family),
		system-ui,
		-apple-system,
		BlinkMacSystemFont,
		"Segoe UI",
		Roboto,
		Oxygen,
		Ubuntu,
		Cantarell,
		"Open Sans",
		"Helvetica Neue",
		sans-serif;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);

	p,
	li,
	ol,
	ul {
		line-height: 1.25;
		margin: 0;
	}

	ol,
	ul {
		padding-left: 1.5em;
		margin-left: 0;
	}

	p {
		white-space: pre-wrap;
	}

	a {
		text-decoration: none;
	}
	a {
		&:hover {
			text-decoration: underline;
		}
	}
`

const TabsContainer = styled.div`
	display: flex;
	gap: 0;
	margin-bottom: 12px;
	border-bottom: 1px solid #333;
`

const Tab = styled.div<{ active: boolean }>`
	padding: 8px 16px;
	cursor: pointer;
	font-size: 12px;
	font-weight: 500;
	color: ${({ active }) => (active ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	border-bottom: 2px solid ${({ active }) => (active ? "var(--vscode-textLink-foreground)" : "transparent")};
	transition: all 0.15s ease;

	&:hover {
		color: var(--vscode-foreground);
	}
`
