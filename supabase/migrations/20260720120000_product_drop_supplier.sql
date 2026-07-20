-- El proveedor deja de ser un atributo del producto: pasa a ser solo un filtro del
-- histórico de precios (que se deriva de las facturas de compra). La columna estaba
-- muerta (solo la usaba el formulario), así que se elimina.
alter table public.product drop column if exists supplier_id;
