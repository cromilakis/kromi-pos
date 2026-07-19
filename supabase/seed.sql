-- ============================================================================
-- Seed mínimo LOCAL de kromi-pos (arranca vacío: 1 negocio, 1 sucursal, 1 admin)
-- Contrato: docs/superpowers/specs/2026-07-07-fundacion-datos-supabase-design.md §2 (datos iniciales)
-- Solo para desarrollo (supabase db reset). En producción el bootstrap del
-- primer admin se hace vía Admin API al linkear el proyecto cloud.
-- Admin demo: RUT 11.111.111-1  ·  PIN 123456
-- ============================================================================

-- Negocio
insert into public.business (id, name, rut, plan, admin_email)
values ('00000000-0000-0000-0000-0000000000b1','Kromi POS','76.000.000-0','Pro','admin@kromi.local')
on conflict (id) do nothing;

-- Sucursal
insert into public.branch (id, business_id, name)
values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000b1','Casa Matriz')
on conflict (id) do nothing;

-- Caja
insert into public.register (id, branch_id, name)
values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000f1','Caja 1')
on conflict (id) do nothing;

-- Contadores de folio de la sucursal
insert into public.folio_counter (branch_id, doc_type, next_value) values
  ('00000000-0000-0000-0000-0000000000f1','sale',1),
  ('00000000-0000-0000-0000-0000000000f1','quote',1),
  ('00000000-0000-0000-0000-0000000000f1','credit_note',1)
on conflict (branch_id, doc_type) do nothing;

-- Módulos contratados
insert into public.module_state (business_id, module_key, active) values
  ('00000000-0000-0000-0000-0000000000b1','stock',true),
  ('00000000-0000-0000-0000-0000000000b1','clientes',true),
  ('00000000-0000-0000-0000-0000000000b1','metricas',true)
on conflict (business_id, module_key) do nothing;

-- Usuario admin en Supabase Auth (PIN=123456 hasheado bcrypt).
-- El trigger handle_new_user crea el espejo en app_user con los metadatos.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  -- GoTrue exige estas columnas de token como string vacío, NO NULL; si quedan
  -- NULL el login falla con 500 "converting NULL to string is unsupported".
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','111111111@pos.kromi.local',
  crypt('123456', gen_salt('bf')),
  '', '', '', '', '', '', '', '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object(
    'business_id','00000000-0000-0000-0000-0000000000b1',
    'name','Administrador','rut','11.111.111-1','role','admin'),
  now(), now()
)
on conflict (id) do nothing;

-- Catálogo oficial (Stock tienda.xlsx): categorías Plantas/Productos + 102 productos.
-- Catálogo oficial (Stock tienda.xlsx). Categorías: Plantas, Productos. Idempotente.

insert into public.category (business_id, key, label, sort) values
  ('00000000-0000-0000-0000-0000000000b1','plantas','Plantas',0),
  ('00000000-0000-0000-0000-0000000000b1','productos','Productos',1);

