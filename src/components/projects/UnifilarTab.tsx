import { useMemo, useState } from 'react';
import { Loader2, FlaskConical, Download, FileImage } from 'lucide-react';
import { ProjectWithDetails } from '@/hooks/useProjects';
import { buildTechnicalJsonFromProject } from '@/utils/cadEngine/buildTechnicalJson';
import { buildUnifilarScene } from '@/utils/cadEngine/layout';
import { sceneToSvg } from '@/utils/cadEngine/exportSvg';
import { sceneToPdfBlob } from '@/utils/cadEngine/exportPdf';
import { sanitizeFileName } from '@/lib/utils';

/**
 * Diagrama Unifilar (alpha) — visível apenas para o master (ver gate em
 * ProjectModal.tsx). Fatia vertical do CAD Engine: JSON técnico do próprio
 * projeto → layout fixo em fileira → Scene IR → SVG (prévia) / PDF (download).
 * Sem motor de roteamento e sem calibração fina de símbolos ainda — ver
 * DIAGRAMA UNIFILAR/cad-engine-arquitetura.md para o plano completo.
 */
export function UnifilarTab({ project }: { project: ProjectWithDetails }) {
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const json = useMemo(() => buildTechnicalJsonFromProject(project), [project]);
  const scene = useMemo(() => buildUnifilarScene(json), [json]);
  const svg = useMemo(() => sceneToSvg(scene), [scene]);

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSvg = () => {
    download(new Blob([svg], { type: 'image/svg+xml' }), `unifilar_${sanitizeFileName(project.code)}.svg`);
  };

  const handleDownloadPdf = async () => {
    setGeneratingPdf(true);
    try {
      const blob = await sceneToPdfBlob(scene);
      download(blob, `unifilar_${sanitizeFileName(project.code)}.pdf`);
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, background: '#FFF7E6',
        border: '1px solid #FDE4A8', borderRadius: 10, padding: '10px 14px', marginBottom: 18,
      }}>
        <FlaskConical size={15} style={{ color: '#854F0B', flexShrink: 0 }} />
        <p style={{ fontSize: 12, color: '#854F0B', margin: 0 }}>
          <strong>Alpha interno (só master).</strong> Diagrama esquemático gerado a partir dos
          dados já cadastrados do projeto, com layout fixo e símbolos aproximados —
          ainda não substitui um unifilar assinado por responsável técnico.
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Prévia</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleDownloadSvg}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
              borderRadius: 8, border: '1px solid #E0E0E0', background: '#fff',
              color: '#333', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <FileImage size={13} /> Baixar SVG
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={generatingPdf}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px',
              borderRadius: 8, border: 'none', background: '#F5A800',
              color: '#1A1A1A', fontSize: 12, fontWeight: 700,
              cursor: generatingPdf ? 'not-allowed' : 'pointer', opacity: generatingPdf ? 0.7 : 1,
            }}
          >
            {generatingPdf ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Baixar PDF
          </button>
        </div>
      </div>

      <div style={{
        background: '#F4F4F4', borderRadius: 12, padding: 20,
        display: 'flex', justifyContent: 'center', overflowX: 'auto',
      }}>
        <div
          style={{ background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.12)', flexShrink: 0 }}
          // eslint-disable-next-line react/no-danger -- SVG gerado internamente (sceneToSvg), sem dado de usuário injetado como markup
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}
