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

export function lerCertificado(pfx: Buffer, senha: string): DadosCertificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);
  } catch (e) {
    throw new Error(`Não consegui abrir o certificado — senha errada ou arquivo corrompido (${(e as Error).message}).`);
  }
  const sacos = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  const cert = sacos?.[0]?.cert;
  if (!cert) throw new Error('O arquivo não traz certificado dentro.');

  const cn = String(cert.subject.getField('CN')?.value ?? '');
  const [nome, cpfBruto] = cn.split(':');
  const cpf = (cpfBruto ?? '').replace(/\D/g, '');
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

/** `***.***.789-01` — o CPF aparece mascarado na estampa e nas telas. */
export function cpfMascarado(cpf: string): string {
  const d = cpf.replace(/\D/g, '').padStart(11, '0');
  return `***.***.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}
