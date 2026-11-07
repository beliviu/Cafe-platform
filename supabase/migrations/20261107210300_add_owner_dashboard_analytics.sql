create or replace function public.owner_dashboard_analytics(
  p_cafe_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null
     or not public.has_cafe_role(p_cafe_id, array['owner']::public.app_role[]) then
    raise exception 'Owner access is required for this cafe'
      using errcode = '42501';
  end if;

  if p_start_date is null
     or p_end_date is null
     or p_end_date < p_start_date
     or p_end_date - p_start_date > 89 then
    raise exception 'Date range must be between 1 and 90 days'
      using errcode = '22023';
  end if;

  with orders_in_range as (
    select
      o.id,
      o.order_number,
      o.customer_id,
      o.total_amount,
      o.order_status,
      o.payment_status,
      o.payment_method,
      o.created_at
    from public.orders as o
    where o.cafe_id = p_cafe_id
      and o.created_at >= p_start_date::timestamptz
      and o.created_at < (p_end_date + 1)::timestamptz
  ),
  summary as (
    select
      count(*) as total_orders,
      count(*) filter (
        where o.payment_status = 'paid'
          and o.order_status <> 'cancelled'
      ) as paid_orders,
      coalesce(
        sum(o.total_amount) filter (
          where o.payment_status = 'paid'
            and o.order_status <> 'cancelled'
        ),
        0
      ) as revenue
    from orders_in_range as o
  ),
  daily_revenue as (
    select
      calendar.day::date as day,
      coalesce(sum(o.total_amount), 0) as amount
    from generate_series(
      p_start_date::timestamp,
      p_end_date::timestamp,
      interval '1 day'
    ) as calendar(day)
    left join orders_in_range as o
      on o.created_at >= calendar.day
      and o.created_at < calendar.day + interval '1 day'
      and o.payment_status = 'paid'
      and o.order_status <> 'cancelled'
    group by calendar.day
    order by calendar.day
  ),
  popular_products as (
    select
      i.product_name,
      sum(i.quantity)::bigint as quantity_sold,
      sum(i.subtotal) as revenue
    from public.order_items as i
    join orders_in_range as o on o.id = i.order_id
    where i.cafe_id = p_cafe_id
      and o.payment_status = 'paid'
      and o.order_status <> 'cancelled'
    group by i.product_name
    order by quantity_sold desc, revenue desc, i.product_name
    limit 5
  ),
  recent_orders as (
    select
      o.order_number,
      o.total_amount,
      o.order_status,
      o.payment_status,
      o.payment_method,
      o.created_at
    from orders_in_range as o
    order by o.created_at desc
    limit 8
  )
  select jsonb_build_object(
    'summary', (
      select jsonb_build_object(
        'revenue', s.revenue,
        'total_orders', s.total_orders,
        'paid_orders', s.paid_orders,
        'average_order_value', coalesce(
          round(s.revenue / nullif(s.paid_orders, 0), 2),
          0
        )
      )
      from summary as s
    ),
    'revenue_by_day', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('date', d.day, 'amount', d.amount)
          order by d.day
        )
        from daily_revenue as d
      ),
      '[]'::jsonb
    ),
    'popular_products', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'name', p.product_name,
            'quantity_sold', p.quantity_sold,
            'revenue', p.revenue
          )
          order by p.quantity_sold desc, p.revenue desc, p.product_name
        )
        from popular_products as p
      ),
      '[]'::jsonb
    ),
    'recent_orders', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'order_number', r.order_number,
            'total_amount', r.total_amount,
            'order_status', r.order_status,
            'payment_status', r.payment_status,
            'payment_method', r.payment_method,
            'created_at', r.created_at
          )
          order by r.created_at desc
        )
        from recent_orders as r
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.owner_dashboard_analytics(uuid, date, date)
  from public, anon;
grant execute on function public.owner_dashboard_analytics(uuid, date, date)
  to authenticated;
