# Autenticação — Regras de Negócio

- **RN-AUTH-01** — Papel e tenant vêm de `app_metadata` (ADR 0003). Nunca de
  `user_metadata`.
- **RN-AUTH-02** — Usuário inativo (`profiles.active = false`) não loga: o
  `login` faz `signOut` e retorna erro.
- **RN-AUTH-03** — Perfil ausente/inativo → sessão não é considerada
  autenticada.
- **RN-AUTH-04** — Login falhado é registrado como evento de **segurança**
  (`login_failed`) com o e-mail e IP — nunca a senha.
- **RN-AUTH-05** — O trigger `handle_new_user` cria o `profiles` lendo
  `app_metadata` (role/tenant). Autocadastro público passa por `signup-tenant`
  (define papel `admin` para o fundador).
- **RN-AUTH-06** — `staff_access_mode` (`global`/`assigned_only`) vem no perfil e
  governa o que o projetista abre (ver permissions).
- **RN-AUTH-07** — Bloqueio por tenant: status `suspended`/`canceled` ou
  vencimento levam à tela de bloqueio (ver módulo permissions).
