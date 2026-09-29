-- ==========================================================================
-- OdontoCampus — Migración 009: la bolsa, moderada y con datos de contacto
--
-- Aplicar DESPUÉS de 001 a 008:
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < 009_bolsa_moderada.sql
--
-- Y después, siempre, pruebas_rls.sql.
--
-- --------------------------------------------------------------------------
-- QUÉ CAMBIA (decisión de FOE, septiembre de 2026)
--
-- 1. Dos tipos de publicación: "venta" (vendo algo) y "compra" (busco algo,
--    por si alguien lo vende). Se filtran por separado.
--
-- 2. Para publicar hacen falta el legajo y un teléfono en el perfil.
--    · El legajo lo ve sólo quien administra, para comprobar que es
--      estudiante. Nadie más: no está en las columnas que se pueden leer.
--    · El teléfono se entrega sólo por contacto_bolsa(), a quien tiene
--      sesión, y sólo de publicaciones aprobadas y vigentes.
--
-- 3. Toda publicación entra como "pendiente" y aparece recién cuando un
--    admin la aprueba. Si su dueño cambia el contenido, vuelve a pendiente:
--    si no, se aprobaría una cosa y se publicaría otra.
--
-- 4. El tope de 5 cuenta lo que está en circulación: pendientes y activas.
-- ==========================================================================

begin;


-- ==========================================================================
-- 1. PERFIL: legajo
-- ==========================================================================
alter table public.perfiles
  add column if not exists legajo text
    check (legajo is null or legajo ~ '^[0-9]{3,7}/[0-9]{1,2}$');

-- Se puede escribir el propio (la política de perfiles ya lo limita a la
-- fila propia), pero no leer el de otros: no se agrega al grant de SELECT.
grant update (legajo) on public.perfiles to authenticated;

-- ¿Tengo lo necesario para publicar? La usa la política de inserción: esa
-- política corre con los permisos de quien publica, que no puede leer las
-- columnas de contacto, así que la pregunta la hace esta función.
create or replace function public.tengo_datos_de_contacto()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.legajo is not null and p.whatsapp is not null
  );
$$;

revoke all on function public.tengo_datos_de_contacto() from public, anon;
grant execute on function public.tengo_datos_de_contacto() to authenticated;


-- ==========================================================================
-- 2. PUBLICACIONES: tipo y moderación
-- ==========================================================================
alter table public.publicaciones_bolsa
  add column if not exists tipo text not null default 'venta'
    check (tipo in ('venta', 'compra')),
  add column if not exists aprobada_at timestamptz,
  add column if not exists aprobada_por uuid references auth.users(id) on delete set null,
  add column if not exists motivo_rechazo text check (motivo_rechazo is null or char_length(motivo_rechazo) <= 300);

-- Lo que estaba publicado antes de moderar queda como aprobado.
update public.publicaciones_bolsa set aprobada_at = creado_at
where estado in ('activa', 'pausada', 'vendida') and aprobada_at is null;

alter table public.publicaciones_bolsa
  drop constraint if exists publicaciones_bolsa_estado_check;
alter table public.publicaciones_bolsa
  add constraint publicaciones_bolsa_estado_check
  check (estado in ('pendiente', 'activa', 'pausada', 'vendida', 'rechazada', 'oculta'));
alter table public.publicaciones_bolsa alter column estado set default 'pendiente';

-- En un pedido de compra no hay "estado de uso".
alter table public.publicaciones_bolsa alter column estado_uso drop not null;
alter table public.publicaciones_bolsa
  add constraint bolsa_estado_uso_en_ventas
  check (tipo = 'compra' or estado_uso is not null);

grant insert (tipo) on public.publicaciones_bolsa to authenticated;
grant update (tipo) on public.publicaciones_bolsa to authenticated;


-- --------------------------------------------------------------------------
-- Publicar: además de lo de siempre (cuenta activa y pasadas 24 horas),
-- legajo y teléfono cargados.
-- --------------------------------------------------------------------------
drop policy if exists "bolsa: publicar la propia" on public.publicaciones_bolsa;
create policy "bolsa: publicar la propia"
  on public.publicaciones_bolsa for insert
  to authenticated
  with check (
    (select auth.uid()) = usuario_id
    and (select public.puedo_publicar())
    and (select public.tengo_datos_de_contacto())
  );

-- Editar la propia: puede dejarla pendiente (lo hace el disparador al cambiar
-- el contenido), pausarla, marcarla vendida o reactivarla si ya estaba
-- aprobada. 'oculta' y 'rechazada' son decisiones de moderación.
drop policy if exists "bolsa: editar la propia" on public.publicaciones_bolsa;
create policy "bolsa: editar la propia"
  on public.publicaciones_bolsa for update
  to authenticated
  using  ((select auth.uid()) = usuario_id and estado <> 'oculta')
  with check ((select auth.uid()) = usuario_id and estado in ('pendiente', 'activa', 'pausada', 'vendida'));


-- --------------------------------------------------------------------------
-- El dueño no se aprueba solo.
--
-- Corre sólo cuando la edición viene de la API (rol authenticated). Las
-- funciones de administración corren como su dueño y no pasan por acá.
-- --------------------------------------------------------------------------
create or replace function public.moderar_edicion_bolsa()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- Cambió lo que se publica: vuelve a revisión.
  if new.titulo is distinct from old.titulo
     or new.categoria is distinct from old.categoria
     or new.precio_texto is distinct from old.precio_texto
     or new.estado_uso is distinct from old.estado_uso
     or new.ubicacion is distinct from old.ubicacion
     or new.descripcion is distinct from old.descripcion
     or new.tipo is distinct from old.tipo then
    new.estado := 'pendiente';
    new.aprobada_at := null;
    new.aprobada_por := null;
    new.motivo_rechazo := null;
    return new;
  end if;

  -- Sin cambios de contenido, sólo se puede volver a 'activa' algo que ya
  -- estaba aprobado.
  if new.estado = 'activa' and old.estado <> 'activa' and old.aprobada_at is null then
    raise exception 'La publicación todavía no fue aprobada'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists bolsa_moderar_edicion on public.publicaciones_bolsa;