insert into public.product (business_id, name, category_id, price) values
  ('00000000-0000-0000-0000-0000000000b1','Palma Chamadorea',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),32990),
  ('00000000-0000-0000-0000-0000000000b1','Crotón',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),19990),
  ('00000000-0000-0000-0000-0000000000b1','Dólar variegado',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),10990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro Longifolio',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),29990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro Monstera Thai',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),49990),
  ('00000000-0000-0000-0000-0000000000b1','Sansevieria enana Compacta',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),18990),
  ('00000000-0000-0000-0000-0000000000b1','Menta',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),4990),
  ('00000000-0000-0000-0000-0000000000b1','Oregano',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),4990),
  ('00000000-0000-0000-0000-0000000000b1','Cedrón',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),4990),
  ('00000000-0000-0000-0000-0000000000b1','Peperomia caperata',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),9990),
  ('00000000-0000-0000-0000-0000000000b1','Scheflera amarilla',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),15990),
  ('00000000-0000-0000-0000-0000000000b1','Aralia japónica grande',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),31990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro Paraguayo S',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),8990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro Paraguayo XL',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),18990),
  ('00000000-0000-0000-0000-0000000000b1','Gomero Burgundy M',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),11990),
  ('00000000-0000-0000-0000-0000000000b1','Gomero Burgundy L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),14990),
  ('00000000-0000-0000-0000-0000000000b1','Gomero Burgundy XL',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),39990),
  ('00000000-0000-0000-0000-0000000000b1','Ctenanthe lubesiana',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),15990),
  ('00000000-0000-0000-0000-0000000000b1','Ctenanthe Burle-Marxii',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),20990),
  ('00000000-0000-0000-0000-0000000000b1','Ficus anastacia',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),15990),
  ('00000000-0000-0000-0000-0000000000b1','Ficus Lyrata Bambino',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),12990),
  ('00000000-0000-0000-0000-0000000000b1','Ficus Benjamina',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),15990),
  ('00000000-0000-0000-0000-0000000000b1','Ficus Altissima',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),15990),
  ('00000000-0000-0000-0000-0000000000b1','Gomero Tineke',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),14990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro ring of fire',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),28990),
  ('00000000-0000-0000-0000-0000000000b1','Calathea',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),39990),
  ('00000000-0000-0000-0000-0000000000b1','Marantha',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),17990),
  ('00000000-0000-0000-0000-0000000000b1','Peperomia obstusifolia',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),12990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro princess green',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),28990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro Silver',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),15990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro pink princess',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),28990),
  ('00000000-0000-0000-0000-0000000000b1','Spathyphylium L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),17990),
  ('00000000-0000-0000-0000-0000000000b1','Syngonium S',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),7990),
  ('00000000-0000-0000-0000-0000000000b1','Syngonium L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),13990),
  ('00000000-0000-0000-0000-0000000000b1','Yucca variegada',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),28990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro imperial golden',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),28990),
  ('00000000-0000-0000-0000-0000000000b1','Dracena lemon surprice',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),27990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro princess of orange',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),28990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro birkin',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),25990),
  ('00000000-0000-0000-0000-0000000000b1','Jade',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),12990),
  ('00000000-0000-0000-0000-0000000000b1','Portulacaria Afra',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),19990),
  ('00000000-0000-0000-0000-0000000000b1','Aphelandra',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),9990),
  ('00000000-0000-0000-0000-0000000000b1','Dracena marginata',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),14990),
  ('00000000-0000-0000-0000-0000000000b1','Dracena Janet Craing',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),15990),
  ('00000000-0000-0000-0000-0000000000b1','Cissus Ellendanica',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),8990),
  ('00000000-0000-0000-0000-0000000000b1','Cuphea Colombiana',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),11990),
  ('00000000-0000-0000-0000-0000000000b1','Corona del Inca',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),3990),
  ('00000000-0000-0000-0000-0000000000b1','Peperomia cucharita',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),9990),
  ('00000000-0000-0000-0000-0000000000b1','Ficus pumila repens',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),7990),
  ('00000000-0000-0000-0000-0000000000b1','Helecho vivipara',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),9990),
  ('00000000-0000-0000-0000-0000000000b1','Helecho espárrago',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),8990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro monstera Deliciosa M',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),15000),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro monstera Deliciosa XL',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),25000),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro Cordatum',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),14990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro Cordatum variegado',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),17990),
  ('00000000-0000-0000-0000-0000000000b1','Philodendro Cordatum lemon',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),17990),
  ('00000000-0000-0000-0000-0000000000b1','Sansevieria Superba',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),18990),
  ('00000000-0000-0000-0000-0000000000b1','Scindapsus Aureus',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),16990),
  ('00000000-0000-0000-0000-0000000000b1','Scindapsus Lemon',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),16990),
  ('00000000-0000-0000-0000-0000000000b1','Scheflera verde',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),14990),
  ('00000000-0000-0000-0000-0000000000b1','Yucca punta',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),12000),
  ('00000000-0000-0000-0000-0000000000b1','Spathyphylium Sweet Pablo XL',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='plantas'),21990),
  ('00000000-0000-0000-0000-0000000000b1','Myco+ 10g',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),8990),
  ('00000000-0000-0000-0000-0000000000b1','Vitalipro+ 10g',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),8990),
  ('00000000-0000-0000-0000-0000000000b1','Tricobac+ 10g',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),8990),
  ('00000000-0000-0000-0000-0000000000b1','Bioprotec+ 10g',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),12990),
  ('00000000-0000-0000-0000-0000000000b1','Carbo+ 10g',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),8990),
  ('00000000-0000-0000-0000-0000000000b1','Vitalical+ 10g',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),8990),
  ('00000000-0000-0000-0000-0000000000b1','Vitaliterp+ 10g',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),8990),
  ('00000000-0000-0000-0000-0000000000b1','EcoClean+ 120ml',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),14990),
  ('00000000-0000-0000-0000-0000000000b1','Sustrato interior 10L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),9990),
  ('00000000-0000-0000-0000-0000000000b1','Sustrato orquideas 2L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),6990),
  ('00000000-0000-0000-0000-0000000000b1','Nuba 280cc',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),6990),
  ('00000000-0000-0000-0000-0000000000b1','Nuba 1L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),19990),
  ('00000000-0000-0000-0000-0000000000b1','Asedio 280cc',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),6990),
  ('00000000-0000-0000-0000-0000000000b1','Asedio 1L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),19990),
  ('00000000-0000-0000-0000-0000000000b1','Jabón potásico 280cc',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),5990),
  ('00000000-0000-0000-0000-0000000000b1','Jabón potásico 1L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),8990),
  ('00000000-0000-0000-0000-0000000000b1','Bokashi 5L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),7990),
  ('00000000-0000-0000-0000-0000000000b1','Tierra de diatoméas 500g',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),5990),
  ('00000000-0000-0000-0000-0000000000b1','Humus de lombriz 3L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),3990),
  ('00000000-0000-0000-0000-0000000000b1','Sustrato cactus 6L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),6590),
  ('00000000-0000-0000-0000-0000000000b1','Sustrato plantas de interior 20L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),14990),
  ('00000000-0000-0000-0000-0000000000b1','L GRIS S',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','L GRIS M',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','L GRIS L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','C1 M',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','C1 L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','C1 XL',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','L VERDE S',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','L VERDE M',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','L VERDE L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','WHG S',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','WHG M',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','WHG L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','WHI S',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','WHI M',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','WHI L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),0),
  ('00000000-0000-0000-0000-0000000000b1','Maceta GOLD L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),16990),
  ('00000000-0000-0000-0000-0000000000b1','Termohigrometro mini',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),5990),
  ('00000000-0000-0000-0000-0000000000b1','Tutor fibra de coco 30 cm',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),3990),
  ('00000000-0000-0000-0000-0000000000b1','Regadera Metálica 1L',(select id from public.category where business_id='00000000-0000-0000-0000-0000000000b1' and key='productos'),12990);

insert into public.inventory (product_id, branch_id, stock)
select p.id, '00000000-0000-0000-0000-0000000000f1', v.stock from public.product p
join (values
  ('Palma Chamadorea'::text, 3),
  ('Crotón'::text, 0),
  ('Dólar variegado'::text, 0),
  ('Philodendro Longifolio'::text, 0),
  ('Philodendro Monstera Thai'::text, 0),
  ('Sansevieria enana Compacta'::text, 0),
  ('Menta'::text, 0),
  ('Oregano'::text, 0),
  ('Cedrón'::text, 0),
  ('Peperomia caperata'::text, 0),
  ('Scheflera amarilla'::text, 0),
  ('Aralia japónica grande'::text, 0),
  ('Philodendro Paraguayo S'::text, 0),
  ('Philodendro Paraguayo XL'::text, 0),
  ('Gomero Burgundy M'::text, 0),
  ('Gomero Burgundy L'::text, 0),
  ('Gomero Burgundy XL'::text, 0),
  ('Ctenanthe lubesiana'::text, 0),
  ('Ctenanthe Burle-Marxii'::text, 0),
  ('Ficus anastacia'::text, 0),
  ('Ficus Lyrata Bambino'::text, 0),
  ('Ficus Benjamina'::text, 0),
  ('Ficus Altissima'::text, 0),
  ('Gomero Tineke'::text, 0),
  ('Philodendro ring of fire'::text, 0),
  ('Calathea'::text, 0),
  ('Marantha'::text, 0),
  ('Peperomia obstusifolia'::text, 0),
  ('Philodendro princess green'::text, 0),
  ('Philodendro Silver'::text, 0),
  ('Philodendro pink princess'::text, 0),
  ('Spathyphylium L'::text, 0),
  ('Syngonium S'::text, 0),
  ('Syngonium L'::text, 0),
  ('Yucca variegada'::text, 0),
  ('Philodendro imperial golden'::text, 0),
  ('Dracena lemon surprice'::text, 0),
  ('Philodendro princess of orange'::text, 0),
  ('Philodendro birkin'::text, 0),
  ('Jade'::text, 0),
  ('Portulacaria Afra'::text, 0),
  ('Aphelandra'::text, 0),
  ('Dracena marginata'::text, 0),
  ('Dracena Janet Craing'::text, 0),
  ('Cissus Ellendanica'::text, 0),
  ('Cuphea Colombiana'::text, 0),
  ('Corona del Inca'::text, 0),
  ('Peperomia cucharita'::text, 0),
  ('Ficus pumila repens'::text, 0),
  ('Helecho vivipara'::text, 0),
  ('Helecho espárrago'::text, 0),
  ('Philodendro monstera Deliciosa M'::text, 0),
  ('Philodendro monstera Deliciosa XL'::text, 0),
  ('Philodendro Cordatum'::text, 0),
  ('Philodendro Cordatum variegado'::text, 0),
  ('Philodendro Cordatum lemon'::text, 0),
  ('Sansevieria Superba'::text, 0),
  ('Scindapsus Aureus'::text, 0),
  ('Scindapsus Lemon'::text, 0),
  ('Scheflera verde'::text, 0),
  ('Yucca punta'::text, 0),
  ('Spathyphylium Sweet Pablo XL'::text, 0),
  ('Myco+ 10g'::text, 10),
  ('Vitalipro+ 10g'::text, 10),
  ('Tricobac+ 10g'::text, 10),
  ('Bioprotec+ 10g'::text, 10),
  ('Carbo+ 10g'::text, 10),
  ('Vitalical+ 10g'::text, 10),
  ('Vitaliterp+ 10g'::text, 10),
  ('EcoClean+ 120ml'::text, 10),
  ('Sustrato interior 10L'::text, 60),
  ('Sustrato orquideas 2L'::text, 20),
  ('Nuba 280cc'::text, 10),
  ('Nuba 1L'::text, 5),
  ('Asedio 280cc'::text, 10),
  ('Asedio 1L'::text, 5),
  ('Jabón potásico 280cc'::text, 10),
  ('Jabón potásico 1L'::text, 5),
  ('Bokashi 5L'::text, 10),
  ('Tierra de diatoméas 500g'::text, 10),
  ('Humus de lombriz 3L'::text, 10),
  ('Sustrato cactus 6L'::text, 10),
  ('Sustrato plantas de interior 20L'::text, 10),
  ('L GRIS S'::text, 6),
  ('L GRIS M'::text, 6),
  ('L GRIS L'::text, 6),
  ('C1 M'::text, 4),
  ('C1 L'::text, 4),
  ('C1 XL'::text, 4),
  ('L VERDE S'::text, 6),
  ('L VERDE M'::text, 6),
  ('L VERDE L'::text, 6),
  ('WHG S'::text, 6),
  ('WHG M'::text, 6),
  ('WHG L'::text, 6),
  ('WHI S'::text, 4),
  ('WHI M'::text, 4),
  ('WHI L'::text, 4),
  ('Maceta GOLD L'::text, 12),
  ('Termohigrometro mini'::text, 10),
  ('Tutor fibra de coco 30 cm'::text, 25),
  ('Regadera Metálica 1L'::text, 6)
) as v(name, stock) on v.name = p.name
where p.business_id = '00000000-0000-0000-0000-0000000000b1';
