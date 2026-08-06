import { EmptyRequest, String } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { openExternal } from "@/utils/env"
import { Controller } from ".."

export async function shengSuanYunLoginClicked(_controller: Controller, _: EmptyRequest): Promise<String> {
	const callbackUrl = `${await HostProvider.get().getCallbackUrl("/ssy")}?from=cline-chinese`
	// const id = "CH_R39YE8W1"
	const authUrl = new URL("https://router.shengsuanyun.com/auth")
	authUrl.searchParams.set("callback_url", callbackUrl)
	const authUrlString = authUrl.toString()
	await openExternal(authUrlString)
	return String.create({ value: authUrlString })
}
