import { GlobalFileNames } from "@core/storage/disk"
import { EmptyRequest } from "@shared/proto/cline/common"
import { ShengSuanYunEnterpriseModelInfo, ShengSuanYunModelInfo, ShengSuanYunProject } from "@shared/proto/cline/models"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

interface RawProject {
	id: number
	projectName: string
	status: string
	selectedModels?: Array<{
		name: string
		type: string
		contextLength?: number
		inputPrice?: number
		outputPrice?: number
		provider?: string
	}>
}

const BASE_URL = "https://api.shengsuanyun.com"

const EXCLUDE_KEYWORDS = [
	"embed",
	"seed",
	"video",
	"happyhorse",
	"image",
	"wan",
	"sora",
	"veo",
	"kling",
	"forest",
	"jimeng",
	"vidu",
	"live",
	"director",
	"runway",
]
const EXCLUDE_TYPES = ["视频", "图像生成", "音频", "向量"]

export async function refreshShengSuanYunEnterpriseModels(
	controller: Controller,
	_request: EmptyRequest,
): Promise<ShengSuanYunEnterpriseModelInfo> {
	const cacheFilePath = path.join(await ensureCacheDirectoryExists(controller), GlobalFileNames.shengSuanYunEModels)
	const token = controller.stateManager.getSecretKey("shengSuanYunToken")
	if (!token) {
		Logger.error("No token found for ShengSuanYun. Cannot refresh enterprise models.")
		return ShengSuanYunEnterpriseModelInfo.create({ projects: {} })
	}

	let rawProjects: Record<string, RawProject> = {}
	try {
		const res = await axios.get(`${BASE_URL}project/list`, {
			headers: { "x-token": token },
			...getAxiosSettings(),
		})
		if (res.data?.data && Array.isArray(res.data.data)) {
			for (const project of res.data.data as RawProject[]) {
				if (project.status !== "active") {
					continue
				}
				rawProjects[String(project.id)] = project
			}
		}
		await fs.writeFile(cacheFilePath, JSON.stringify(rawProjects))
		Logger.log("ShengSuanYun enterprise models fetched and saved")
	} catch (error) {
		Logger.error("Error fetching ShengSuanYun enterprise models:", error)
		const cached = await readCachedProjects(cacheFilePath)
		if (cached) {
			rawProjects = cached
		}
	}

	return buildEnterpriseModelInfo(rawProjects)
}

function buildEnterpriseModelInfo(rawProjects: Record<string, RawProject>): ShengSuanYunEnterpriseModelInfo {
	const projects: Record<string, ShengSuanYunProject> = {}

	for (const [idStr, project] of Object.entries(rawProjects)) {
		const models: Record<string, ShengSuanYunModelInfo> = {}

		for (const model of project.selectedModels ?? []) {
			if (EXCLUDE_KEYWORDS.some((kw) => model.name.includes(kw)) || EXCLUDE_TYPES.some((tp) => model.type.includes(tp))) {
				continue
			}
			models[model.name] = ShengSuanYunModelInfo.create({
				contextWindow: model.contextLength ?? 0,
				supportsImages: model.type.includes("图像"),
				supportsPromptCache: false,
				inputPrice: (model.inputPrice ?? 0) / 10000,
				outputPrice: (model.outputPrice ?? 0) / 10000,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0,
				description: `${model.provider ?? ""} - ${model.name}`,
				endPoints: ["/v1/chat/completions"],
			})
		}

		projects[idStr] = ShengSuanYunProject.create({
			id: project.id,
			name: project.projectName,
			models,
		})
	}

	return ShengSuanYunEnterpriseModelInfo.create({ projects })
}

async function readCachedProjects(cacheFilePath: string): Promise<Record<string, RawProject> | undefined> {
	if (!(await fileExistsAtPath(cacheFilePath))) {
		return undefined
	}
	try {
		const contents = await fs.readFile(cacheFilePath, "utf8")
		return JSON.parse(contents)
	} catch (error) {
		Logger.error("Error reading cached ShengSuanYun enterprise models:", error)
		return undefined
	}
}

async function ensureCacheDirectoryExists(controller: Controller): Promise<string> {
	const cacheDir = path.join(controller.context.globalStorageUri.fsPath, "cache")
	await fs.mkdir(cacheDir, { recursive: true })
	return cacheDir
}
