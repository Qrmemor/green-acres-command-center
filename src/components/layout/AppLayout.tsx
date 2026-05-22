import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Brain,
  Database,
  CheckCircle2,
  FileText,
  Home,
  LogOut,
  PlusCircle,
  Settings,
  ShieldCheck,
  UserCheck
} from 'lucide-react';
import { APP_NAME } from '@/lib/constants';
import type { Role } from '@/types';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

type NavItem = {
  to: string;
  label: string;
  icon: typeof Home;
  roles: Role[];
};

const nav: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Home, roles: ['carl', 'bradley', 'admin'] },
  { to: '/add', label: 'Add Escalation', icon: PlusCircle, roles: ['carl', 'admin'] },
  { to: '/ai-triage', label: 'AI Triage', icon: Brain, roles: ['carl', 'admin'] },
  { to: '/ai-memory', label: 'AI Memory', icon: Database, roles: ['carl', 'admin'] },
  { to: '/bradley-review', label: 'Bradley Review', icon: ShieldCheck, roles: ['carl', 'bradley', 'admin'] },
  { to: '/carl-review', label: 'Carl Review', icon: UserCheck, roles: ['carl', 'admin'] },
  { to: '/reports', label: 'SOD / EOD', icon: FileText, roles: ['carl', 'admin'] },
  { to: '/resolved', label: 'Resolved', icon: CheckCircle2, roles: ['carl', 'bradley', 'admin'] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ['carl', 'admin'] }
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const currentRole = profile?.role ?? 'carl';
  const visibleNav = nav.filter((item) => item.roles.includes(currentRole));

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[280px_1fr]">
      <aside className="hidden border-r border-slate-200 bg-white/90 backdrop-blur lg:block">
        <div className="sticky top-0 flex h-screen flex-col p-5">
          <div className="mb-8 rounded-2xl bg-ga-950 p-4 text-white shadow-soft">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ga-500 font-bold">GA</div>
              <div>
                <p className="text-sm font-semibold">Green Acres</p>
                <p className="text-xs text-ga-100">Command Center</p>
              </div>
            </div>
          </div>

          <nav className="space-y-1">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                      isActive ? 'bg-ga-50 text-ga-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="mt-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Signed in</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900">{profile?.full_name ?? profile?.email ?? 'Operator'}</p>
            <p className="text-xs capitalize text-slate-500">{profile?.role ?? 'user'}</p>
            <Button variant="ghost" className="mt-3 w-full justify-start" leftIcon={<LogOut className="h-4 w-4" />} onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      <main>
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-950">{APP_NAME}</p>
              <p className="text-xs text-slate-500">Decision dashboard</p>
            </div>
            <Button variant="ghost" size="sm" leftIcon={<LogOut className="h-4 w-4" />} onClick={handleSignOut}>
              Exit
            </Button>
          </div>
          <div className="flex gap-2 overflow-x-auto px-4 pb-3">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold',
                      isActive ? 'bg-ga-700 text-white' : 'bg-slate-100 text-slate-600'
                    )
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
