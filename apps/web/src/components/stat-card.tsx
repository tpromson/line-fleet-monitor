import { Card, CardContent } from '@/components/ui/card'

interface StatCardProps {
  icon: React.ReactNode
  value: string
  label: string
  warn?: boolean
}

export function StatCard({ icon, value, label, warn }: StatCardProps) {
  return (
    <Card className={warn ? 'border-destructive' : ''}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-muted-foreground">{icon}</span>
          <span className={`text-xl font-bold ${warn ? 'text-destructive' : ''}`}>{value}</span>
        </div>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}
