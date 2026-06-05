import { useEffect, useState } from 'react'
import { Thermometer, Snowflake } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Link } from 'react-router-dom'

interface TempWidget {
  sourceId: string
  sourceName: string
  currentTemp: number | null
  currentHumid: number | null
  todayMax: number | null
  todayMin: number | null
  todayAvg: number | null
  threshold: number
  deviceStatus: string
}

function getTempColor(temp: number | null, threshold: number): string {
  if (temp === null) return 'text-muted-foreground'
  if (temp >= threshold) return 'text-rose-500'
  if (temp >= threshold * 0.9) return 'text-amber-500'
  return 'text-emerald-500'
}

function deviceStatusBadge(status: string) {
  switch (status) {
    case 'online':
      return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200 text-[10px]">Online</Badge>
    case 'delayed':
      return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200 text-[10px]">Delayed</Badge>
    case 'offline':
      return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-200 border-rose-200 text-[10px]">Offline</Badge>
    default:
      return <Badge variant="outline" className="text-[10px]">Unknown</Badge>
  }
}

export function PublicIotcenterPage() {
  const [widgets, setWidgets] = useState<TempWidget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'}/public/iotcenter/temperature`)
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        setWidgets(data.widgets || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-muted/50 p-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-6">Temperature Overview</h1>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="pt-4 pb-3">
                  <div className="h-4 bg-muted rounded w-1/2 mb-2" />
                  <div className="h-8 bg-muted rounded w-3/4" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-muted/50 p-6 flex items-center justify-center">
        <Card className="max-w-sm">
          <CardContent className="py-6 text-center text-destructive">{error}</CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted/50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Thermometer className="w-6 h-6" />
            Temperature Overview
          </h1>
          <Link to="/login" className="text-sm text-muted-foreground hover:text-primary">
            Login to manage
          </Link>
        </div>

        {widgets.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No temperature data available
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {widgets.map((tw) => (
              <Card
                key={tw.sourceId}
                className={
                  tw.currentTemp !== null && tw.currentTemp >= tw.threshold
                    ? 'ring-1 ring-rose-200/70'
                    : tw.currentTemp !== null && tw.currentTemp >= tw.threshold * 0.9
                    ? 'ring-1 ring-amber-200/70'
                    : tw.currentTemp !== null && tw.currentTemp > 0
                    ? 'ring-1 ring-emerald-200/50'
                    : ''
                }
              >
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium truncate">{tw.sourceName}</span>
                    <div className="flex items-center gap-1">
                      {tw.currentTemp !== null && tw.currentTemp <= 0 && (
                        <Snowflake className="w-3.5 h-3.5 text-sky-400" />
                      )}
                      {deviceStatusBadge(tw.deviceStatus)}
                    </div>
                  </div>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className={`text-2xl font-bold ${getTempColor(tw.currentTemp, tw.threshold)}`}>
                      {tw.currentTemp !== null ? tw.currentTemp.toFixed(1) : '-'}
                    </span>
                    <span className="text-xs text-muted-foreground">°C</span>
                  </div>
                  {tw.currentHumid !== null && tw.currentHumid > 0 && (
                    <div className="flex items-baseline gap-1 mb-1">
                      <span className="text-sm font-medium text-sky-500">
                        💧 {tw.currentHumid.toFixed(1)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">%</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      🔺 {tw.todayMax !== null ? tw.todayMax.toFixed(1) + '°C' : '-'}
                    </span>
                    <span>
                      🔻 {tw.todayMin !== null ? tw.todayMin.toFixed(1) + '°C' : '-'}
                    </span>
                    <span>
                      ▸ {tw.todayAvg !== null ? tw.todayAvg.toFixed(1) + '°C' : '-'}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
