import { useStore } from '@/store';
import { motion } from 'framer-motion';
import { Search, Star, Trash2, Clock, Globe2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function History() {
  const { history, toggleFavorite, removeHistoryItem, clearHistory } = useStore();
  const [search, setSearch] = useState('');

  const filteredHistory = history.filter(
    (item) =>
      item.sourceText.toLowerCase().includes(search.toLowerCase()) ||
      item.translatedText.toLowerCase().includes(search.toLowerCase())
  );

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 },
    },
  };

  const itemAnim = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
  };

  return (
    <div className="flex-1 flex flex-col h-full max-w-4xl mx-auto w-full p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Geçmiş & Favoriler</h1>
          <p className="text-muted-foreground mt-1">Önceki çevirilerinizi bulun ve yönetin.</p>
        </div>
        <Button variant="outline" onClick={clearHistory} className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20 rounded-full">
          Geçmişi Temizle
        </Button>
      </div>

      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Çevirilerde ara..."
          className="w-full pl-12 h-14 rounded-2xl bg-card border-border/50 text-lg shadow-sm focus-visible:ring-primary/20"
        />
      </div>

      <ScrollArea className="flex-1 -mx-4 px-4 pb-8">
        {filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Globe2 className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">Çeviri bulunamadı.</p>
          </div>
        ) : (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="space-y-4"
          >
            {filteredHistory.map((item) => (
              <motion.div
                key={item.id}
                variants={itemAnim}
                className="group flex flex-col gap-3 p-6 bg-card rounded-3xl border border-border/50 shadow-sm hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-1.5">
                    <p className="text-sm font-medium text-muted-foreground/80 flex items-center gap-2">
                      <span className="uppercase tracking-wider">{item.sourceLang}</span>
                      <span className="w-1 h-1 rounded-full bg-border" />
                      <span className="uppercase tracking-wider text-primary/80">{item.targetLang}</span>
                    </p>
                    <p className="text-lg leading-snug">{item.sourceText}</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
                      onClick={() => toggleFavorite(item.id)}
                    >
                      <Star
                        className={`w-4 h-4 ${item.isFavorite ? 'fill-amber-500 text-amber-500' : ''}`}
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => removeHistoryItem(item.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                
                <div className="h-px w-full bg-border/40" />
                
                <div className="flex items-end justify-between gap-4">
                  <p className="text-lg font-medium text-primary flex-1 leading-snug">
                    {item.translatedText}
                  </p>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                    <Clock className="w-3 h-3" />
                    {new Date(item.createdAt).toLocaleDateString('tr-TR', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </ScrollArea>
    </div>
  );
}
