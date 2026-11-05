import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { generateDocxFromTemplate, marcarModalidadeCompensacao } from './docxGenerator';
import { buildProjectValues } from './projectValues';
import type { ProjectWithDetails } from '@/hooks/useProjects';

/** A caixa como está no Anexo E da CPFL (ANEXO_E_NOVO.docx): controle de conteúdo do Word, com permStart/permEnd. */
const caixa = (rotulo: string, marcada: boolean) =>
  '<w:p w14:paraId="1"><w:pPr><w:spacing w:line="276"/></w:pPr><w:sdt><w:sdtPr><w:id w:val="-1"/>'
  + `<w14:checkbox><w14:checked w14:val="${marcada ? 1 : 0}"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>`
  + `</w:sdtPr><w:sdtContent><w:permStart w:id="1" w:edGrp="everyone"/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${marcada ? '☒' : '☐'}</w:t></w:r><w:permEnd w:id="1"/></w:sdtContent></w:sdt>`
  + `<w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:t>${rotulo}</w:t></w:r></w:p>`;

// O Word costuma quebrar o rótulo em dois pedaços ("Autoconsumo" + " local")
const local = (marcada: boolean) => caixa('Autoconsumo</w:t></w:r><w:r><w:t xml:space="preserve"> local', marcada);
const MODELO = local(true) + caixa('Autoconsumo remoto', false)
  + caixa('Múltiplas Unidades Consumidoras', false) + caixa('Geração compartilhada', false)
  + caixa('modalidade autoconsumo local, com potência instalada de geração igual ou inferior a 7,5 kW, observado o item 6.', false)
  + '<w:p><w:r><w:t>Autoconsumo remoto</w:t></w:r></w:p>';

/** Cada parágrafo com caixa: [rótulo, marcado no controle, símbolo na tela]. */
function caixas(xml: string) {
  return xml.split('</w:p>').filter(p => p.includes('<w14:checkbox>')).map(p => [
    p.replace(/<[^>]+>/g, '').replace(/[☒☐]/g, '').trim(),
    p.match(/<w14:checked w14:val="(\d)"/)?.[1],
    p.match(/[☒☐]/)?.[0],
  ]);
}

describe('marcarModalidadeCompensacao', () => {
  it('autoconsumo remoto: troca a marca de "local" para "remoto" e não mexe nas outras caixas', () => {
    expect(caixas(marcarModalidadeCompensacao(MODELO, 'Autoconsumo remoto'))).toEqual([
      ['Autoconsumo local', '0', '☐'],
      ['Autoconsumo remoto', '1', '☒'],
      ['Múltiplas Unidades Consumidoras', '0', '☐'],
      ['Geração compartilhada', '0', '☐'],
      ['modalidade autoconsumo local, com potência instalada de geração igual ou inferior a 7,5 kW, observado o item 6.', '0', '☐'],
    ]);
  });

  it('autoconsumo local: o documento fica como o modelo', () => {
    expect(marcarModalidadeCompensacao(MODELO, 'Autoconsumo local')).toBe(MODELO);
  });

  it('modelo sem essas caixas passa intacto', () => {
    const outro = caixa('Solar fotovoltaica', true) + '<w:p><w:r><w:t>Autoconsumo local</w:t></w:r></w:p>';
    expect(marcarModalidadeCompensacao(outro, 'Autoconsumo remoto')).toBe(outro);
  });

  it('não confunde <w:pPr> nem <w:permStart> com parágrafo: o XML continua igual fora das caixas', () => {
    const r = marcarModalidadeCompensacao(MODELO, 'Autoconsumo remoto');
    expect(r.replace(/w14:val="[01]"/g, '').replace(/[☒☐]/g, '')).toBe(MODELO.replace(/w14:val="[01]"/g, '').replace(/[☒☐]/g, ''));
  });
});

describe('o documento gerado', () => {
  const docx = () => {
    const zip = new PizZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:w14="w14"><w:body>${MODELO}<w:p><w:r><w:t>UC {uc}</w:t></w:r></w:p></w:body></w:document>`);
    return zip.generate({ type: 'arraybuffer' }) as ArrayBuffer;
  };
  const gerar = async (values: Record<string, string>) => {
    const blob = await generateDocxFromTemplate(docx(), values);
    return new PizZip(await blob.arrayBuffer()).files['word/document.xml'].asText();
  };

  it('com a modalidade remota, sai marcado "Autoconsumo remoto" e as tags continuam preenchidas', async () => {
    const xml = await gerar({ uc: '123', modalidade_compensacao: 'Autoconsumo remoto' });
    expect(caixas(xml).slice(0, 2)).toEqual([['Autoconsumo local', '0', '☐'], ['Autoconsumo remoto', '1', '☒']]);
    expect(xml).toContain('UC 123');
  });

  it('sem a modalidade nos valores, fica como o modelo', async () => {
    expect(caixas(await gerar({ uc: '123' })).slice(0, 2)).toEqual([['Autoconsumo local', '1', '☒'], ['Autoconsumo remoto', '0', '☐']]);
  });
});

describe('modalidade_compensacao nos valores do projeto', () => {
  const projeto = (generalData: Record<string, unknown>) => ({ generalData, equipment: {} }) as unknown as ProjectWithDetails;

  it('com beneficiárias é autoconsumo remoto; sem, autoconsumo local', () => {
    expect(buildProjectValues(projeto({ has_beneficiaries: true })).modalidade_compensacao).toBe('Autoconsumo remoto');
    expect(buildProjectValues(projeto({ has_beneficiaries: false })).modalidade_compensacao).toBe('Autoconsumo local');
    expect(buildProjectValues(projeto({})).modalidade_compensacao).toBe('Autoconsumo local');
  });

  it('revisão guardada antes do campo existir: vale o que o projeto tem hoje', () => {
    const v = buildProjectValues(projeto({ has_beneficiaries: true }), { generalData: { holder_name: 'X' } as never });
    expect(v.modalidade_compensacao).toBe('Autoconsumo remoto');
  });
});
