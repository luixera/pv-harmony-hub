-- Reparo do reparo: certificado PRÓPRIO do modelo tem preferência
--
-- A migração 20261012120000 apontou todos os inversores da marca para o
-- certificado que sobreviveu no storage. Isso consertou os 29 links quebrados,
-- mas atropelou dois modelos que tinham o PRÓPRIO certificado guardado e
-- válido: FOXESS KH7.5 (passou a apontar para o do Q1-2500-E) e DEYE SUN-7.5K-G
-- (para o do SUN-M225G4). O arquivo deles nunca sumiu — só o ponteiro saiu do
-- lugar.
--
-- Regra correta, e que vale daqui pra frente: o AFCI pertence ao equipamento
-- que o anexou (pasta `<id do equipamento>/afci/…`). Quem não tem o seu HERDA
-- o de outro modelo da marca. Herdar é só apontar para o mesmo arquivo — nunca
-- mover, que foi o defeito original.

UPDATE public.equipment_catalog c
   SET afci_url = o.name
  FROM storage.objects o
 WHERE o.bucket_id = 'equipment-documents'
   AND o.name LIKE c.id::text || '/afci/%'
   AND c.afci_url IS DISTINCT FROM o.name;

SELECT 'com certificado próprio: ' || (
         SELECT count(*)::text FROM public.equipment_catalog c
          WHERE c.afci_url LIKE c.id::text || '/afci/%')
    || ' | herdando da marca: ' || (
         SELECT count(*)::text FROM public.equipment_catalog c
          WHERE c.afci_url IS NOT NULL AND c.afci_url NOT LIKE c.id::text || '/afci/%')
    || ' | apontando para arquivo inexistente: ' || (
         SELECT count(*)::text FROM public.equipment_catalog c
          WHERE c.afci_url IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM storage.objects o
                             WHERE o.bucket_id = 'equipment-documents' AND o.name = c.afci_url))
   AS resultado;
