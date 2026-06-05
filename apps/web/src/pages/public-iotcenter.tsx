import { useEffect, useState, useCallback } from 'react'
import { Thermometer, Snowflake, LineChartIcon, ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Link, useParams } from 'react-router-dom'
import {
  LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts'
import { useVisibilityPoll } from '@/hooks/use-visibility-poll'

type DateRange = '1d' | '3d' | '7d' | '30d'

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
  showChart: boolean
}

interface TempLog {
  timestamp: string
  temperature: number
  humidity?: number
}

const DATE_LABELS: Record<DateRange, string> = {
  '1d': 'Today',
  '3d': '3 Days',
  '7d': '7 Days',
  '30d': '30 Days',
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
  const { orgSlug } = useParams<{ orgSlug?: string }>()
  const [widgets, setWidgets] = useState<TempWidget[]>([])
  const [orgName, setOrgName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedWidget, setSelectedWidget] = useState<TempWidget | null>(null)
  const [chartRange, setChartRange] = useState<DateRange>('1d')
  const [chartData, setChartData] = useState<TempLog[]>([])
  const [chartLoading, setChartLoading] = useState(false)

  const baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'
  const tempEndpoint = orgSlug
    ? `${baseUrl}/public/iotcenter/${orgSlug}/temperature`
    : `${baseUrl}/public/iotcenter/temperature`

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(tempEndpoint)
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        setWidgets(data.widgets || [])
        setOrgName(data.orgName || null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [tempEndpoint])

  const chartEndpoint = useCallback((sourceId: string, range: DateRange) => {
    return orgSlug
      ? `${baseUrl}/public/iotcenter/${orgSlug}/temperature/${sourceId}/chart?range=${range}`
      : `${baseUrl}/public/iotcenter/temperature/${sourceId}/chart?range=${range}`
  }, [orgSlug, baseUrl])

  const loadChart = useCallback(async (sourceId: string, range: DateRange) => {
    setChartLoading(true)
    try {
      const res = await fetch(chartEndpoint(sourceId, range))
      if (res.ok) {
        const data = await res.json()
        setChartData(data.data || [])
      } else {
        setChartData([])
      }
    } catch {
      setChartData([])
    } finally {
      setChartLoading(false)
    }
  }, [chartEndpoint])

  useEffect(() => {
    if (!selectedWidget) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load chart data when widget changes
    loadChart(selectedWidget.sourceId, chartRange)
  }, [selectedWidget, chartRange, loadChart])
  useVisibilityPoll(() => {
    if (selectedWidget) loadChart(selectedWidget.sourceId, chartRange)
  }, 60000)

  const openChart = (widget: TempWidget) => {
    setSelectedWidget(widget)
    setChartRange('1d')
    setChartData([])
  }

  const closeChart = () => {
    setSelectedWidget(null)
    setChartData([])
  }

  const hasHumidity = chartData.some((d) => d.humidity !== undefined)

  const chartMax = chartData.length > 0
    ? Math.max(...chartData.map((d) => d.temperature)) + 5
    : 20

  return (
    <div className="min-h-screen bg-muted/50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Thermometer className="w-6 h-6" />
            {orgName ? `${orgName} - Temperature Overview` : 'Temperature Overview'}
          </h1>
          <Link to="/login" className="text-sm text-muted-foreground hover:text-primary">
            Login to manage
          </Link>
        </div>

        {selectedWidget ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={closeChart}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <h2 className="text-lg font-semibold">{selectedWidget.sourceName}</h2>
              <Badge variant="outline" className="text-xs">
                {selectedWidget.deviceStatus}
              </Badge>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Temperature Chart</CardTitle>
                  <div className="flex items-center gap-1">
                    {(Object.keys(DATE_LABELS) as DateRange[]).map((range) => (
                      <Button
                        key={range}
                        variant={chartRange === range ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setChartRange(range)}
                      >
                        {DATE_LABELS[range]}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {chartLoading ? (
                  <Skeleton className="h-[400px] w-full" />
                ) : chartData.length === 0 ? (
                  <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                    No data for this period
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="tempGradientPublic" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <ReferenceArea
                        y1={selectedWidget.threshold}
                        y2={chartMax}
                        fill="#fef2f2"
                        stroke="none"
                      />
                      <XAxis
                        dataKey="timestamp"
                        fontSize={11}
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        axisLine={{ stroke: '#e2e8f0' }}
                        tickLine={false}
                        interval="preserveStartEnd"
                        height={36}
                      />
                      <YAxis
                        fontSize={12}
                        unit="°C"
                        domain={['auto', 'auto']}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                        width={45}
                      />
                      {hasHumidity && (
                        <YAxis
                          yAxisId="humidity"
                          orientation="right"
                          unit="%"
                          domain={[0, 100]}
                          tick={{ fontSize: 11, fill: '#06b6d4' }}
                          axisLine={false}
                          tickLine={false}
                          width={45}
                        />
                      )}
                      <Tooltip
                        cursor={{ stroke: '#94a3b8', strokeDasharray: '4 4', strokeWidth: 1 }}
                        contentStyle={{
                          background: '#fff',
                          border: 'none',
                          borderRadius: 10,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                          fontSize: 13,
                          padding: '8px 12px',
                        }}
                        formatter={(value: number, name: string) => [
                          value.toFixed(1) + (name === 'humidity' ? '%' : '°C'),
                          name === 'humidity' ? 'Humidity' : 'Temperature',
                        ]}
                        labelFormatter={(label: string) => label}
                      />
                      <ReferenceLine
                        y={selectedWidget.threshold}
                        stroke="#ef4444"
                        strokeDasharray="6 3"
                        strokeWidth={1.5}
                        label={{
                          value: `${selectedWidget.threshold}°C`,
                          position: 'insideTopRight',
                          fontSize: 11,
                          fill: '#ef4444',
                          fontWeight: 600,
                        }}
                      />
                      <Area
                        type="linear"
                        dataKey="temperature"
                        fill="url(#tempGradientPublic)"
                        stroke="none"
                      />
                      <Line
                        type="linear"
                        dataKey="temperature"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 5, fill: '#ef4444', stroke: '#fff', strokeWidth: 2 }}
                      />
                      {hasHumidity && (
                        <Line
                          yAxisId="humidity"
                          type="linear"
                          dataKey="humidity"
                          stroke="#06b6d4"
                          strokeWidth={1.5}
                          dot={false}
                          activeDot={{ r: 4, fill: '#06b6d4', stroke: '#fff', strokeWidth: 2 }}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Current</p>
                  <p className={`text-xl font-bold ${getTempColor(selectedWidget.currentTemp, selectedWidget.threshold)}`}>
                    {selectedWidget.currentTemp !== null ? selectedWidget.currentTemp.toFixed(1) + '°C' : '-'}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Max Today</p>
                  <p className="text-xl font-bold text-rose-500">
                    {selectedWidget.todayMax !== null ? selectedWidget.todayMax.toFixed(1) + '°C' : '-'}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Min Today</p>
                  <p className="text-xl font-bold text-sky-500">
                    {selectedWidget.todayMin !== null ? selectedWidget.todayMin.toFixed(1) + '°C' : '-'}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Avg Today</p>
                  <p className="text-xl font-bold text-muted-foreground">
                    {selectedWidget.todayAvg !== null ? selectedWidget.todayAvg.toFixed(1) + '°C' : '-'}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <>
            {loading ? (
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
            ) : error ? (
              <Card>
                <CardContent className="py-6 text-center text-destructive">{error}</CardContent>
              </Card>
            ) : widgets.length === 0 ? (
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
                      (tw.showChart ? 'cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all ' : '') +
                      (tw.currentTemp !== null && tw.currentTemp >= tw.threshold
                        ? 'ring-1 ring-rose-200/70'
                        : tw.currentTemp !== null && tw.currentTemp >= tw.threshold * 0.9
                        ? 'ring-1 ring-amber-200/70'
                        : tw.currentTemp !== null && tw.currentTemp > 0
                        ? 'ring-1 ring-emerald-200/50'
                        : '')
                    }
                    onClick={() => tw.showChart && openChart(tw)}
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
                        {tw.showChart && (
                          <LineChartIcon className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
                        )}
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
          </>
        )}
      </div>
    </div>
  )
}