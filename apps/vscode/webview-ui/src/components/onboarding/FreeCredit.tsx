export default function FreeCredit() {
	return (
		<section className="flex flex-col px-2 pt-2 pb-4.5 w-full">
			<div className="m-[20px_0_12px] p-3 border border-[#2e6f82] rounded-lg">
				<strong className="block text-[#e4f8ff] text-[15px] font-bold">新用户登录并获取免费模力</strong>
				<p className="m-[5px_0_0] text-[#a6c4cb] text-[12px]">
					新用户将免费获得10元模力；1模力=1RMB。模力可用于胜算云模型调用。
				</p>
			</div>

			<div className="m-[20px_0_10px] text-[#96999e] text-[12px] font-bold uppercase">SSY Cloud 模型消耗参考</div>

			<div className="overflow-auto mt-3 border border-[#3b3e43] rounded-lg">
				<table className="w-full min-w-180 border-collapse text-[11px]">
					<thead>
						<tr>
							<th className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#aeb3b8] bg-[#22252a] font-semibold">
								模型
							</th>
							<th className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#aeb3b8] bg-[#22252a] font-semibold">
								预估能用Token
							</th>
							<th className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#aeb3b8] bg-[#22252a] font-semibold">
								输入价格
							</th>
							<th className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#aeb3b8] bg-[#22252a] font-semibold">
								输出价格
							</th>
							<th className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#aeb3b8] bg-[#22252a] font-semibold">
								缓存命中价格
							</th>
						</tr>
					</thead>
					<tbody>
						<tr className="group">
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								<span className="font-semibold text-[#eef1f3]">DeepSeek-V4-Flash</span>
								<span className="block mt-0.5 text-[#7d858d] text-[10px]">deepseek/deepseek-v4-flash</span>
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								约9.93M
								<span className="block mt-0.5 text-[#7d858d] text-[10px]">M=百万token</span>
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								¥1.00 / M
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								¥2.00 / M
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								¥0.02 / M
							</td>
						</tr>
						<tr className="group">
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								<span className="font-semibold text-[#eef1f3]">GPT-5.6-Luna</span>
								<span className="block mt-0.5 text-[#7d858d] text-[10px]">openai/gpt-5.6-luna</span>
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								约3.02M
								<span className="block mt-0.5 text-[#7d858d] text-[10px]">M=百万token</span>
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								¥1.40 / M
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								¥8.40 / M
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								¥0.14 / M<br />
								<span className="block mt-0.5 text-[#7d858d] text-[10px]">≤272K缓存</span>
							</td>
						</tr>
						<tr className="group">
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								<span className="font-semibold text-[#eef1f3]">MiniMax-M3</span>
								<span className="block mt-0.5 text-[#7d858d] text-[10px]">minimax/minimax-m3</span>
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								约2.75M
								<span className="block mt-0.5 text-[#7d858d] text-[10px]">M=百万token</span>
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								¥2.10 / M
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								¥8.40 / M
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								¥0.42 / M
							</td>
						</tr>
						<tr className="group">
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								<span className="font-semibold text-[#eef1f3]">GLM-5.2</span>
								<span className="block mt-0.5 text-[#7d858d] text-[10px]">bigmodel/glm-5.2</span>
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								约0.79M
								<span className="block mt-0.5 text-[#7d858d] text-[10px]">M=百万token</span>
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								¥8.00 / M
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								¥28.00 / M
							</td>
							<td className="p-[8px_7px] border-b border-[#34373b] text-left align-top text-[#d0d3d6] group-last:border-b-0">
								¥2.00 / M
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<div className="text-[#858b92] leading-normal mt-2">
				预估能用Token按10模力=10RMB，并将输入、输出、缓存命中三类价格等权综合估算；实际消耗会随真实输入/输出/缓存命中比例变化，最终以控制台调用记录扣费为准。
			</div>
		</section>
	)
}
