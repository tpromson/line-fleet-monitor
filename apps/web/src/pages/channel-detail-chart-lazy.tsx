import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

const DailyUsageChart = lazy(() => import('./channel-detail-chart'))

interface ChartProps {
  data: Array<{ checked_at: string; quota_used: number }>
}

export function DailyUsageChartLazy({ data }: ChartProps) {
  return (
    <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
      <DailyUsageChart data={data} />
    </Suspense>
  )
}
