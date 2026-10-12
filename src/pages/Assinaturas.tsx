import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import {
  FileSignature, ShieldCheck, ShieldAlert, Loader2, Upload, ExternalLink, Eye, Check, X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/hooks/useTenant';
import {
  Certificado, LinhaRegistro, SituacaoAssinatura, urlDoArquivo, useAprovarAssinatura,
  useCadastrarCertificado, useCertificadoAtivo, useAssinaturaDisponivel, useLiberarAssinatura,
  useRecusarAssinatura, useRegistroAssinaturas,
} from '@/hooks/useAssinaturas';

/**
 * ASSINATURAS — o certificado e o extrato.
 *
 * Mora aqui, e não em /painel: o /painel é o console do MASTER da plataforma,
 * e quem cadastra o certificado é o admin do tenant. Mesmo recorte de
 * /ludmilla (admin + staff); o cartão do certificado só o admin vê.
 */

const ROTULO: Record<SituacaoAssinatura, { texto: string; cor: string; fundo: string }> = {
  preparando:    { texto: 'Preparando',        cor: '#8A5300', fundo: '#FEF3D0' },
  conferir:      { texto: 'Esperando conferência', cor: '#185FA5', fundo: '#E3F0FB' },
  triagem:       { texto: 'Em triagem',        cor: '#8A5300', fundo: '#FEF3D0' },
  aguardando_ze: { texto: 'Esperando você',    cor: '#7C3AED', fundo: '#F3E8FF' },
  pendente:      { texto: 'Na fila',           cor: '#8A5300', fundo: '#FEF3D0' },
  assinando:     { texto: 'Assinando',         cor: '#8A5300', fundo: '#FEF3D0' },
  assinado:      { texto: 'Assinado',          cor: '#1B7F4C', fundo: '#E6F6EC' },
  recusado:      { texto: 'Recusado',          cor: '#B3261E', fundo: '#FDECEA' },
  erro:          { texto: 'Erro',              cor: '#B3261E', fundo: '#FDECEA' },
};

/** Uma situação que a tela não conhece (banco mais novo que o front) não pode derrubar a página. */
const ROTULO_DESCONHECIDO = { texto: 'Em andamento', cor: '#555555', fundo: '#EEEEEE' };

const SITUACAO_CERTIFICADO: Record<Certificado['situacao'], string> = {
  conferindo: 'conferindo o arquivo…',
  ok: 'válido',
  invalido: 'inválido',
  vencido: 'vencido',
};

/** O CPF nunca aparece completo na tela: só os dígitos 7 a 11. */
function mascararCpf(cpf: string | null | undefined): string {
  const d = (cpf ?? '').replace(/\D/g, '');
  if (d.length !== 11) return '***.***.***-**';
  return `***.***.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

const abrir = async (path: string | null) => {
  if (!path) return;
  const url = await urlDoArquivo(path);
  if (url) window.open(url, '_blank', 'noopener');
};

/** Cadastro e estado do certificado — só o admin. */
function CartaoCertificado() {
  const { data: c } = useCertificadoAtivo();
  const cadastrar = useCadastrarCertificado();
  const fileRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [abrindo, setAbrindo] = useState(false);

  const cpfDigitos = cpf.replace(/\D/g, '');

  const limpar = () => {
    setSenha(''); setArquivo(null); setNome(''); setCpf(''); setAbrindo(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const enviar = async () => {
    if (!arquivo) return;
    try {
      await cadastrar.mutateAsync({ file: arquivo, senha, titularNome: nome.trim(), titularCpf: cpfDigitos });
      limpar();
    } catch {
      // o toast de erro já saiu no onError do hook; os campos ficam para
      // tentar de novo — menos a senha, que não fica em memória um segundo
      // além do necessário.
      setSenha('');
    } finally {
      // tira a senha das `variables` da mutação
      cadastrar.reset();
    }
  };

  const dias = c?.validade_fim
    ? Math.ceil((new Date(c.validade_fim).getTime() - Date.now()) / 864e5)
    : null;
  // sem validade (ainda em conferência) não há selo; data passada = vencido
  const mostraSelo = dias !== null && (c?.situacao === 'ok' || c?.situacao === 'vencido');

  return (
    <div className="rounded-xl border bg-card p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        {c?.situacao === 'ok' ? <ShieldCheck className="w-5 h-5 text-emerald-600" /> : <ShieldAlert className="w-5 h-5 text-amber-600" />}
        <span className="font-semibold">Certificado digital (A1)</span>
        {mostraSelo && dias !== null && (
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${dias <= 0 ? 'bg-red-100 text-red-800' : dias <= 30 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
            {dias <= 0 ? 'vencido' : `vence em ${dias} dia${dias > 1 ? 's' : ''}`}
          </span>
        )}
      </div>

      {c ? (
        <div className="text-sm space-y-1">
          <p><span className="text-muted-foreground">Titular:</span> {c.titular_nome}</p>
          <p><span className="text-muted-foreground">CPF:</span> {mascararCpf(c.titular_cpf)}</p>
          {c.emissor && <p><span className="text-muted-foreground">Emissor:</span> {c.emissor}</p>}
          {c.serial && <p className="font-mono text-xs"><span className="text-muted-foreground font-sans">Série:</span> {c.serial}</p>}
          {c.validade_fim && <p><span className="text-muted-foreground">Validade:</span> {format(new Date(c.validade_fim), 'dd/MM/yyyy')}</p>}
          <p>
            <span className="text-muted-foreground">Situação:</span>{' '}
            {SITUACAO_CERTIFICADO[c.situacao] ?? c.situacao}
            {c.erro && <span className="text-red-600"> — {c.erro}</span>}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum certificado cadastrado. Sem ele, ninguém assina.</p>
      )}

      {!abrindo ? (
        <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => setAbrindo(true)}>
          <Upload className="w-4 h-4" /> {c ? 'Trocar certificado' : 'Cadastrar certificado'}
        </Button>
      ) : (
        <div className="mt-4 space-y-2 border-t pt-4">
          <input
            ref={fileRef} type="file" accept=".pfx,.p12" className="hidden"
            onChange={e => setArquivo(e.target.files?.[0] ?? null)}
          />
          <Button variant="outline" size="sm" className="gap-2" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4" /> {arquivo ? arquivo.name : 'Escolher o .pfx'}
          </Button>
          <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do engenheiro responsável" />
          <Input value={cpf} onChange={e => setCpf(e.target.value)} placeholder="CPF do titular (só números)" inputMode="numeric" />
          <Input
            type="password" value={senha} onChange={e => setSenha(e.target.value)}
            placeholder="Senha do certificado" autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">
            A senha vai direto para o cofre do banco. Ninguém — nem você, depois — consegue
            lê-la de volta pela tela; só o assinador na VPS a usa, na hora de assinar.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm" onClick={enviar} className="gap-2"
              disabled={!arquivo || !senha || !nome.trim() || cpfDigitos.length !== 11 || cadastrar.isPending}
            >
              {cadastrar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar
            </Button>
            <Button size="sm" variant="ghost" onClick={limpar} disabled={cadastrar.isPending}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Linha({ l, ehAdmin }: { l: LinhaRegistro; ehAdmin: boolean }) {
  const navigate = useNavigate();
  const liberar = useLiberarAssinatura();
  const aprovar = useAprovarAssinatura();
  const recusar = useRecusarAssinatura();
  const r = ROTULO[l.situacao] ?? ROTULO_DESCONHECIDO;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="font-semibold hover:underline inline-flex items-center gap-1" onClick={() => navigate(`/project/${l.project_id}`)}>
          {l.codigo_projeto} <ExternalLink size={12} />
        </button>
        <span className="text-sm text-muted-foreground truncate">{l.titular_projeto}</span>
        <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ color: r.cor, background: r.fundo }}>{r.texto}</span>
        <span className="ml-auto text-xs text-muted-foreground font-mono">{l.codigo_verificacao}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {l.tipo} · pedido por {l.pedida_por_nome} em {format(new Date(l.pedida_em), 'dd/MM/yyyy HH:mm')}
        {l.titular_nome ? ` · e-CPF de ${l.titular_nome}` : ''}
        {l.liberada_por_nome ? ` · liberado por ${l.liberada_por_nome}` : ''}
      </p>
      {l.recusa && <p className="text-xs text-red-700 mt-1">{l.recusa}</p>}
      {l.erro && <p className="text-xs text-red-700 mt-1">{l.erro}</p>}

      <div className="flex flex-wrap gap-2 mt-3">
        {l.assinado_path && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => abrir(l.assinado_path)}>
            <Eye className="w-3.5 h-3.5" /> Abrir assinado
          </Button>
        )}
        {l.documento_aprovado_path && l.situacao !== 'assinado' && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => abrir(l.documento_aprovado_path)}>
            <Eye className="w-3.5 h-3.5" /> Ver o PDF
          </Button>
        )}
        {l.situacao === 'conferir' && (
          <Button
            size="sm" className="gap-1.5" disabled={aprovar.isPending}
            onClick={() => aprovar.mutate({ id: l.id, projectId: l.project_id })}
          >
            <Check className="w-3.5 h-3.5" /> Está certo, assine
          </Button>
        )}
        {l.situacao === 'aguardando_ze' && (
          <>
            {/* a RPC exige admin; para o staff o botão só daria erro */}
            {ehAdmin ? (
              <Button size="sm" className="gap-1.5" onClick={() => liberar.mutate(l.id)} disabled={liberar.isPending}>
                <Check className="w-3.5 h-3.5" /> Liberar
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground self-center">Só o admin libera.</span>
            )}
            <Button
              size="sm" variant="outline" className="gap-1.5" disabled={recusar.isPending}
              onClick={() => recusar.mutate({ id: l.id, motivo: 'Não liberado.', projectId: l.project_id })}
            >
              <X className="w-3.5 h-3.5" /> Não assinar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Assinaturas() {
  const { user } = useAuth();
  const { isLoading: carregandoTenant } = useTenant();
  const disponivel = useAssinaturaDisponivel();
  const { data: registro = [], isLoading } = useRegistroAssinaturas();

  if (carregandoTenant) {
    return (
      <MainLayout>
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      </MainLayout>
    );
  }

  if (!disponivel) {
    return (
      <MainLayout>
        <div className="p-8 text-center text-muted-foreground">
          <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">A assinatura digital ainda não está liberada para esta conta.</p>
        </div>
      </MainLayout>
    );
  }

  const ehAdmin = user?.role === 'admin';
  // duas listas que se completam: toda linha cai em exatamente uma
  const esperaVoce = (l: LinhaRegistro) => l.situacao === 'conferir' || l.situacao === 'aguardando_ze';
  const esperando = registro.filter(esperaVoce);
  const resto = registro.filter(l => !esperaVoce(l));

  return (
    <MainLayout>
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-5">
          <FileSignature className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">Assinaturas</h1>
        </div>

        {ehAdmin && <CartaoCertificado />}

        {esperando.length > 0 && (
          <>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">Esperando você</h2>
            <div className="space-y-2 mb-6">{esperando.map(l => <Linha key={l.id} l={l} ehAdmin={ehAdmin} />)}</div>
          </>
        )}

        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Tudo o que foi assinado</h2>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : resto.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nada por aqui ainda.</p>
        ) : (
          <div className="space-y-2">{resto.map(l => <Linha key={l.id} l={l} ehAdmin={ehAdmin} />)}</div>
        )}
      </div>
    </MainLayout>
  );
}
