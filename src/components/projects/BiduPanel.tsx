import { useState, useRef, useEffect } from 'react';
import { HardHat, Send, Loader2, GraduationCap, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import {
  useBiduMessages, useBiduSkills, useFalarComBidu, useDeleteBiduSkill,
} from '@/hooks/useBidu';

/**
 * Painel do ENGENHEIRO BIDU dentro do projeto.
 *
 * É por aqui que se conversa com ele e que ele APRENDE: uma mensagem que
 * estabeleça uma regra ("na CEMIG, sempre...") vira habilidade gravada no
 * banco e passa a valer nas próximas conversas — o "mando lá e ele aprende"
 * que o usuário pediu.
 *
 * As funções pesadas (preencher o formulário da CEMIG, montar a prancha de
 * situação) entram aqui como botões nas próximas etapas do escopo.
 */
export function BiduPanel({ projectId }: { projectId?: string }) {
  const { data: mensagens = [], isLoading } = useBiduMessages(projectId);
  const { data: habilidades = [] } = useBiduSkills();
  const falar = useFalarComBidu(projectId);
  const apagarHabilidade = useDeleteBiduSkill();

  const [texto, setTexto] = useState('');
  const [verHabilidades, setVerHabilidades] = useState(false);
  const fimDaLista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fimDaLista.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens.length, falar.isPending]);

  const enviar = () => {
    const msg = texto.trim();
    if (!msg || falar.isPending) return;
    setTexto('');
    falar.mutate({
      mensagem: msg,
      historico: mensagens.map(m => ({ autor: m.autor, conteudo: m.conteudo })),
    });
  };

  return (
    <div style={{ border: '1px solid #DDE7DD', borderRadius: 10, background: '#FBFDFB', overflow: 'hidden' }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: '#EFF6EF', borderBottom: '1px solid #DDE7DD' }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#2D7A3A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <HardHat size={14} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12.5, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Engenheiro Bidu</p>
          <p style={{ fontSize: 10.5, color: '#6B7280', margin: 0 }}>
            Projetista automático · {habilidades.length} habilidade{habilidades.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          onClick={() => setVerHabilidades(v => !v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 7, border: '1px solid #C9DCC9', background: '#fff', color: '#2D7A3A', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
        >
          <GraduationCap size={12} /> Treinamento
          {verHabilidades ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>

      {/* Habilidades aprendidas */}
      {verHabilidades && (
        <div style={{ padding: '9px 12px', borderBottom: '1px solid #DDE7DD', background: '#fff', maxHeight: 200, overflowY: 'auto' }}>
          {habilidades.length === 0 ? (
            <p style={{ fontSize: 11.5, color: '#8a8a8a', margin: 0, lineHeight: 1.5 }}>
              O Bidu ainda não aprendeu nada. Escreva uma regra no chat — por exemplo,
              “na CEMIG, o formulário sempre vai com o tipo de solicitação X” — e ela
              vira habilidade dele.
            </p>
          ) : habilidades.map(h => (
            <div key={h.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #F2F2F2' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 11.5, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{h.titulo}</p>
                <p style={{ fontSize: 11, color: '#666', margin: '2px 0 0', lineHeight: 1.45 }}>{h.instrucao}</p>
              </div>
              <button
                onClick={() => { if (confirm(`Esquecer "${h.titulo}"?`)) apagarHabilidade.mutate(h.id); }}
                title="Fazer o Bidu esquecer esta habilidade"
                style={{ border: 'none', background: 'none', color: '#B91C1C', cursor: 'pointer', padding: 2, flexShrink: 0 }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Conversa */}
      <div style={{ maxHeight: 300, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
            <Loader2 size={16} className="animate-spin" color="#2D7A3A" />
          </div>
        ) : mensagens.length === 0 ? (
          <p style={{ fontSize: 11.5, color: '#8a8a8a', margin: 0, lineHeight: 1.5 }}>
            Fale com o Bidu sobre este projeto, ou ensine uma regra nova. Ele conhece
            o projeto aberto — titular, concessionária, equipamentos e etapa.
          </p>
        ) : mensagens.map(m => (
          <div
            key={m.id}
            style={{
              alignSelf: m.autor === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.autor === 'user' ? '#E7F0FE' : '#fff',
              border: `1px solid ${m.autor === 'user' ? '#C7DBFA' : '#E4EAE4'}`,
              borderRadius: 9,
              padding: '7px 10px',
            }}
          >
            <p style={{ fontSize: 12, color: '#1A1A1A', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {m.conteudo}
            </p>
            {m.skill_id && (
              <p style={{ fontSize: 10, color: '#2D7A3A', margin: '4px 0 0', fontWeight: 700 }}>
                ✓ virou habilidade
              </p>
            )}
          </div>
        ))}
        {falar.isPending && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, color: '#6B7280', fontSize: 11.5 }}>
            <Loader2 size={12} className="animate-spin" /> Bidu está pensando…
          </div>
        )}
        <div ref={fimDaLista} />
      </div>

      {/* Escrever */}
      <div style={{ display: 'flex', gap: 6, padding: '9px 12px', borderTop: '1px solid #DDE7DD', background: '#fff' }}>
        <textarea
          value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          placeholder="Pergunte, ou ensine uma regra ao Bidu…"
          rows={2}
          disabled={falar.isPending}
          style={{ flex: 1, resize: 'none', padding: '7px 9px', borderRadius: 7, border: '1px solid #E0E0E0', fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
        />
        <button
          onClick={enviar}
          disabled={falar.isPending || !texto.trim()}
          style={{
            alignSelf: 'stretch', padding: '0 13px', borderRadius: 7, border: 'none',
            background: texto.trim() && !falar.isPending ? '#2D7A3A' : '#D6E2D6',
            color: '#fff', cursor: texto.trim() && !falar.isPending ? 'pointer' : 'default',
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
