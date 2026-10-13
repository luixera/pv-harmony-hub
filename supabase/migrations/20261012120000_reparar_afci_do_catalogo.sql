-- Reparo: certificados AFCI apontando para arquivo que não existe
--
-- O AFCI é documento da MARCA — vários inversores apontam para o mesmo
-- arquivo. O app montava o caminho com o id do equipamento e, ao salvar um
-- equipamento sem anexo novo, RENOMEAVA (move) o arquivo para a pasta dele.
-- Como o arquivo era compartilhado, cada edição levava o certificado embora e
-- quebrava o link de todos os irmãos da marca.
--
-- Estrago medido em 12/10/2026: 29 dos 44 certificados apontavam para arquivo
-- inexistente. Datasheet (126) e INMETRO (103), que são do modelo e nunca
-- compartilhados, estavam íntegros — foi o que isolou a causa.
--
-- Na tela o link aparecia normal, porque ela só olha se a coluna tem texto;
-- quem reclamava era o pacote do instalador, que tenta baixar de verdade
-- ("Certificado AFCI inversor — Faltando").
--
-- Este reparo:
--   1. para cada marca, acha o arquivo AFCI que ainda existe no storage e
--      aponta TODOS os inversores da marca para ele;
--   2. zera o afci_url das marcas sem nenhum arquivo, para a tela parar de
--      prometer um documento que não existe e o certificado ser anexado de novo.
--
-- O código já não move mais documento de marca (ver renameDocIfNeeded) e passou
-- a gravar o AFCI em `afci/<MARCA>/AFCI_<MARCA>.pdf`, caminho que não depende
-- do modelo — então isto não volta a acontecer.

-- 1) Arquivo vivo por marca (quando há mais de um, fica o mais recente).
WITH vivos AS (
  SELECT upper(c.brand) AS marca, c.afci_url AS url, o.created_at,
         row_number() OVER (PARTITION BY upper(c.brand) ORDER BY o.created_at DESC) AS posicao
    FROM public.equipment_catalog c
    JOIN storage.objects o
      ON o.bucket_id = 'equipment-documents' AND o.name = c.afci_url
   WHERE c.type = 'inverter' AND c.afci_url IS NOT NULL
), escolhido AS (
  SELECT marca, url FROM vivos WHERE posicao = 1
)
UPDATE public.equipment_catalog c
   SET afci_url = e.url
  FROM escolhido e
 WHERE c.type = 'inverter'
   AND upper(c.brand) = e.marca
   AND c.afci_url IS DISTINCT FROM e.url;

-- 2) Quem continuou apontando para arquivo inexistente é marca sem documento
--    nenhum: zera, para a tela dizer a verdade.
UPDATE public.equipment_catalog c
   SET afci_url = NULL
 WHERE c.afci_url IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'equipment-documents' AND o.name = c.afci_url);

SELECT 'AFCI com arquivo real: ' || count(*) FILTER (WHERE afci_url IS NOT NULL)::text
    || ' | sem certificado (para anexar): ' || count(*) FILTER (WHERE afci_url IS NULL AND type = 'inverter')::text
    || ' | quebrados restantes: ' || (
         SELECT count(*)::text FROM public.equipment_catalog c2
          WHERE c2.afci_url IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM storage.objects o
                             WHERE o.bucket_id = 'equipment-documents' AND o.name = c2.afci_url))
   AS resultado
  FROM public.equipment_catalog WHERE type = 'inverter';
