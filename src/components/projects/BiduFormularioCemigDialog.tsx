import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, CheckCircle2, Download, HardHat, Loader2 } from 'lucide-react';
import { TIPOS_SOLICITACAO_CEMIG, type RespostasCemig } from '@/utils/formFill/cemigForm';
import { avisosFormularioCemig, type ResultadoCemig } from '@/utils/formFill/gerarFormularioCemig';
import { baixarArquivo } from '@/utils/formFill/gerarFormularioEnel';
import type { Confianca, PropostaCemig } from '@/utils/bidu/proporRespostasCemig';
import { cn } from '@/lib/utils';

/**
 * O Bidu PROPÕE as três respostas do Formulário MicroGD e a pessoa confirma —
 * cada uma com o motivo e a confiança dele. Depois de gerar, o arquivo já está
 * nos documentos do projeto; aqui só sobra o download e os avisos.
 */

const CONFIANCA: Record<Confianca, { rotulo: string; cor: string }> = {
  alta:  { rotulo: 'confiança alta',  cor: 'bg-emerald-100 text-emerald-800' },
  media: { rotulo: 'confiança média', cor: 'bg-amber-100 text-amber-800' },
  baixa: { rotulo: 'confiança baixa', cor: 'bg-red-100 text-red-800' },
};

function Motivo({ motivo, confianca }: { motivo: string; confianca: Confianca }) {
  return (
    <p className="text-[11px] text-muted-foreground leading-snug">
      <span className={cn('inline-block rounded px-1.5 py-0.5 mr-1 text-[10px] font-semibold', CONFIANCA[confianca].cor)}>
        {CONFIANCA[confianca].rotulo}
      </span>
      {motivo}
    </p>
  );
}

export function BiduFormularioCemigDialog({
  open, onOpenChange, proposta, valores, gerando, resultado, onGerar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  proposta: PropostaCemig | null;
  valores: Record<string, string>;
  gerando: boolean;
  /** depois de gerar: o arquivo (para download) e os avisos */
  resultado: ResultadoCemig | null;
  onGerar: (r: RespostasCemig) => void;
}) {
  const [fastTrack, setFastTrack] = useState<'Sim' | 'Não'>('Não');
  const [gridZero, setGridZero] = useState<'Sim' | 'Não'>('Não');
  const [tipo, setTipo] = useState<string>(TIPOS_SOLICITACAO_CEMIG[1]);
  useEffect(() => {
    if (!proposta) return;
    setFastTrack(proposta.fastTrack.valor);
    setGridZero(proposta.gridZero.valor);
    setTipo(proposta.tipoSolicitacao.valor);
  }, [proposta, open]);

  const respostas: RespostasCemig = useMemo(() => ({ fastTrack, gridZero, tipoSolicitacao: tipo }), [fastTrack, gridZero, tipo]);
  // pendências que a CEMIG devolveria reprovadas — mostradas ANTES de gerar
  const pendencias = useMemo(() => avisosFormularioCemig(valores, respostas), [valores, respostas]);
  const mudou = (campo: keyof PropostaCemig, atual: string) => proposta && proposta[campo].valor !== atual;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardHat className="w-5 h-5 text-[#2D7A3A]" /> Bidu — Formulário MicroGD da CEMIG
          </DialogTitle>
          <DialogDescription>
            {resultado
              ? 'Pronto: o formulário está nos documentos do projeto e no card, com comentário do Bidu.'
              : 'Preenchi o formulário com os dados do projeto. Estas três respostas o cadastro não tem — propus, você confirma.'}
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4" /> {resultado.nomeArquivo}
            </div>
            {resultado.avisos.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1">
                {resultado.avisos.map((a, i) => (
                  <p key={i} className="text-xs text-amber-900 flex gap-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{a}</p>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
              <Button variant="cta" className="gap-2" onClick={() => baixarArquivo(resultado.bytes, resultado.nomeArquivo, resultado.mime)}>
                <Download className="w-4 h-4" /> Baixar o arquivo
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Tipo de solicitação {mudou('tipoSolicitacao', tipo) && <span className="text-[10px] text-muted-foreground">(ajustado por você)</span>}</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_SOLICITACAO_CEMIG.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                </SelectContent>
              </Select>
              {proposta && <Motivo motivo={proposta.tipoSolicitacao.motivo} confianca={proposta.tipoSolicitacao.confianca} />}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm">FAST TRACK</Label>
                <Select value={fastTrack} onValueChange={v => setFastTrack(v as 'Sim' | 'Não')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Não">Não</SelectItem><SelectItem value="Sim">Sim</SelectItem></SelectContent>
                </Select>
                {proposta && <Motivo motivo={proposta.fastTrack.motivo} confianca={proposta.fastTrack.confianca} />}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Grid Zero</Label>
                <Select value={gridZero} onValueChange={v => setGridZero(v as 'Sim' | 'Não')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Não">Não</SelectItem><SelectItem value="Sim">Sim</SelectItem></SelectContent>
                </Select>
                {proposta && <Motivo motivo={proposta.gridZero.motivo} confianca={proposta.gridZero.confianca} />}
              </div>
            </div>

            {pendencias.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1">
                <p className="text-xs font-semibold text-amber-900">A CEMIG devolveria reprovado:</p>
                {pendencias.map((a, i) => (
                  <p key={i} className="text-xs text-amber-900 flex gap-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{a}</p>
                ))}
                <p className="text-[11px] text-amber-800">Dá para gerar mesmo assim, mas o certo é corrigir o cadastro antes de enviar.</p>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={gerando}>Cancelar</Button>
              <Button variant="cta" className="gap-2" disabled={gerando} onClick={() => onGerar(respostas)}>
                {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardHat className="w-4 h-4" />}
                {gerando ? 'Preenchendo…' : 'Confirmar — gerar e anexar'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
