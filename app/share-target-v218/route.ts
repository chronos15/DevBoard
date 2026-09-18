import { handleTaskBoardShareTargetPost } from "@/lib/server-share-target-handler"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  return handleTaskBoardShareTargetPost(request)
}
