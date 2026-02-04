import { NavLink } from '@/components/NavLink';
import { FileText, BarChart3, Settings, Rocket, Target } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="h-14 border-b bg-background flex items-center px-6 gap-8 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-primary rounded">
            <Rocket className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-lg">ShipIt</span>
        </div>
        
        <nav className="flex items-center gap-1">
          <NavLink 
            to="/notes" 
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            activeClassName="bg-muted text-foreground"
          >
            <FileText className="h-4 w-4" />
            Notes
          </NavLink>
          <NavLink 
            to="/initiatives" 
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            activeClassName="bg-muted text-foreground"
          >
            <Target className="h-4 w-4" />
            Initiatives
          </NavLink>
          <NavLink 
            to="/report"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            activeClassName="bg-muted text-foreground"
          >
            <BarChart3 className="h-4 w-4" />
            Report
          </NavLink>
          <NavLink 
            to="/settings"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            activeClassName="bg-muted text-foreground"
          >
            <Settings className="h-4 w-4" />
            Settings
          </NavLink>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden bg-muted/30">
        {children}
      </main>
    </div>
  );
}
