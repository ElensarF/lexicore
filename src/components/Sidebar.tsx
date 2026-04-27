import { NavLink } from 'react-router-dom';
import { Home, History, Settings, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const navItems = [
  { path: '/', icon: Home, label: 'Ana Ekran' },
  { path: '/history', icon: History, label: 'Geçmiş & Favoriler' },
  { path: '/settings', icon: Settings, label: 'Ayarlar' },
];

export function Sidebar() {
  return (
    <div className="w-16 h-screen border-r border-border bg-card flex flex-col items-center py-6 shrink-0 z-10">
      <div className="mb-10">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Zap className="w-5 h-5 text-primary" />
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-4 w-full px-2">
        <TooltipProvider delay={0}>
          {navItems.map((item) => (
            <Tooltip key={item.path}>
              <TooltipTrigger render={
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    cn(
                      'w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-200 group relative',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )
                  }
                />
              }>
                <item.icon className="w-5 h-5" />
              </TooltipTrigger>
              <TooltipContent side="right" className="ml-2">
                <p>{item.label}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </nav>
    </div>
  );
}
