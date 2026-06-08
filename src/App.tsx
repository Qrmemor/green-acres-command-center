import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { LoadingState } from '@/components/common/LoadingState';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AddEscalationPage } from '@/pages/AddEscalationPage';
import { AITriagePage } from '@/pages/AITriagePage';
import { AIMemoryPage } from '@/pages/AIMemoryPage';
import { BradleyReviewPage } from '@/pages/BradleyReviewPage';
import { CarlReviewPage } from '@/pages/CarlReviewPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { EscalationDetailPage } from '@/pages/EscalationDetailPage';
import { RealtimeCallTutorPage } from '@/pages/RealtimeCallTutorPage';
import { LoginPage } from '@/pages/LoginPage';
import { ReportGeneratorPage } from '@/pages/ReportGeneratorPage';
import { ResolvedEscalationsPage } from '@/pages/ResolvedEscalationsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import type { Role } from '@/types';

const ALL_ROLES: Role[] = ['carl', 'bradley', 'admin'];
const CARL_ADMIN_ONLY: Role[] = ['carl', 'admin'];
const BRADLEY_ALLOWED: Role[] = ['carl', 'bradley', 'admin'];

function ProtectedLayout({ children, allowedRoles = ALL_ROLES }: { children: ReactNode; allowedRoles?: Role[] }) {
  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={allowedRoles}>
        <AppLayout>{children}</AppLayout>
      </RoleGuard>
    </ProtectedRoute>
  );
}

function RoleGuard({ children, allowedRoles }: { children: ReactNode; allowedRoles: Role[] }) {
  const { profile } = useAuth();

  if (!profile) {
    return (
      <div className="page-shell">
        <LoadingState label="Loading user permissions..." />
      </div>
    );
  }

  if (!allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedLayout><DashboardPage /></ProtectedLayout>} />
          <Route path="/add" element={<ProtectedLayout allowedRoles={CARL_ADMIN_ONLY}><AddEscalationPage /></ProtectedLayout>} />
          <Route path="/ai-triage" element={<ProtectedLayout allowedRoles={CARL_ADMIN_ONLY}><AITriagePage /></ProtectedLayout>} />
          <Route path="/ai-memory" element={<ProtectedLayout allowedRoles={CARL_ADMIN_ONLY}><AIMemoryPage /></ProtectedLayout>} />
          <Route path="/realtime-call-tutor" element={<ProtectedLayout allowedRoles={CARL_ADMIN_ONLY}><RealtimeCallTutorPage /></ProtectedLayout>} />
          <Route path="/escalations/:id" element={<ProtectedLayout allowedRoles={CARL_ADMIN_ONLY}><EscalationDetailPage /></ProtectedLayout>} />
          <Route path="/bradley-review" element={<ProtectedLayout allowedRoles={BRADLEY_ALLOWED}><BradleyReviewPage /></ProtectedLayout>} />
          <Route path="/carl-review" element={<ProtectedLayout allowedRoles={CARL_ADMIN_ONLY}><CarlReviewPage /></ProtectedLayout>} />
          <Route path="/reports" element={<ProtectedLayout allowedRoles={CARL_ADMIN_ONLY}><ReportGeneratorPage /></ProtectedLayout>} />
          <Route path="/resolved" element={<ProtectedLayout allowedRoles={BRADLEY_ALLOWED}><ResolvedEscalationsPage /></ProtectedLayout>} />
          <Route path="/settings" element={<ProtectedLayout allowedRoles={CARL_ADMIN_ONLY}><SettingsPage /></ProtectedLayout>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
