-- ERP authenticated write access for knowledge curation UI.
GRANT SELECT, INSERT, UPDATE ON public.product_knowledge_links TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.product_relations TO authenticated;

DROP POLICY IF EXISTS product_knowledge_links_auth_write ON public.product_knowledge_links;
CREATE POLICY product_knowledge_links_auth_write ON public.product_knowledge_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_relations_auth_write ON public.product_relations;
CREATE POLICY product_relations_auth_write ON public.product_relations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
