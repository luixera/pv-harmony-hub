-- ═══════════════════════════════════════════════════════════════════════════
-- ETAPAS NOVAS DEPOIS DA APROVAÇÃO (pedido do usuário, ago/2026)
--
-- O acompanhamento parava no "Aprovado": ninguém sabia se o equipamento foi
-- instalado, se a vistoria saiu do papel, se o protocolo chegou à
-- distribuidora ou se a vistoria foi negada. Sem ESTADO registrado não há o
-- que automatizar nem o que cobrar — a espera virava memória do gestor.
--
-- `projects.status` é um ENUM (lista fechada). A tela de configuração do
-- Kanban guarda `status_key` como TEXTO LIVRE, então dava para criar a coluna
-- "Aguardando instalação" e ela aparecia no quadro — só que nenhum projeto
-- conseguia assumir esse status e a coluna ficava eternamente vazia, sem erro
-- nenhum. Por isso a etapa nova precisa nascer aqui, no enum.
--
-- ATENÇÃO: `ALTER TYPE ... ADD VALUE` não pode ser usado na MESMA transação
-- em que o valor é lido. Por isso as colunas do Kanban vão numa migração
-- separada (20260816120100).
-- ═══════════════════════════════════════════════════════════════════════════

alter type public.project_status add value if not exists 'aguardando_instalacao';
alter type public.project_status add value if not exists 'vistoria_sem_protocolo';
alter type public.project_status add value if not exists 'vistoria_reprovada';
