import { GlobalFileNames } from "@core/storage/disk"
import { EmptyRequest } from "@shared/proto/cline/common"
import { ShengSuanYunCompatibleModelInfo, ShengSuanYunModelInfo } from "@shared/proto/cline/models"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

export async function refreshShengSuanYunModels(
	controller: Controller,
	_request: EmptyRequest,
): Promise<ShengSuanYunCompatibleModelInfo> {
	let typedModels: Record<string, ShengSuanYunModelInfo> = {}

	try {
		const baseUrl = "https://router.shengsuanyun.com/api/v1"
		const [res, rate] = await Promise.all([
			axios.get(`${baseUrl}/models/`, { timeout: 30000 }),
			axios.get(`${baseUrl}/base/rate`, { timeout: 30000 }),
		])
		const rawModels = res.data?.data
		const usdRate = rate.data?.data

		if (!Array.isArray(rawModels) || typeof usdRate !== "number" || usdRate <= 0) {
			throw new Error("Invalid response format or invalid rate from ShengSuanYun API")
		}

		for (const model of rawModels) {
			if (!Array.isArray(model.support_apis) || !model.support_apis.includes("/v1/messages")) {
				continue
			}
			const inputArch = model.architecture?.input
			const supportsImages = typeof inputArch === "string" ? inputArch.toLowerCase().includes("image") : false
			const parsePrice = (price: unknown) => (Number(price) || 0) * usdRate
			typedModels[model.api_name] = {
				maxTokens: model.max_tokens ?? 0,
				contextWindow: model.context_window ?? 0,
				supportsImages,
				supportsPromptCache: Boolean(model.supports_prompt_cache),
				inputPrice: parsePrice(model.pricing?.prompt),
				outputPrice: parsePrice(model.pricing?.completion),
				cacheWritesPrice: 0,
				cacheReadsPrice: parsePrice(model.pricing?.cache),
				description: model.description ?? "",
				endPoints: model.support_apis || [],
			}
		}
		const shengSuanYunModelsFilePath = path.join(
			await ensureCacheDirectoryExists(controller),
			GlobalFileNames.shengSuanYunModels,
		)
		await fs.writeFile(shengSuanYunModelsFilePath, JSON.stringify(typedModels, null, 2))
		Logger.log("ShengSuanYun models fetched and saved", typedModels)
	} catch (error) {
		Logger.error("Error fetching ShengSuanYun models, attempting to fallback to cache:", error)
		const cachedModels = await readShengSuanYunModels(controller)
		if (cachedModels) {
			typedModels = cachedModels as Record<string, ShengSuanYunModelInfo>
		} else {
			Logger.error("Failed to recover from cache, returning empty model list.")
		}
	}
	return ShengSuanYunCompatibleModelInfo.create({ models: typedModels })
}

/**
 * Reads cached ShengSuanYun models from disk
 */
async function readShengSuanYunModels(
	controller: Controller,
): Promise<Record<string, Partial<ShengSuanYunModelInfo>> | undefined> {
	const shengSuanYunModelsFilePath = path.join(await ensureCacheDirectoryExists(controller), GlobalFileNames.shengSuanYunModels)
	const fileExists = await fileExistsAtPath(shengSuanYunModelsFilePath)
	if (fileExists) {
		try {
			const fileContents = await fs.readFile(shengSuanYunModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		} catch (error) {
			Logger.error("Error reading cached ShengSuanYun models:", error)
			return undefined
		}
	}
	return undefined
}

/**
 * Ensures the cache directory exists and returns its path
 */
async function ensureCacheDirectoryExists(controller: Controller): Promise<string> {
	const cacheDir = path.join(controller.context.globalStorageUri.fsPath, "cache")
	await fs.mkdir(cacheDir, { recursive: true })
	return cacheDir
}
