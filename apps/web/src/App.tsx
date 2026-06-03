import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/layout'
import { ProtectedRoute } from '@/components/protected-route'
import { LoginPage } from '@/pages/login'
import { ResetPasswordPage } from '@/pages/reset-password'
import { DashboardPage } from '@/pages/dashboard'
import { ProviderDetailPage } from '@/pages/provider-detail'
import { ChannelDetailPage } from '@/pages/channel-detail'
import { SetupPage } from '@/pages/setup'
import { Toaster } from '@/components/ui/sonner'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/providers/:id" element={<ProviderDetailPage />} />
                  <Route path="/channels/:id" element={<ChannelDetailPage />} />
                  <Route path="/setup" element={<SetupPage />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
