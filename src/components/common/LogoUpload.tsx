import { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, ImagePlus, X } from 'lucide-react';

/**
 * Upload de logotipo para o bucket público tenant-logos.
 * O `folder` define a pasta-raiz do caminho (o RLS do bucket valida por ela):
 *  - logo do tenant  → folder = tenantId
 *  - logo da empresa → folder = `company/{companyId}`
 */
export function LogoUpload({
  value, folder, onChange, label = 'Logotipo',
}: {
  value: string | null | undefined;
  folder: string;
  onChange: (url: string | null) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Envie uma imagem (PNG, JPG ou SVG)'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('Logo muito grande (máx. 2 MB)'); return; }
    setEnviando(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${folder}/logo.${ext}`;
      const { error } = await supabase.storage.from('tenant-logos').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('tenant-logos').getPublicUrl(path);
      // cache-buster: o navegador não segura o logo antigo
      onChange(`${publicUrl}?v=${Date.now()}`);
    } catch (e) {
      console.error(e);
      toast.error('Não foi possível enviar o logo');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-lg border border-border bg-muted/40 flex items-center justify-center overflow-hidden flex-shrink-0">
          {value
            ? <img src={value} alt="logo" className="w-full h-full object-contain" />
            : <ImagePlus className="w-5 h-5 text-muted-foreground" />}
        </div>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={enviando}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/40 disabled:opacity-60"
          >
            {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
            {value ? 'Trocar logo' : 'Enviar logo'}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
            >
              <X className="w-3 h-3" /> Remover
            </button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) enviar(f); e.target.value = ''; }}
      />
    </div>
  );
}
