import { openAiModelInfoSafeDefaults } from "@shared/api"
import BedrockData from "@shared/providers/bedrock.json"
import type { Mode } from "@shared/storage/types"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import {
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeRadio,
	VSCodeRadioGroup,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import styled from "styled-components"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { getSavedApiKeyMask, sanitizeMaskedApiKeyInput } from "../utils/apiKeyMasking"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

const AWS_REGIONS = BedrockData.regions

// Z-index constants for proper dropdown layering
const DROPDOWN_Z_INDEX = 1000

interface BedrockProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const BedrockProvider = ({ showModelOptions, isPopup, currentMode }: BedrockProviderProps) => {
	const { apiConfiguration, remoteConfigSettings } = useExtensionState()
	const { models: bedrockModels, defaultModelId: bedrockDefaultModelId } = useProviderModels("bedrock")
	const { config, write, commitSelection } = useProviderConfig("bedrock")
	const { selectedModelId, selectedModelInfo, commitModelSelection } = useProviderModelSelection("bedrock", currentMode, {
		models: bedrockModels,
		defaultModelId: bedrockDefaultModelId,
		config,
		commitSelection,
		customModelInfo: (modelId) => ({
			...(bedrockModels[config?.aws?.customModelBaseId ?? ""] ??
				bedrockModels[bedrockDefaultModelId] ??
				openAiModelInfoSafeDefaults),
			name: modelId,
		}),
	})
	const bedrockModelIds = useMemo(() => Object.keys(bedrockModels), [bedrockModels])
	const bedrockFallbackModelId = bedrockDefaultModelId || bedrockModelIds[0] || ""
	const customBaseModelId = config?.aws?.customModelBaseId || bedrockFallbackModelId
	const isCustomModelSelected = Boolean(config?.aws?.customModelBaseId)
	const customModelInputInitialValue = isCustomModelSelected && !bedrockModels[selectedModelId] ? selectedModelId : ""
	const isAdaptiveThinkingModel =
		isClaudeOpusAdaptiveThinkingModel(selectedModelId) || isClaudeOpusAdaptiveThinkingModel(customBaseModelId)
	const supportsGlobalInferenceProfile =
		selectedModelInfo.supportsGlobalEndpoint ||
		selectedModelId.startsWith("global.") ||
		Boolean(bedrockModels[`global.${selectedModelId}`])
	const modeFields =
		currentMode === "plan"
			? {
					reasoningEffort: apiConfiguration?.planModeReasoningEffort,
					thinkingBudgetTokens: apiConfiguration?.planModeThinkingBudgetTokens,
				}
			: {
					reasoningEffort: apiConfiguration?.actModeReasoningEffort,
					thinkingBudgetTokens: apiConfiguration?.actModeThinkingBudgetTokens,
				}
	const adaptiveThinkingDefaultEffort =
		resolveClaudeOpusAdaptiveThinking(modeFields.reasoningEffort, modeFields.thinkingBudgetTokens).effort ?? "none"
	const handleReasoningEffortChange = (effort: string) => {
		void write({
			reasoning: { enabled: effort !== "none", effort: effort !== "none" ? effort : undefined },
		}).catch((err) => console.error("Failed to update Bedrock reasoning effort:", err))
	}
	const awsAuthentication =
		config?.aws?.authentication === "iam"
			? "credentials"
			: config?.aws?.authentication === "api-key"
				? "apikey"
				: config?.aws?.authentication
	const selectedAuthentication =
		awsAuthentication ?? (config?.apiKeyLength ? "apikey" : config?.aws?.profile ? "profile" : "credentials")
	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName: "Bedrock",
		write,
	})
	const accessKeyMask = getSavedApiKeyMask(config?.aws?.accessKeyLength)
	const secretKeyMask = getSavedApiKeyMask(config?.aws?.secretKeyLength)
	const sessionTokenMask = getSavedApiKeyMask(config?.aws?.sessionTokenLength)
	const handleAwsSecretChange = (
		field: "accessKey" | "secretKey" | "sessionToken",
		value: string,
		savedMask: string,
		label: string,
	) => {
		const sanitizedValue = sanitizeMaskedApiKeyInput(value, savedMask)
		if (sanitizedValue === undefined) {
			return
		}
		writeAws({ [field]: sanitizedValue }, label)
	}
	const [awsEndpointSelected, setAwsEndpointSelected] = useState(!!config?.aws?.endpoint)

	// Region combobox state
	const currentRegion = config?.region || ""
	const [searchTerm, setSearchTerm] = useState("")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)
	const isSelectingRef = useRef(false)
	const authInteractionRef = useRef(false)

	useEffect(() => {
		setSearchTerm(currentRegion)
	}, [currentRegion])

	useEffect(() => {
		setAwsEndpointSelected(!!config?.aws?.endpoint)
	}, [config?.aws?.endpoint])

	const writeProviderConfig = (patch: Parameters<typeof write>[0], label: string) => {
		void write(patch).catch((err) => console.error(`Failed to update Bedrock ${label}:`, err))
	}
	const writeAws = (aws: NonNullable<Parameters<typeof write>[0]["aws"]>, label: string) => {
		writeProviderConfig({ aws }, label)
	}

	const fuse = useMemo(() => {
		return new Fuse(AWS_REGIONS, {
			threshold: 0.3,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		})
	}, [])

	const regionSearchResults = useMemo(() => {
		if (!searchTerm) {
			return AWS_REGIONS
		}
		return fuse.search(searchTerm).map((r) => r.item)
	}, [searchTerm, fuse])

	const handleRegionChange = (newRegion: string) => {
		setSearchTerm(newRegion)
		writeProviderConfig({ region: newRegion }, "region")
	}

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) {
			return
		}

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setSelectedIndex((prev) => (prev < regionSearchResults.length - 1 ? prev + 1 : prev))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
				break
			case "Enter":
				event.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < regionSearchResults.length) {
					handleRegionChange(regionSearchResults[selectedIndex])
					setIsDropdownVisible(false)
				} else {
					// User typed a custom region
					handleRegionChange(searchTerm)
					setIsDropdownVisible(false)
				}
				break
			case "Escape":
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
				break
		}
	}

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

	// Reset selection when search term changes
	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0
		}
	}, [searchTerm])

	// Scroll selected item into view
	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			})
		}
	}, [selectedIndex])

	return (
		<div className="flex flex-col gap-1">
			<VSCodeRadioGroup
				onChange={(e) => {
					if (!authInteractionRef.current) {
						return
					}
					authInteractionRef.current = false
					const value = (e.target as HTMLInputElement)?.value
					if (value === selectedAuthentication) {
						return
					}
					const authentication = value === "credentials" ? "iam" : value
					writeProviderConfig({ aws: { authentication } }, "authentication")
				}}
				onKeyDown={() => {
					authInteractionRef.current = true
				}}
				onMouseDown={() => {
					authInteractionRef.current = true
				}}
				value={selectedAuthentication}>
				<VSCodeRadio checked={selectedAuthentication === "apikey"} value="apikey">
					API 密钥
				</VSCodeRadio>
				<VSCodeRadio checked={selectedAuthentication === "profile"} value="profile">
					AWS 配置文件
				</VSCodeRadio>
				<VSCodeRadio checked={selectedAuthentication === "credentials"} value="credentials">
					AWS 凭据
				</VSCodeRadio>
			</VSCodeRadioGroup>

			{selectedAuthentication === "profile" ? (
				<DebouncedTextField
					className="w-full"
					initialValue={config?.aws?.profile ?? ""}
					key="profile"
					onChange={(value) => writeAws({ profile: value }, "profile")}
					placeholder="输入配置文件名称（留空使用默认）">
					<span className="font-medium">AWS 配置文件名称</span>
				</DebouncedTextField>
			) : selectedAuthentication === "apikey" ? (
				<ApiKeyField
					helpText="此密钥仅存储在本地，仅用于从此扩展发起 API 请求。"
					initialValue={savedApiKeyMask}
					key="apikey"
					label="AWS Bedrock API 密钥"
					onChange={handleApiKeyChange}
					placeholder="输入 Bedrock API 密钥"
					providerName="Bedrock"
				/>
			) : (
				<>
					<ApiKeyField
						helpText="此密钥仅存储在本地，仅用于从此扩展发起 API 请求。"
						initialValue={accessKeyMask}
						key="accessKey"
						label="AWS 访问密钥"
						onChange={(value) => handleAwsSecretChange("accessKey", value, accessKeyMask, "access key")}
						placeholder="输入访问密钥..."
						providerName="AWS"
					/>
					<ApiKeyField
						helpText="此密钥仅存储在本地，仅用于从此扩展发起 API 请求。"
						initialValue={secretKeyMask}
						label="AWS 密钥"
						onChange={(value) => handleAwsSecretChange("secretKey", value, secretKeyMask, "secret key")}
						placeholder="输入密钥..."
						providerName="AWS"
					/>
					<ApiKeyField
						helpText="此密钥仅存储在本地，仅用于从此扩展发起 API 请求。"
						initialValue={sessionTokenMask}
						label="AWS 会话令牌"
						onChange={(value) => handleAwsSecretChange("sessionToken", value, sessionTokenMask, "session token")}
						placeholder="输入会话令牌..."
						providerName="AWS"
					/>
				</>
			)}

			<Tooltip>
				<TooltipContent hidden={remoteConfigSettings?.awsRegion === undefined}>
					此设置由你组织的远程配置管理
				</TooltipContent>
				<TooltipTrigger>
					<DropdownContainer className="dropdown-container mb-2.5" zIndex={DROPDOWN_Z_INDEX - 1}>
						<div className="flex items-center gap-2 mb-1">
							<label htmlFor="aws-region">
								<span className="font-medium">AWS 区域</span>
							</label>
							{remoteConfigSettings?.awsRegion !== undefined && (
								<i className="codicon codicon-lock text-description text-sm flex items-center" />
							)}
						</div>
						<RegionDropdownWrapper ref={dropdownRef}>
							<VSCodeTextField
								aria-autocomplete="list"
								aria-expanded={isDropdownVisible}
								disabled={remoteConfigSettings?.awsRegion !== undefined}
								id="aws-region"
								onBlur={() => {
									if (!isSelectingRef.current && searchTerm !== currentRegion) {
										handleRegionChange(searchTerm || currentRegion)
									}
									isSelectingRef.current = false
								}}
								onFocus={() => {
									setIsDropdownVisible(true)
									setSearchTerm("")
								}}
								onInput={(e) => {
									setSearchTerm((e.target as HTMLInputElement)?.value || "")
									setIsDropdownVisible(true)
								}}
								onKeyDown={handleKeyDown}
								placeholder="搜索或输入自定义区域..."
								role="combobox"
								style={{
									width: "100%",
									zIndex: DROPDOWN_Z_INDEX - 1,
									position: "relative",
									minWidth: 130,
								}}
								value={searchTerm}>
								{searchTerm && searchTerm !== currentRegion && (
									<div
										aria-label="清除搜索"
										className="input-icon-button codicon codicon-close"
										onClick={() => {
											setSearchTerm("")
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
							{isDropdownVisible && regionSearchResults.length > 0 && (
								<RegionDropdownList ref={dropdownListRef} role="listbox">
									{regionSearchResults.map((region, index) => (
										<RegionDropdownItem
											aria-selected={index === selectedIndex}
											isSelected={index === selectedIndex}
											key={region}
											onClick={() => {
												handleRegionChange(region)
												setIsDropdownVisible(false)
												isSelectingRef.current = false
											}}
											onMouseDown={() => {
												isSelectingRef.current = true
											}}
											onMouseEnter={() => setSelectedIndex(index)}
											ref={(el) => {
												itemRefs.current[index] = el
											}}
											role="option">
											<span>{region}</span>
										</RegionDropdownItem>
									))}
								</RegionDropdownList>
							)}
						</RegionDropdownWrapper>
					</DropdownContainer>
				</TooltipTrigger>
			</Tooltip>

			<div className="flex flex-col">
				<Tooltip>
					<TooltipContent hidden={remoteConfigSettings?.awsBedrockEndpoint === undefined}>
						此设置由你组织的远程配置管理
					</TooltipContent>
					<TooltipTrigger>
						<div className="flex items-center gap-2">
							<VSCodeCheckbox
								checked={awsEndpointSelected}
								disabled={remoteConfigSettings?.awsBedrockEndpoint !== undefined}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									setAwsEndpointSelected(isChecked)
									if (!isChecked) {
										writeAws({ endpoint: "" }, "endpoint")
									}
								}}>
								使用自定义 VPC 端点
							</VSCodeCheckbox>
							{remoteConfigSettings?.awsBedrockEndpoint !== undefined && (
								<i className="codicon codicon-lock text-description text-sm flex items-center" />
							)}
						</div>

						{awsEndpointSelected && (
							<DebouncedTextField
								className="mt-0.5 mb-1 text-sm text-description"
								disabled={remoteConfigSettings?.awsBedrockEndpoint !== undefined}
								initialValue={config?.aws?.endpoint || ""}
								onChange={(value) => writeAws({ endpoint: value }, "endpoint")}
								placeholder="输入 VPC 端点 URL（可选）"
								type="text"
							/>
						)}
					</TooltipTrigger>
				</Tooltip>

				<Tooltip>
					<TooltipContent hidden={remoteConfigSettings?.awsUseCrossRegionInference === undefined}>
						此设置由你组织的远程配置管理
					</TooltipContent>
					<TooltipTrigger>
						<div className="flex items-center gap-2">
							<VSCodeCheckbox
								checked={config?.aws?.useCrossRegionInference || false}
								disabled={remoteConfigSettings?.awsUseCrossRegionInference !== undefined}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true

									writeAws({ useCrossRegionInference: isChecked }, "cross-region inference")
								}}>
								使用跨区域推理
							</VSCodeCheckbox>
							{remoteConfigSettings?.awsUseCrossRegionInference !== undefined && (
								<i className="codicon codicon-lock text-description text-sm" />
							)}
						</div>
					</TooltipTrigger>
				</Tooltip>

				{config?.aws?.useCrossRegionInference && supportsGlobalInferenceProfile && (
					<Tooltip>
						<TooltipContent hidden={remoteConfigSettings?.awsUseGlobalInference === undefined}>
							此设置由你组织的远程配置管理
						</TooltipContent>
						<TooltipTrigger>
							<div className="flex items-center gap-2">
								<VSCodeCheckbox
									checked={config?.aws?.useGlobalInference || false}
									disabled={remoteConfigSettings?.awsUseGlobalInference !== undefined}
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										writeAws({ useGlobalInference: isChecked }, "global inference")
									}}>
									使用全局推理配置文件
								</VSCodeCheckbox>
								{remoteConfigSettings?.awsUseGlobalInference !== undefined && (
									<i className="codicon codicon-lock text-description text-sm" />
								)}
							</div>
						</TooltipTrigger>
					</Tooltip>
				)}

				{selectedModelInfo.supportsPromptCache && (
					<Tooltip>
						<TooltipContent hidden={remoteConfigSettings?.awsBedrockUsePromptCache === undefined}>
							此设置由你组织的远程配置管理
						</TooltipContent>
						<TooltipTrigger>
							<div className="flex items-center gap-2">
								<VSCodeCheckbox
									checked={config?.aws?.usePromptCache || false}
									disabled={remoteConfigSettings?.awsBedrockUsePromptCache !== undefined}
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										writeAws({ usePromptCache: isChecked }, "prompt caching")
									}}>
									使用提示词缓存
								</VSCodeCheckbox>
								{remoteConfigSettings?.awsBedrockUsePromptCache !== undefined && (
									<i className="codicon codicon-lock text-description text-sm" />
								)}
							</div>
						</TooltipTrigger>
					</Tooltip>
				)}
			</div>

			<p className="mt-1 text-sm text-description">
				{selectedAuthentication === "profile"
					? "使用来自 ~/.aws/credentials 的 AWS 配置文件凭据。留空配置文件名称以使用默认配置文件。这些凭据仅存储在本地，仅用于从此扩展发起 API 请求。"
					: "通过提供上述密钥或使用默认 AWS 凭据提供程序（即 ~/.aws/credentials 或环境变量）进行身份验证。这些凭据仅存储在本地，仅用于从此扩展发起 API 请求。"}
			</p>

			{showModelOptions && (
				<>
					<label htmlFor="bedrock-model-dropdown">
						<span className="font-medium">模型</span>
					</label>
					<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 2}>
						<VSCodeDropdown
							className="w-full"
							id="bedrock-model-dropdown"
							key={`bedrock-model-${isCustomModelSelected ? "custom" : selectedModelId}-${bedrockModelIds.length}`}
							onChange={(e: any) => {
								const value = e.target.value
								if (value === "custom") {
									writeAws(
										{ customModelBaseId: customBaseModelId || bedrockFallbackModelId },
										"custom base model",
									)
									return
								}
								writeAws({ customModelBaseId: "" }, "custom base model")
								void commitModelSelection({
									modelId: value,
									modelInfo: bedrockModels[value] ?? selectedModelInfo,
								}).catch((err) => console.error("Failed to commit Bedrock model selection:", err))
							}}
							value={isCustomModelSelected ? "custom" : selectedModelId}>
							<VSCodeOption value="">选择模型...</VSCodeOption>
							{bedrockModelIds.map((modelId) => (
								<VSCodeOption
									className="whitespace-normal wrap-break-word max-w-full"
									key={modelId}
									value={modelId}>
									{modelId}
								</VSCodeOption>
							))}
							<VSCodeOption value="custom">自定义</VSCodeOption>
						</VSCodeDropdown>
					</DropdownContainer>

					{isCustomModelSelected && (
						<div>
							<p className="mt-1 text-sm text-description">
								在 Bedrock 中使用 Application Inference Profile 时请选择“自定义”。在模型 ID 字段中输入 Application
								Inference Profile ARN。
							</p>
							<DebouncedTextField
								className="w-full mt-0.5"
								id="bedrock-model-input"
								initialValue={customModelInputInitialValue}
								key={`custom-${customModelInputInitialValue}`}
								onChange={(value) => {
									if (!value.trim()) {
										return
									}
									void commitModelSelection({
										modelId: value,
										modelInfo: bedrockModels[customBaseModelId] ?? selectedModelInfo,
									}).catch((err) => console.error("Failed to commit Bedrock custom model selection:", err))
								}}
								placeholder="输入自定义模型 ID...">
								<span className="font-medium">模型 ID</span>
							</DebouncedTextField>
							<label htmlFor="bedrock-base-model-dropdown">
								<span className="font-medium">基础推理模型</span>
							</label>
							<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 3}>
								<VSCodeDropdown
									className="w-full"
									id="bedrock-base-model-dropdown"
									key={`bedrock-base-model-${customBaseModelId || bedrockFallbackModelId}-${bedrockModelIds.length}`}
									onChange={(e: any) => writeAws({ customModelBaseId: e.target.value }, "custom base model")}
									value={customBaseModelId || bedrockFallbackModelId}>
									<VSCodeOption value="">选择模型...</VSCodeOption>
									{bedrockModelIds.map((modelId) => (
										<VSCodeOption
											className="whitespace-normal wrap-break-word max-w-full"
											key={modelId}
											value={modelId}>
											{modelId}
										</VSCodeOption>
									))}
								</VSCodeDropdown>
							</DropdownContainer>
						</div>
					)}

					{isAdaptiveThinkingModel ? (
						<ReasoningEffortSelector
							allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
							currentMode={currentMode}
							defaultEffort={adaptiveThinkingDefaultEffort}
							description="选择“无”可禁用自适应思考。更高的努力程度会增加响应细节和 token 消耗。"
							label="自适应思考"
							onEffortChange={handleReasoningEffortChange}
						/>
					) : selectedModelInfo.supportsReasoning === true ||
						(isCustomModelSelected &&
							customBaseModelId &&
							bedrockModels[customBaseModelId]?.supportsReasoning === true) ? (
						<ReasoningEffortSelector
							currentMode={currentMode}
							defaultEffort="none"
							description="选择“无”可禁用扩展思考。更高的努力程度会提升思考深度，但会消耗更多 tokens。"
							onEffortChange={handleReasoningEffortChange}
						/>
					) : null}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}

const RegionDropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

const RegionDropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${DROPDOWN_Z_INDEX - 1};
	border-bottom-left-radius: 3px;
	border-bottom-right-radius: 3px;
`

const RegionDropdownItem = styled.div<{ isSelected: boolean }>`
	padding: 5px 10px;
	cursor: pointer;
	word-break: break-all;
	white-space: normal;
	text-align: left;

	background-color: ${({ isSelected }) => (isSelected ? "var(--vscode-list-activeSelectionBackground)" : "inherit")};
	color: ${({ isSelected }) => (isSelected ? "var(--vscode-list-activeSelectionForeground, inherit)" : "inherit")};

	&:hover {
		background-color: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground, inherit);
	}
`
