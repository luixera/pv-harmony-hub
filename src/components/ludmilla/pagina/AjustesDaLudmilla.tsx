import { Lock } from 'lucide-react';
import { ListaDoQueFacoSozinha } from './FizSozinha';

/**
 * O meio dos Ajustes NESTA entrega (decisão 16): sem as chaves (entrega 4) e sem o resumo da manhã
 * (entrega 5). Só leitura: o que ela faz sozinha hoje, a linha fixa do e-mail e como ela avisa.
 */
export function AjustesDaLudmilla() {
  return (
    <div className="flex max-w-[760px] flex-col gap-6" data-vista="ajustes">
      <section className="flex flex-col gap-1">
        <h2 className="m-0 text-base font-extrabold">O que eu faço sozinha</h2>
        <p className="m-0 text-[13px] text-lm-suave">Hoje eu só anexo sozinha o documento que conferi. O resto vira cartão na fila, e alguém decide.</p>
        <ListaDoQueFacoSozinha />
      </section>
      <section className="flex items-start gap-3.5 border-t border-lm-linha pt-4">
        <Lock size={20} className="mt-0.5 shrink-0 text-lm-suave" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[15px] font-bold">Mandar e-mail para a concessionária</h2>
          <p className="m-0 text-[13px] leading-normal">Sem chave: cobrança e pedido de troca sempre saem pelo clique de alguém da equipe.</p>
        </div>
      </section>
      <section className="flex flex-col gap-1 border-t border-lm-linha pt-4">
        <h2 className="m-0 text-base font-extrabold">Como eu te aviso</h2>
        <p className="m-0 text-[13px] leading-normal">
          Pelo sino e pelo número ao lado do meu nome no menu do GD. O resumo da manhã, por WhatsApp e por e-mail, ainda não está ligado.
        </p>
      </section>
    </div>
  );
}
