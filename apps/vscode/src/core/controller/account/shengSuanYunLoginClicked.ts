import { EmptyRequest, String } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"
import { Controller } from ".."

export async function shengSuanYunLoginClicked(_controller: Controller, _: EmptyRequest): Promise<String> {
	const baseUrl = await HostProvider.get().getCallbackUrl("/ssy")
	const callbackUrl = `${baseUrl}`
	const authUrl = new URL("https://router.shengsuanyun.com/auth?from=cline-shengsuan")
	authUrl.searchParams.set("callback_url", decodeURIComponent(callbackUrl))
	const authUrlString = authUrl.toString()
	Logger.error("ShengSuanYun login clicked, opening auth URL:", authUrlString)
	await openExternal(authUrlString)
	return String.create({ value: authUrlString })
}
