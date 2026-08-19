import Image from "next/image"
import { cn } from "@/lib/utils"

export function DevboardLogo({
  className,
  iconClassName,
  priority = false,
}: {
  className?: string
  iconClassName?: string
  priority?: boolean
}) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", className)}>
      <Image
        src="/devboard-icon-192.png"
        alt=""
        width={192}
        height={192}
        priority={priority}
        className={cn("size-full object-contain", iconClassName)}
      />
    </span>
  )
}
