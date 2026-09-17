import { ErroLudmilla } from '../erros.js';
import type { Credenciais } from '../fila.js';
import type { Agente } from './agente.js';
import { jsClicarTexto } from './js.js';

/**
 * Entra na CPFL (Azure AD B2C) pelo cofre da CLI: a senha vai por stdin para
 * o `auth save`, o `auth login` preenche e envia, e a entrada do cofre é
 * apagada em seguida — a senha nunca aparece em argumento, log ou chat.
 * Depois do login: "Selecionar perfil" → "Serviços para projetistas" →
 * gestao-projetos (mesmo caminho da varredura, que não muda).
 */

const LOGIN_URL = 'https://www.cpfl.com.br/cpfl-auth/redirect-arame?redirect_uri=/Internet/Projeto';
const URL_MEUS_PROJETOS = 'https://www.cpfl.com.br/gestao-projetos/meus-projetos';

export async function entrarNaCpfl(ag: Agente, creds: Credenciais, nomeCofre: string, log: (m: string, x?: Record<string, unknown>) => void): Promise<void> {
  await ag.authSalvar(nomeCofre, {
    url: LOGIN_URL, usuario: creds.login, senha: creds.senha,
    selUsuario: '#signInName', selSenha: '#password', selEnviar: '#next',
  });
  try {
    await ag.authEntrar(nomeCofre);
  } catch (e) {
    throw new ErroLudmilla('pagina_mudou', `A tela de login da CPFL não respondeu como o roteiro espera: ${(e as Error).message.slice(0, 200)}`);
  } finally {
    await ag.authApagar(nomeCofre);
  }

  // O B2C redireciona em cadeia (b2clogin → receive-token → site): o sinal é a URL sair do b2clogin.
  const ate = Date.now() + 60_000;
  let url = '';
  while (Date.now() < ate) {
    url = await ag.url();
    if (!/b2clogin\.com/i.test(url)) break;
    await ag.esperar(1_500);
  }
  if (/b2clogin\.com/i.test(url)) {
    throw new ErroLudmilla('login_recusado', 'O portal da CPFL não saiu da tela de login — usuário ou senha recusados.');
  }
  await ag.esperarCarga('networkidle');
  await ag.esperar(1_500);
  await ag.js<boolean>(jsClicarTexto('Rejeitar todos')).catch(() => false);

  // tela "Selecionar perfil": o cartão Projetos Particulares tem o subtítulo "Serviços para projetistas"
  if (await ag.js<boolean>(jsClicarTexto('Serviços para projetistas', 'a, button, p, span, div, h3, h4')).catch(() => false)) {
    await ag.esperarCarga('load');
    await ag.esperar(1_500);
  }
  if (!/gestao-projetos/.test(await ag.url())) {
    await ag.abrir(URL_MEUS_PROJETOS);
    await ag.esperarCarga('load');
    await ag.esperar(1_000);
  }
  if (!/gestao-projetos/.test(await ag.url())) {
    throw new ErroLudmilla('sessao_expirada', 'Entrei na CPFL mas não cheguei ao portal de projetos (gestao-projetos).');
  }
  log('login na CPFL ok', { url: (await ag.url()).replace(/\?.*$/, '') });
}
