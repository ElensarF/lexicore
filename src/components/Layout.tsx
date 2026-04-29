import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useEffect } from 'react';
import { useStore } from '@/store';

export function Layout() {
  const theme = useStore((state) => state.theme);
  const location = useLocation();

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const pageTitle = (() => {
    const path = location.pathname;
    if (path.startsWith('/history')) return 'History';
    if (path.startsWith('/settings')) return 'Settings';
    return 'Translation';
  })();

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground selection:bg-primary/30">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950/50">
        <header className="h-14 shrink-0 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="h-full px-6 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-2 w-2 rounded-full bg-primary/60" />
              <div className="font-semibold tracking-tight truncate">LexiCore</div>
              <div className="text-xs text-muted-foreground truncate">{pageTitle}</div>
            </div>
            <div className="text-xs text-muted-foreground hidden sm:block">
              Local-first translation workspace
            </div>
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
