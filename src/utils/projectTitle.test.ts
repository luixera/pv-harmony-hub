import { describe, it, expect } from 'vitest';
import { tituloQueAcompanhaTitular } from './projectTitle';

/**
 * O título do projeto nasce como CÓPIA do nome do titular (NewProject /
 * PublicProjectForm) e nunca era atualizado depois: trocar o titular no modal
 * mexia só em project_general_data, e o título ficava com o nome antigo. Deu
 * no PRJ-81492, que quase foi para o formulário da CEMIG/CPFL como "ANTONIO"
 * depois de a titularidade passar para o ROBSON (12 de 256 projetos assim).
 */
describe('tituloQueAcompanhaTitular', () => {
  it('devolve o novo titular quando o nome mudou', () => {
    expect(tituloQueAcompanhaTitular('ANTONIO CARLOS ALEIXO', 'ROBSON CARLOS ALEIXO'))
      .toBe('ROBSON CARLOS ALEIXO');
  });

  it('devolve null quando o titular não mudou — nada a gravar', () => {
    expect(tituloQueAcompanhaTitular('ROBSON CARLOS ALEIXO', 'ROBSON CARLOS ALEIXO')).toBeNull();
  });

  it('ignora caixa e espaços de sobra na comparação', () => {
    expect(tituloQueAcompanhaTitular('  robson carlos aleixo ', 'ROBSON CARLOS ALEIXO')).toBeNull();
  });

  it('sobe para maiúsculas, como o resto do cadastro', () => {
    expect(tituloQueAcompanhaTitular('ANTONIO', 'robson carlos aleixo')).toBe('ROBSON CARLOS ALEIXO');
  });

  it('titular vazio não apaga o título', () => {
    expect(tituloQueAcompanhaTitular('ANTONIO CARLOS ALEIXO', '')).toBeNull();
    expect(tituloQueAcompanhaTitular('ANTONIO CARLOS ALEIXO', '   ')).toBeNull();
    expect(tituloQueAcompanhaTitular('ANTONIO CARLOS ALEIXO', undefined)).toBeNull();
  });

  it('projeto sem título ganha o do titular', () => {
    expect(tituloQueAcompanhaTitular(null, 'ROBSON CARLOS ALEIXO')).toBe('ROBSON CARLOS ALEIXO');
  });
});