create trigger bolsa_moderar_edicion
  before update on public.publicaciones_bolsa
  for each row execute function public.moderar_edicion_bolsa();


-- --------------------------------------------------------------------------
-- Tope: 5 en circulación (pendientes + activas). Reemplaza al de 002.
-- --------------------------------------------------------------------------
create or replace function public.limitar_publicaciones_activas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.estado in ('activa', 'pendiente')
     and (tg_op = 'INSERT' or old.estado not in ('activa', 'pendiente'))
     and (
       select count(*)
       from public.publicaciones_bolsa b
       where b.usuario_id = new.usuario_id
         and b.estado in ('activa', 'pendiente')
         and b.expira_at > now()
         and b.id <> new.id
     ) >= 5
  then
    raise exception 'Llegaste al máximo de 5 publicaciones en circulación'
      using errcode = 'insufficient_privilege',
            hint = 'Pausá, borrá o marcá como vendida alguna para publicar otra.';
  end if;
  return new;
end;
$$;


-- ==========================================================================
-- 3. CONTACTO
-- ==========================================================================
create or replace function public.contacto_bolsa(p_publicacion uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  telefono text;
begin
  if auth.uid() is null then
    raise exception 'Necesitás ingresar a tu cuenta' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.perfiles p where p.id = auth.uid() and p.estado = 'activo') then
    raise exception 'Tu cuenta no puede contactar publicaciones' using errcode = 'insufficient_privilege';
  end if;

  select p.whatsapp into telefono
  from public.publicaciones_bolsa b
  join public.perfiles p on p.id = b.usuario_id
  where b.id = p_publicacion
    and b.estado = 'activa'
    and b.expira_at > now()
    and p.estado = 'activo';

  if telefono is null then
    raise exception 'Esa publicación ya no está disponible' using errcode = 'no_data_found';
  end if;
  return telefono;
end;
$$;

revoke all on function public.contacto_bolsa(uuid) from public, anon;
grant execute on function public.contacto_bolsa(uuid) to authenticated;


-- ==========================================================================
-- 4. MODERACIÓN (panel de administración)
-- ==========================================================================
create or replace function public.admin_bolsa_pendientes()
returns table (
  id uuid, tipo text, titulo text, categoria text, precio_texto text, estado_uso text,
  ubicacion text, descripcion text, creado_at timestamptz,
  autor_id uuid, autor_nombre text, autor_email text, autor_legajo text, autor_telefono text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_admin();
  return query
  select b.id, b.tipo, b.titulo, b.categoria, b.precio_texto, b.estado_uso,
         b.ubicacion, b.descripcion, b.creado_at,
         b.usuario_id, p.nombre_visible, u.email::text, p.legajo, p.whatsapp
  from public.publicaciones_bolsa b
  join auth.users u on u.id = b.usuario_id
  left join public.perfiles p on p.id = b.usuario_id
  where b.estado = 'pendiente'
  order by b.creado_at;
end;
$$;


create or replace function public.admin_moderar_bolsa(p_publicacion uuid, p_aprobar boolean, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  titulo_pub text;
  motivo text := left(trim(coalesce(p_motivo, '')), 300);
begin
  perform public.exigir_admin();

  select b.titulo into titulo_pub from public.publicaciones_bolsa b
  where b.id = p_publicacion and b.estado = 'pendiente';
  if titulo_pub is null then
    raise exception 'Esa publicación ya no está pendiente' using errcode = 'no_data_found';
  end if;

  if p_aprobar then
    update public.publicaciones_bolsa
       set estado = 'activa', aprobada_at = now(), aprobada_por = auth.uid(),
           motivo_rechazo = null, expira_at = now() + interval '60 days'
     where id = p_publicacion;
    perform public.anotar_admin('aprobar_bolsa', null, left(titulo_pub, 80), null);
  else
    if char_length(motivo) < 5 then
      raise exception 'Escribí el motivo del rechazo: se le muestra a quien publicó'
        using errcode = 'check_violation';
    end if;
    update public.publicaciones_bolsa
       set estado = 'rechazada', motivo_rechazo = motivo
     where id = p_publicacion;
    perform public.anotar_admin('rechazar_bolsa', null, left(titulo_pub, 80), jsonb_build_object('motivo', motivo));
  end if;
end;
$$;


-- El resumen del panel suma las pendientes de la bolsa.
create or replace function public.admin_bolsa_cantidad_pendientes()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_admin();
  return (select count(*) from public.publicaciones_bolsa where estado = 'pendiente');
end;
$$;

revoke all on function public.admin_bolsa_pendientes() from public, anon;
revoke all on function public.admin_moderar_bolsa(uuid, boolean, text) from public, anon;
revoke all on function public.admin_bolsa_cantidad_pendientes() from public, anon;
grant execute on function public.admin_bolsa_pendientes() to authenticated;
grant execute on function public.admin_moderar_bolsa(uuid, boolean, text) to authenticated;
grant execute on function public.admin_bolsa_cantidad_pendientes() to authenticated;

notify pgrst, 'reload schema';

commit;
