import { NavLink } from '@/components/NavLink';
import {
  FileText,
  Settings,
  Rocket,
  Target,
  LayoutDashboard,
  User,
  Sun,
  Moon,
} from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { to: '/notes', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/initiatives', icon: Target, label: 'Projects' },
  { to: '/report', icon: FileText, label: 'Reports' },
];

export function Layout({ children }: LayoutProps) {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="h-screen flex flex-row">
      {/* Sidebar */}
      <aside className="w-[252px] shrink-0 bg-sidebar flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="p-1.5 bg-coral rounded">
            <Rocket className="h-4 w-4 text-white" />
          </div>
          <span className="font-bold text-lg text-sidebar-primary">ShipIt</span>
        </div>

        {/* Primary navigation */}
        <nav className="flex flex-col gap-0.5 px-3 mt-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User profile + Settings */}
        <div className="border-t border-sidebar-border px-3 py-3 flex flex-col gap-0.5">
          <NavLink
            to="/settings"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
          >
            <Settings className="h-4 w-4" />
            Settings
          </NavLink>
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-sidebar-muted">
            <User className="h-4 w-4" />
            <span>Profile</span>
          </div>
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors w-full"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden bg-background">
        {children}
      </main>
    </div>
  );
}
