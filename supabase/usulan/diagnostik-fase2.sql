-- =====================================================================
-- DIAGNOSTIK FASE 2 (pesanan v2 & POS) — HANYA MEMBACA, tidak mengubah apa pun.
-- Jalankan di SQL Editor, lalu Export → CSV (atau copy semua baris) dan kirim hasilnya.
-- Tidak menampilkan data pribadi customer (hanya struktur + jumlah baris).
-- =====================================================================
select 'column' as kind,
       c.table_name || '.' || c.column_name as name,
       c.udt_name
         || case when c.is_nullable = 'NO' then ' NOT NULL' else '' end
         || coalesce(' DEFAULT ' || c.column_default, '') as detail
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('orders', 'order_items', 'payments', 'order_status_events', 'cafe_settings', 'cafe_tables', 'ingredients')
union all
select 'constraint', conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid)
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text in ('orders', 'order_items', 'payments')
union all
select 'index', tablename || '.' || indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename in ('orders', 'order_items', 'payments')
union all
select 'trigger_def', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('orders', 'order_items', 'payments')
  and not t.tgisinternal
union all
select 'function_def', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end || chr(10) || pg_get_functiondef(p.oid)
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'create_order', 'enforce_order_status_workflow', 'set_order_item_snapshot_fields', 'update_order_total',
    'assign_order_queue_number', 'log_order_status_event', 'staff_mark_order_paid', 'staff_cancel_order',
    'record_customer_payment_simulation'
  )
union all
select 'policy', tablename || '.' || policyname,
       cmd || ' | ' || array_to_string(roles, ',') || ' | using: ' || coalesce(qual, '-') || ' | check: ' || coalesce(with_check, '-')
from pg_policies
where schemaname = 'public' and tablename in ('orders', 'order_items', 'payments')
union all
select 'table_grant', table_name, grantee || ' | ' || string_agg(privilege_type, ',' order by privilege_type)
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('orders', 'order_items', 'payments')
  and grantee in ('anon', 'authenticated')
group by table_name, grantee
union all
select 'column_grant', table_name || '.' || column_name, grantee || ' ' || privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name in ('orders', 'order_items', 'payments')
  and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE')
union all
select 'enum', t.typname, string_agg(e.enumlabel, ', ' order by e.enumsortorder)
from pg_type t
join pg_enum e on e.enumtypid = t.oid
where t.typnamespace = 'public'::regnamespace
group by t.typname
union all
select 'stats', 'orders',
       (select count(*) from public.orders)::text || ' pesanan · '
       || (select count(*) from public.orders where customer_id is null)::text || ' tanpa customer · status: '
       || coalesce((select string_agg(s, ', ') from (select order_status::text || '=' || count(*) as s from public.orders group by order_status) x), '-')
union all
select 'stats', 'payments',
       (select count(*) from public.payments)::text || ' baris · metode: '
       || coalesce((select string_agg(s, ', ') from (select coalesce(method::text, '?') || '=' || count(*) as s from public.payments group by method) x), '-')
union all
select 'realtime', tablename, pubname
from pg_publication_tables
where pubname = 'supabase_realtime'
union all
select 'file05', 'ingredients', case when to_regclass('public.ingredients') is null then 'BELUM dijalankan' else 'SUDAH dijalankan' end
order by 1, 2;
