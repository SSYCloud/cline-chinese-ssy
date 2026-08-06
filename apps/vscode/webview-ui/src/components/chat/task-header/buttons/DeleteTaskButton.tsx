import { StringArrayRequest } from "@shared/proto/cline/common"
import { TrashIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { formatDeleteTaskSizeLabel } from "./formatDeleteTaskSizeLabel"

const DeleteTaskButton: React.FC<{
	taskId?: string
	taskSize?: number
	className?: string
}> = ({ taskId, className, taskSize }) => (
	<Tooltip>
		<TooltipContent>{`删除任务（大小：${formatDeleteTaskSizeLabel(taskSize)}）`}</TooltipContent>
		<TooltipTrigger className={cn("flex items-center", className)}>
			<Button
				aria-label="删除任务"
				disabled={!taskId}
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					taskId && TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [taskId] }))
				}}
				size="xs"
				variant="icon">
				<TrashIcon />
			</Button>
		</TooltipTrigger>
	</Tooltip>
)
DeleteTaskButton.displayName = "DeleteTaskButton"

export default DeleteTaskButton
