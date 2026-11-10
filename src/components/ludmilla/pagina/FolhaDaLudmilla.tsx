import type { ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * A folha da Ludmilla: o detalhe e a ficha fora do computador grande, e o menu no celular. Não modal
 * (o aviso com "Desfazer", fora dela, continua clicável — como a folha de hoje). O "X" do Sheet some:
 * quem fecha é o cabeçalho petróleo ("‹ Agora" ou "Fechar"). A classe `.ludmilla-mundo` vai no
 * conteúdo porque o Radix desenha a folha fora da página (portal).
 */
export function FolhaDaLudmilla({ aberta, onFechar, lado = 'right', titulo, cabecalho, children, onCloseAutoFocus }: {
  aberta: boolean;
  onFechar: () => void;
  lado?: 'left' | 'right';
  /** para o leitor de tela */
  titulo: string;
  cabecalho: ReactNode;
  children: ReactNode;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  return (
    <Sheet open={aberta} modal={false} onOpenChange={o => { if (!o) onFechar(); }}>
      <SheetContent
        side={lado}
        className={cn('ludmilla-mundo flex w-full max-w-none flex-col gap-0 p-0 [&>button:last-child]:hidden',
          lado === 'right' ? 'sm:max-w-xl' : 'sm:max-w-sm')}
        onInteractOutside={e => {
          const alvo = e.target as Element | null;
          if (alvo?.closest?.('[data-sonner-toaster]')) e.preventDefault();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SheetTitle className="sr-only">{titulo}</SheetTitle>
        <SheetDescription className="sr-only">{titulo}</SheetDescription>
        <div className="lm-sobre-petroleo flex shrink-0 items-center justify-between gap-2 bg-lm-petroleo px-3 py-2 text-white">
          {cabecalho}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
