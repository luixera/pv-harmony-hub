import forge from 'node-forge';

/**
 * Lê os metadados do certificado A1 (.pfx / PKCS#12). Nada sai daqui para
 * disco: o buffer e a senha vivem só na memória do processo.
 *
 * No padrão ICP-Brasil o CN do e-CPF é "NOME DA PESSOA:CPF" — daí a separação.
 */
export interface DadosCertificado {
  titularNome: string;
  cpf: string;
  emissor: string;
  serial: string;
  inicio: Date;
  fim: Date;
}

/** Só aceitamos CPF: 11 dígitos. Qualquer outra coisa não identifica o titular. */
function soCpf(valor: string): string | null {
  const d = valor.replace(/\D/g, '');
  return d.length === 11 ? d : null;
}

function mesmaChavePublica(a: Pick<forge.pki.rsa.PublicKey, 'n' | 'e'>, b: Pick<forge.pki.rsa.PublicKey, 'n' | 'e'>): boolean {
  return a.n.toString(16) === b.n.toString(16) && a.e.toString(16) === b.e.toString(16);
}

export function lerCertificado(pfx: Buffer, senha: string): DadosCertificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    // strict = false, igual ao P12Signer (asn1StrictParsing: false): um .pfx que a
    // assinatura aceita não pode ser recusado aqui na leitura.
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch (e) {
    throw new Error(`Não consegui abrir o certificado — senha errada ou arquivo corrompido (${(e as Error).message}).`);
  }

  // Um e-CPF real traz a CADEIA (titular + ACs), sem ordem garantida: o titular é
  // o certificado cuja chave pública casa com a chave privada do arquivo — o mesmo
  // que o P12Signer usa para assinar.
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ].map(s => s.key as forge.pki.rsa.PrivateKey | undefined).filter((k): k is forge.pki.rsa.PrivateKey => !!k);
  if (chaves.length === 0) {
    throw new Error('O arquivo não traz chave privada utilizável — não serve para assinar.');
  }

  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map(s => s.cert)
    .filter((c): c is forge.pki.Certificate => !!c);
  if (certs.length === 0) throw new Error('O arquivo não traz certificado dentro.');

  const cert = certs.find(c => chaves.some(k => mesmaChavePublica(c.publicKey as forge.pki.rsa.PublicKey, k)));
  if (!cert) {
    throw new Error('Nenhum certificado do arquivo casa com a chave privada — o .pfx está inconsistente.');
  }

  const cn = String(cert.subject.getField('CN')?.value ?? '');
  const [nome, cpfBruto] = cn.split(':');
  const cpf = soCpf(cpfBruto ?? '');
  if (!cpf) {
    throw new Error(
      'Não consegui identificar o CPF do titular no certificado (esperado "NOME:CPF" com 11 dígitos no CN). ' +
      'Certificado de pessoa jurídica (e-CNPJ) não serve para este fluxo.',
    );
  }
  const emissorCn = String(cert.issuer.getField('CN')?.value ?? '');
  const emissorO = String(cert.issuer.getField('O')?.value ?? '');

  return {
    titularNome: (nome ?? cn).trim(),
    cpf,
    emissor: [emissorCn, emissorO].filter(Boolean).join(' · ') || 'desconhecido',
    serial: cert.serialNumber,
    inicio: cert.validity.notBefore,
    fim: cert.validity.notAfter,
  };
}

/**
 * `***.***.789-01` — o CPF aparece mascarado na estampa e nas telas.
 * Lança erro se não houver exatamente 11 dígitos: nunca fabrica um número.
 */
export function cpfMascarado(cpf: string): string {
  const d = soCpf(cpf);
  if (!d) throw new Error('CPF inválido: esperado exatamente 11 dígitos.');
  return `***.***.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}
