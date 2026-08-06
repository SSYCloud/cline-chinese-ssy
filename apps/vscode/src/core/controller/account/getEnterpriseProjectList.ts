import { EProjectList } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

export async function getEnterpriseProjectList(controller: Controller, _request: EmptyRequest): Promise<EProjectList> {
	try {
		if (!controller.accountServiceSSY) {
			throw new Error("Account service not available")
		}
		return await controller.accountServiceSSY.getEnterpriseProjectList()
	} catch (error) {
		Logger.error(`Failed to fetch enterprise project list: ${error}`)
		throw error
	}
}
