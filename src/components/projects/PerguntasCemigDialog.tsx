import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TIPOS_SOLICITACAO_CEMIG, RespostasCemig } from '@/utils/formFill/cemigForm';

/**
 * As perguntas que o formulário da CEMIG faz e o cadastro do projeto não
 * responde. Feitas na hora de gerar (decisão do usuário, set/2026) porque
 * variam de projeto para projeto e não valia criar campo para elas.
 *
 * Foram exatamente estas que travaram a automação da CEMIG por meses: sem
 * saber o FAST TRACK e o tipo de solicitação, não havia como preencher a
 * planilha inteira sem chutar.
 */
export function PerguntasCemigDialog({
  open, onOpenChange, onConfirmar, gerando,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirmar: (r: RespostasCemig) => void;
  gerando: boolean;
}) {
  const [fastTrack, setFastTrack] = useState<'Sim' | 'Não'>('Não');
  const [gridZero, setGridZero] = useState<'Sim' | 'Não'>('Não');
  const [tipo, setTipo] = useState<string>(TIPOS_SOLICITACAO_CEMIG[1]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Formulário MicroGD — CEMIG</DialogTitle>
          <DialogDescription>
            Três respostas que o formulário exige e não estão no cadastro do projeto.
            O resto é preenchido com os dados que já temos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm">Tipo de solicitação</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS_SOLICITACAO_CEMIG.map(t => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              O mais comum é “UC Existente SEM Alteração de Potência Disponibilizada”.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm">FAST TRACK</Label>
              <Select value={fastTrack} onValueChange={v => setFastTrack(v as 'Sim' | 'Não')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Não">Não</SelectItem>
                  <SelectItem value="Sim">Sim</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Enquadramento no inciso III do art. 73-A.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Grid Zero</Label>
              <Select value={gridZero} onValueChange={v => setGridZero(v as 'Sim' | 'Não')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Não">Não</SelectItem>
                  <SelectItem value="Sim">Sim</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                O empreendimento injeta zero na rede?
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant="cta"
            disabled={gerando}
            onClick={() => onConfirmar({ fastTrack, gridZero, tipoSolicitacao: tipo })}
          >
            {gerando ? 'Gerando…' : 'Gerar formulário'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
