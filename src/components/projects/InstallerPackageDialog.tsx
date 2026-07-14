import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ProjectWithDetails } from '@/hooks/useProjects';
import { sanitizeFileName } from '@/lib/utils';
import { logEvent } from '@/lib/tracking';
import { useInstallerPackage } from '@/hooks/useInstallerPackage';
import {
  resolveInstallerPackage, buildInstallerZipAsync, loadCandidateBlob,
  ResolvedEntry,
} from '@/utils/installerPackage';
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Download, Package, ImageOff } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  project: ProjectWithDetails;
}

export function InstallerPackageDialog({ open, onClose, project }: Props) {
  const { data: items = [], isLoading: loadingItems } = useInstallerPackage(project.concessionaire_id ?? undefined);
  const [entries, setEntries] = useState<ResolvedEntry[]>([]);
  const [chosen, setChosen] = useState<Record<number, string>>({}); // index → candidate path
  const [resolving, setResolving] = useState(false);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    if (!open || loadingItems) return;
    if (items.length === 0) { setEntries([]); return; }
    let cancelled = false;
    (async () => {
      setResolving(true);
      try {
        const resolved = await resolveInstallerPackage(project, items);
        if (!cancelled) setEntries(resolved);
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, loadingItems, items, project]);

  const handleDownload = async () => {
    setBuilding(true);
    try {
      // aplica as fotos reaproveitadas escolhidas (já convertidas em PDF)
      const finalEntries: ResolvedEntry[] = [];
      for (const e of entries) {
        if (e.status === 'reusable_missing' && chosen[e.index]) {
          const res = await loadCandidateBlob(chosen[e.index]);
          if (res) {
            finalEntries.push({ ...e, blob: res.blob, ext: res.ext, status: 'ok' });
            continue;
          }
        }
        finalEntries.push(e);
      }

      const withFile = finalEntries.filter(e => e.blob);
      if (withFile.length === 0) { toast.error('Nenhum documento disponível para o pacote'); return; }

      const zip = await buildInstallerZipAsync(project, withFile);
      const url = URL.createObjectURL(zip);
      // Nome do ZIP: PACOTE + código + cliente + empresa
      const holder = project.generalData?.holder_name ?? '';
      const company = project.companyName ?? '';
      const zipName = sanitizeFileName(`PACOTE ${project.code} ${holder} ${company}`.toUpperCase()) + '.zip';
      const a = document.createElement('a');
      a.href = url; a.download = zipName;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);

      logEvent('package_download', { project_id: project.id, code: project.code, items: withFile.length });
      const missing = finalEntries.filter(e => !e.blob);
      if (missing.length > 0) {
        toast.warning(`Pacote baixado. Faltaram: ${missing.map(m => m.label).join(', ')}`);
      } else {
        toast.success('Pacote instalador baixado');
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast.error('Erro ao montar o pacote');
    } finally {
      setBuilding(false);
    }
  };

  const StatusIcon = ({ e }: { e: ResolvedEntry }) => {
    if (e.status === 'ok') return <CheckCircle2 className="w-4 h-4 text-success" />;
    if (e.status === 'reusable_missing') return <ImageOff className="w-4 h-4 text-warning" />;
    return e.required ? <XCircle className="w-4 h-4 text-destructive" /> : <AlertTriangle className="w-4 h-4 text-muted-foreground" />;
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Package className="w-5 h-5 text-primary" /> Baixar pacote instalador</DialogTitle>
          <DialogDescription>
            {project.concessionaireName ? `Documentos para ${project.concessionaireName}, na ordem configurada.` : 'Documentos organizados para a concessionária.'}
          </DialogDescription>
        </DialogHeader>

        {loadingItems || resolving ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Montando o pacote…</p>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Nenhum pacote configurado para esta concessionária. Configure em <strong>Concessionárias → Pacote Projetista</strong>.
          </p>
        ) : (
          <div className="space-y-2 py-2">
            {entries.map(e => (
              <div key={e.index} className="flex items-start gap-3 p-2.5 rounded-lg border border-border">
                <span className="text-xs font-mono text-muted-foreground pt-0.5 w-5 text-center">{e.index}</span>
                <StatusIcon e={e} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{e.label}</p>
                  {e.status === 'ok' && <p className="text-xs text-muted-foreground">Pronto (.{e.ext})</p>}
                  {e.status === 'missing' && <p className="text-xs text-muted-foreground">{e.required ? 'Faltando (obrigatório)' : 'Faltando (opcional)'}</p>}
                  {e.status === 'reusable_missing' && (
                    <div className="mt-1.5 space-y-1.5">
                      <p className="text-xs text-warning">Não enviada. Reaproveitar de outro projeto (mesmo disjuntor e fase)?</p>
                      {e.candidates && e.candidates.length > 0 ? (
                        <Select value={chosen[e.index] ?? ''} onValueChange={v => setChosen(c => ({ ...c, [e.index]: v }))}>
                          <SelectTrigger className="h-8"><SelectValue placeholder="Escolher foto de outro projeto" /></SelectTrigger>
                          <SelectContent>
                            {e.candidates.map(c => (
                              <SelectItem key={c.path} value={c.path}>{c.projectCode} — {c.holder}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-xs text-muted-foreground">Nenhum projeto compatível encontrado.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button variant="cta" onClick={handleDownload} disabled={building || items.length === 0 || resolving}>
            {building ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Baixar .zip
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
