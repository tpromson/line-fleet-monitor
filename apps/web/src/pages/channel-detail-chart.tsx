import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'

interface DailyUsageChartProps {
  data: Array<{ checked_at: string; quota_used: number }>
}

export default function DailyUsageChart({ data }: DailyUsageChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="checked_at" fontSize={11} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} />
        <YAxis fontSize={12} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={45} />
        <Tooltip
          cursor={{ fill: '#f1f5f9' }}
          contentStyle={{ background: '#fff', border: 'none', borderRadius: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 13, padding: '8px 12px' }}
          formatter={(value: number) => [value.toLocaleString(), 'Quota Used']}
        />
        <Bar dataKey="quota_used" radius={[4, 4, 0, 0]} maxBarSize={32}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={
                entry.quota_used >= 80 ? '#f43f5e' :
                entry.quota_used >= 50 ? '#f59e0b' :
                '#10b981'
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
