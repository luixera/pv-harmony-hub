/**
 * CPF/CNPJ do titular — máscara, tipo e validação.
 *
 * O tipo de pessoa é deduzido da quantidade de dígitos, que é como o usuário
 * já preenche na prática: até 11 dígitos é CPF, 14 é CNPJ. Isso evita pedir
 * que ele escolha "pessoa física ou jurídica" antes de digitar.
 */

export type TipoPessoa = 'fisica' | 'juridica' | 'indefinido';

export function apenasDigitos(valor: string): string {
  return (valor ?? '').replace(/\D/g, '');
}

/** Aplica a máscara conforme o tamanho: CPF até 11 dígitos, CNPJ até 14. */
export function formatCpfCnpj(valor: string): string {
  const n = apenasDigitos(valor).slice(0, 14);
  if (n.length <= 11) {
    return n
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return n
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

/**
 * Só afirma o tipo quando o número está completo. Enquanto o usuário digita,
 * o retorno é 'indefinido' — assim a tela não fica piscando campos de CNPJ no
 * meio da digitação de um CPF.
 */
export function tipoPessoa(valor: string): TipoPessoa {
  const n = apenasDigitos(valor);
  if (n.length === 11) return 'fisica';
  if (n.length === 14) return 'juridica';
  return 'indefinido';
}

export function isPessoaJuridica(valor: string): boolean {
  return tipoPessoa(valor) === 'juridica';
}

/** Completo = 11 dígitos (CPF) ou 14 (CNPJ). Nada entre os dois vale. */
export function cpfCnpjCompleto(valor: string): boolean {
  const n = apenasDigitos(valor).length;
  return n === 11 || n === 14;
}

/** Dígito verificador de CPF/CNPJ: soma ponderada, resto 11 (resto < 2 → 0). */
function digitoVerificador(numeros: string, pesos: number[]): number {
  const soma = pesos.reduce((s, peso, i) => s + Number(numeros[i]) * peso, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

const PESOS_CNPJ = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * É um CPF ou CNPJ de verdade? Confere a quantidade de dígitos E o dígito
 * verificador, e recusa sequência repetida (000.000.000-00 passa na conta, mas
 * não é documento). Serve para não comparar titular com algo que não é
 * documento — a leitura de uma conta de luz já devolveu a UC no lugar do CPF.
 */
export function documentoValido(valor: string | null | undefined): boolean {
  const n = apenasDigitos(valor ?? '');
  if (n.length !== 11 && n.length !== 14) return false;
  if (/^(\d)\1+$/.test(n)) return false;
  if (n.length === 11) {
    const d1 = digitoVerificador(n, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = digitoVerificador(n, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return d1 === Number(n[9]) && d2 === Number(n[10]);
  }
  const d1 = digitoVerificador(n, PESOS_CNPJ);
  const d2 = digitoVerificador(n, [6, ...PESOS_CNPJ]);
  return d1 === Number(n[12]) && d2 === Number(n[13]);
}

/** Mensagem de erro pronta para o toast, ou null se estiver válido. */
export function erroCpfCnpj(valor: string): string | null {
  const n = apenasDigitos(valor);
  if (n.length === 0) return 'Informe o CPF ou CNPJ do titular';
  if (n.length === 11 || n.length === 14) return null;
  if (n.length < 11) return `CPF incompleto: faltam ${11 - n.length} dígito(s)`;
  return `CNPJ incompleto: faltam ${14 - n.length} dígito(s)`;
}
