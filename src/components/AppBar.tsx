import { NavLink, useLocation } from 'react-router-dom';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ChevronDown, SlidersHorizontal, User } from 'lucide-react';

const LANGUAGES = {
  auto: 'Dili algıla',
  en: 'İngilizce (ABD)',
  tr: 'Türkçe',
  de: 'Almanca',
  fr: 'Fransızca',
  es: 'İspanyolca',
  it: 'İtalyanca',
  zh: 'Çince (Basit)',
  ja: 'Japonca',
  ko: 'Korece',
  ru: 'Rusça',
  ar: 'Arapça',
  pt: 'Portekizce',
  nl: 'Felemenkçe',
  pl: 'Lehçe',
  el: 'Yunanca',
  hi: 'Hintçe',
  sv: 'İsveççe',
  da: 'Danca',
  fi: 'Fince',
};

const tabs = [
  { key: 'text', label: 'Metin', path: '/' },
  { key: 'history', label: 'Geçmiş', path: '/history' },
];

export function AppBar() {
  const location = useLocation();
  const {
    sourceLang,
    targetLang,
    setSourceLang,
    setTargetLang,
  } = useStore();

  const showLangSelectors = location.pathname === '/';

  return (
    <header className="h-14 shrink-0 border-b border-[#2B2D31] bg-[#1E1F22] text-[#D7DCE2]">
      <div className="h-full px-4 flex items-center gap-4">
        <div className="flex items-center gap-2 min-w-[140px]">
          <div className="h-2 w-2 rounded-full bg-[#4C8DFF]" />
          <div className="font-semibold tracking-tight text-sm">LexiCore</div>
        </div>

        <nav className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive = tab.path ? location.pathname === tab.path : false;
            const baseClass = cn(
              'h-9 px-3 rounded-md text-sm font-medium transition-colors',
              'text-[#AAB2BD] hover:text-[#D7DCE2] hover:bg-[#2B2D31]',
              isActive && 'bg-[#2B5BFF]/20 text-[#D7DCE2] ring-1 ring-inset ring-[#2B5BFF]/40'
            );

            if (tab.disabled) {
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={cn(baseClass, 'opacity-50 cursor-not-allowed')}
                  disabled
                >
                  {tab.label}
                </button>
              );
            }

            return (
              <NavLink key={tab.key} to={tab.path!} className={baseClass}>
                {tab.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="flex-1" />

        {showLangSelectors && (
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    className="h-9 px-3 rounded-md bg-[#2B2D31] hover:bg-[#34373C] text-[#D7DCE2]"
                  />
                }
              >
                <span className="text-sm">{LANGUAGES[sourceLang as keyof typeof LANGUAGES] ?? sourceLang}</span>
                <ChevronDown className="ml-2 h-4 w-4 opacity-80" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 max-h-[320px] overflow-y-auto">
                {Object.entries(LANGUAGES).map(([code, name]) => (
                  <DropdownMenuItem key={code} onClick={() => setSourceLang(code)}>
                    {name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    className="h-9 px-3 rounded-md bg-[#2B2D31] hover:bg-[#34373C] text-[#D7DCE2]"
                  />
                }
              >
                <span className="text-sm">{LANGUAGES[targetLang as keyof typeof LANGUAGES] ?? targetLang}</span>
                <ChevronDown className="ml-2 h-4 w-4 opacity-80" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 max-h-[320px] overflow-y-auto">
                {Object.entries(LANGUAGES)
                  .filter(([code]) => code !== 'auto')
                  .map(([code, name]) => (
                    <DropdownMenuItem key={code} onClick={() => setTargetLang(code)}>
                      {name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-md border-[#34373C] bg-transparent text-[#D7DCE2] hover:bg-[#2B2D31]"
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Araç çubuğu
          </Button>
          <button
            type="button"
            className="h-9 w-9 rounded-full bg-[#2B2D31] hover:bg-[#34373C] grid place-items-center"
            aria-label="Profile"
          >
            <User className="h-4 w-4 text-[#AAB2BD]" />
          </button>
        </div>
      </div>
    </header>
  );
}
