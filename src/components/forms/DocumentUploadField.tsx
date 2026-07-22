import { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, X, Check, FileText, Camera, Image as ImageIcon } from 'lucide-react';
import { validateFile } from '@/lib/utils';
import { DocumentType } from '@/types';
import { useIsMobile } from '@/hooks/use-mobile';

interface DocumentUploadFieldProps {
  id: DocumentType;
  label: string;
  required?: boolean;
  multiple?: boolean;
  files: File[];
  onFilesChange: (files: File[]) => void;
  hasAlternativeInput?: boolean;
  alternativeLabel?: string;
  alternativeValue?: string;
  onAlternativeChange?: (value: string) => void;
  useAlternative?: boolean;
  onUseAlternativeChange?: (checked: boolean) => void;
  conditionalCheckbox?: boolean;
  conditionalLabel?: string;
  isConditionalActive?: boolean;
  onConditionalChange?: (checked: boolean) => void;
  /** Sobrescreve os tipos aceitos no seletor (padrão: imagem + PDF). */
  accept?: string;
}

// Compress image before upload (max 1200px wide, quality 0.8)
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const img = document.createElement('img');
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1200;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          resolve(blob ? new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }) : file);
        },
        'image/jpeg',
        0.8
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export function DocumentUploadField({
  id,
  label,
  required = false,
  multiple = false,
  files,
  onFilesChange,
  hasAlternativeInput,
  alternativeLabel,
  alternativeValue,
  onAlternativeChange,
  useAlternative,
  onUseAlternativeChange,
  conditionalCheckbox,
  conditionalLabel,
  isConditionalActive,
  onConditionalChange,
  accept,
}: DocumentUploadFieldProps) {
  const isMobile = useIsMobile();
  const [isDragging, setIsDragging] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const processFiles = async (incoming: File[]) => {
    for (const f of incoming) {
      const err = validateFile(f);
      if (err) { alert(err); return; }
    }
    const compressed = await Promise.all(incoming.map(compressImage));
    const newFiles = multiple ? [...files, ...compressed] : compressed.slice(0, 1);
    onFilesChange(newFiles);
    const urls = await Promise.all(
      newFiles.map(f => f.type.startsWith('image/') ? URL.createObjectURL(f) : '')
    );
    setPreviews(urls);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(Array.from(e.target.files));
  };
  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const isUploadDisabled = useAlternative || (conditionalCheckbox && !isConditionalActive);
  const isRequired = required && (!conditionalCheckbox || isConditionalActive) && !useAlternative;
  const hasFiles = files.length > 0;

  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 16 }}>

      {/* Header row: label + badges */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: '#1A1A1A', lineHeight: 1.4 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {hasFiles && !isUploadDisabled && (
            <span style={{
              background: '#D1FAE5', color: '#065F46', fontSize: 11, fontWeight: 700,
              padding: '2px 8px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <Check style={{ width: 11, height: 11 }} />
              {files.length} env.
            </span>
          )}
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
            background: isRequired ? '#FEF3C7' : '#F3F4F6',
            color: isRequired ? '#92400E' : '#6B7280',
          }}>
            {isRequired ? 'Obrigatório' : 'Opcional'}
          </span>
        </div>
      </div>

      {/* Conditional checkbox — beneficiaries card */}
      {conditionalCheckbox && (
        <div
          onClick={() => onConditionalChange?.(!isConditionalActive)}
          style={{
            background: isConditionalActive ? '#F0FFF8' : '#F8FFFE',
            border: `1.5px solid ${isConditionalActive ? '#2D6A4F' : '#9FE1CB'}`,
            borderRadius: 10, padding: '12px 14px', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          }}
        >
          <Checkbox
            id={`${id}-conditional`}
            checked={isConditionalActive}
            onCheckedChange={checked => onConditionalChange?.(!!checked)}
          />
          <label
            htmlFor={`${id}-conditional`}
            style={{
              fontSize: 14,
              color: isConditionalActive ? '#2D6A4F' : '#374151',
              fontWeight: isConditionalActive ? 600 : 400,
              cursor: 'pointer', flex: 1, userSelect: 'none',
            }}
          >
            {conditionalLabel}
          </label>
        </div>
      )}

      {/* Alternative input checkbox */}
      {hasAlternativeInput && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Checkbox
            id={`${id}-alternative`}
            checked={useAlternative}
            onCheckedChange={checked => onUseAlternativeChange?.(!!checked)}
          />
          <label
            htmlFor={`${id}-alternative`}
            style={{ fontSize: 13, color: '#6B7280', cursor: 'pointer', userSelect: 'none' }}
          >
            Não tenho a foto
          </label>
        </div>
      )}

      {/* Alternative text input */}
      {hasAlternativeInput && useAlternative && (
        <div style={{ marginBottom: 10 }}>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            color: '#6B7280', marginBottom: 6,
          }}>
            {alternativeLabel}
          </label>
          <Input
            placeholder="Ex: 63A"
            value={alternativeValue}
            onChange={e => onAlternativeChange?.(e.target.value)}
            style={{ height: 42 }}
          />
        </div>
      )}

      {/* Upload area */}
      {!isUploadDisabled && (
        <>
          <input
            ref={galleryInputRef}
            type="file"
            id={id}
            multiple={multiple}
            onChange={handleFileSelect}
            className="hidden"
            accept={accept ?? "image/*,.pdf"}
          />
          <input
            ref={cameraInputRef}
            type="file"
            multiple={multiple}
            onChange={handleFileSelect}
            className="hidden"
            accept="image/*"
            capture="environment"
          />

          {isMobile ? (
            /* Mobile: Camera + Gallery */
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                style={{
                  border: '1.5px dashed #F5A800', borderRadius: 10, padding: '14px 0',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  background: '#FFFBF0', cursor: 'pointer', color: '#92400E',
                  fontSize: 13, fontWeight: 500,
                }}
              >
                <Camera style={{ width: 22, height: 22, color: '#F5A800' }} />
                Câmera
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                style={{
                  border: '1.5px dashed #F5A800', borderRadius: 10, padding: '14px 0',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  background: '#FFFBF0', cursor: 'pointer', color: '#92400E',
                  fontSize: 13, fontWeight: 500,
                }}
              >
                <ImageIcon style={{ width: 22, height: 22, color: '#F5A800' }} />
                Galeria
              </button>
            </div>
          ) : (
            /* Desktop: drag-and-drop */
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                border: `2px dashed ${isDragging ? '#F5A800' : hasFiles ? '#2D6A4F' : '#F5A800'}`,
                borderRadius: 10, padding: '22px 16px', textAlign: 'center',
                background: isDragging ? '#FFFBF0' : hasFiles ? '#F0FFF8' : '#FAFAFA',
                cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              <label htmlFor={id} style={{ cursor: 'pointer', display: 'block' }}>
                <Upload style={{
                  width: 26, height: 26,
                  color: hasFiles ? '#2D6A4F' : '#F5A800',
                  margin: '0 auto 8px',
                }} />
                <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
                  Arraste ou{' '}
                  <span style={{ color: '#F5A800', fontWeight: 600 }}>clique para selecionar</span>
                </p>
                {multiple && (
                  <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                    Múltiplos arquivos permitidos
                  </p>
                )}
              </label>
            </div>
          )}

          {/* Image previews grid (mobile) */}
          {isMobile && previews.filter(Boolean).length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
              {previews.map((preview, index) =>
                preview ? (
                  <div
                    key={index}
                    style={{
                      position: 'relative', borderRadius: 10, overflow: 'hidden',
                      background: '#F3F4F6', aspectRatio: '1',
                    }}
                  >
                    <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      style={{
                        position: 'absolute', top: 4, right: 4,
                        width: 24, height: 24, background: '#EF4444',
                        borderRadius: '50%', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <X style={{ width: 12, height: 12, color: '#fff' }} />
                    </button>
                  </div>
                ) : null
              )}
            </div>
          )}

          {/* File list */}
          {files.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map((file, index) => {
                if (isMobile && previews[index]) return null;
                return (
                  <div
                    key={index}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '9px 12px', borderRadius: 8,
                      background: '#F0FFF8', border: '1px solid #A7F3D0',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <FileText style={{ width: 15, height: 15, color: '#2D6A4F', flexShrink: 0 }} />
                      <span style={{
                        fontSize: 13, color: '#1A1A1A',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {file.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 4, display: 'flex', alignItems: 'center',
                        flexShrink: 0, color: '#EF4444',
                      }}
                    >
                      <X style={{ width: 15, height: 15 }} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
