import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { LoadingState } from '@/components/common/LoadingState';
import { useAuth } from '@/context/AuthContext';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <div className="page-shell"><LoadingState label="Checking session..." /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
