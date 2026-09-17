-- ==========================================================================
-- OdontoCampus — Migración 005: administración
--
-- Aplicar DESPUÉS de 001 a 004:
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < 005_administracion.sql
--
-- Después, dar el rol a la primera persona (con su correo):
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -v email="nombre@ejemplo.com" < otorgar_admin.sql
--
-- Y después, siempre, pruebas_rls.sql.
--
-- --------------------------------------------------------------------------
-- QUÉ AGREGA
--
-- 1. El rol de administrador (`administradores`). Nadie se lo puede dar a sí
--    mismo desde el sitio: la primera persona se carga en el servidor con
--    otorgar_admin.sql, y a partir de ahí una administradora puede sumar a
--    otras desde el panel.
--
-- 2. Un registro de todo lo que se hace desde el panel (`registro_admin`):
--    quién, qué, sobre quién y cuándo. Si algo sale mal, se puede reconstruir.
--    Nadie lo puede editar ni borrar desde el sitio, ni siquiera un admin.
--
-- 3. La configuración que se cambia sin tocar código (`configuracion_sitio`):
--    por ahora, qué planillas de Google leen las mesas y las reválidas.
--
-- 4. Las funciones del panel. Todo lo que hace un admin pasa por una de estas
--    funciones, que primero verifican que quien llama sea admin. No hay
--    ninguna política de RLS que abra tablas enteras a los admins: si alguien
--    roba una sesión de admin, puede hacer exactamente lo que dicen estas
--    funciones, y todo queda registrado.
--
-- LO QUE EL PANEL NO MUESTRA, A PROPÓSITO:
--   Las materias, notas y cursos de nadie. Al registrarse se promete que se
--   usan sólo para mostrárselos a cada quien. El panel ve cuentas (nombre,
--   correo, fechas, estado), no carreras.
-- ==========================================================================

begin;


-- ==========================================================================
-- 1. ROL DE ADMINISTRADOR
-- ==========================================================================
create table public.administradores (
  usuario_id   uuid primary key references auth.users(id) on delete cascade,
  otorgado_at  timestamptz not null default now(),
  -- null cuando lo otorgó alguien desde el servidor (otorgar_admin.sql)
  otorgado_por uuid references auth.users(id) on delete set null
);

alter table public.administradores enable row level security;
-- Sin políticas y sin permisos: sólo se lee a través de las funciones.
revoke all on public.administradores from anon, authenticated;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.administradores a where a.usuario_id = auth.uid()
  );
$$;

revoke all on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;


-- ==========================================================================
-- 2. REGISTRO DE ACCIONES
-- ==========================================================================
create table public.registro_admin (
  id           bigint generated always as identity primary key,
  -- Se guarda también el correo: si la cuenta del admin se borra, el
  -- registro sigue diciendo quién fue.
  admin_id     uuid references auth.users(id) on delete set null,
  admin_email  text,
  accion       text not null,
  objetivo_id  uuid,
  objetivo     text,
  detalle      jsonb,
  creado_at    timestamptz not null default now()
);

create index registro_admin_fecha_idx on public.registro_admin (creado_at desc);

alter table public.registro_admin enable row level security;
revoke all on public.registro_admin from anon, authenticated;

create or replace function public.anotar_admin(p_accion text, p_objetivo_id uuid, p_objetivo text, p_detalle jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.registro_admin (admin_id, admin_email, accion, objetivo_id, objetivo, detalle)
  values (
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid()),
    p_accion, p_objetivo_id, p_objetivo, p_detalle
  );
$$;

revoke all on function public.anotar_admin(text, uuid, text, jsonb) from public, anon, authenticated;


-- Corta el paso a quien no es admin. Cada función del panel la llama primero.
create or replace function public.exigir_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.es_admin() then
    raise exception 'Esta acción es sólo para administradores'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function public.exigir_admin() from public, anon, authenticated;


-- ==========================================================================
-- 3. CONFIGURACIÓN DEL SITIO (pública para leer)
-- ==========================================================================
create table public.configuracion_sitio (
  clave           text primary key check (clave in ('planilla_mesas', 'planilla_revalidas')),
  valor           jsonb not null,
  actualizado_at  timestamptz not null default now(),
  actualizado_por uuid references auth.users(id) on delete set null
);

alter table public.configuracion_sitio enable row level security;

create policy "configuración: lectura pública" on public.configuracion_sitio
  for select to anon, authenticated using (true);

revoke all on public.configuracion_sitio from anon, authenticated;
grant select (clave, valor, actualizado_at) on public.configuracion_sitio to anon, authenticated;

-- Las planillas que el sitio usa hoy.
insert into public.configuracion_sitio (clave, valor) values
  ('planilla_mesas',     '{"sheet_id": "1NC_lABOKN0w-RaxiAXVQwBvdJqGw4F6dAXHWSK2fi6I", "gid": "0"}'),
  ('planilla_revalidas', '{"sheet_id": "1KWy04FseDtScAqYQ3kFopI_0jnfbmzd0gxl53tevD9M", "gid": "0"}')
on conflict (clave) do nothing;


-- ==========================================================================
-- 4. FUNCIONES DEL PANEL
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Resumen: sólo cuentas. Nada sobre carreras (ver el encabezado).
-- --------------------------------------------------------------------------
create or replace function public.admin_resumen()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_admin();
  return jsonb_build_object(
    'cuentas',       (select count(*) from auth.users),
    'confirmadas',   (select count(*) from auth.users where email_confirmed_at is not null),
    'sin_confirmar', (select count(*) from auth.users where email_confirmed_at is null),
    'nuevas_7_dias', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'suspendidas',   (select count(*) from public.perfiles where estado = 'suspendido'),
    'admins',        (select count(*) from public.administradores)
  );
end;
$$;


-- --------------------------------------------------------------------------
-- Listado de cuentas, con búsqueda por nombre o correo y paginado.
-- --------------------------------------------------------------------------
create or replace function public.admin_listar_usuarios(
  p_busqueda text default null,
  p_limite   int  default 50,
  p_desde    int  default 0
)
returns table (
  id               uuid,
  email            text,
  nombre           text,
  creado_at        timestamptz,
  confirmado_at    timestamptz,
  ultimo_ingreso   timestamptz,
  estado           text,
  es_admin         boolean,
  total            bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  patron text := '%' || coalesce(nullif(trim(p_busqueda), ''), '') || '%';
begin
  perform public.exigir_admin();

  return query
  with filtradas as (
    select u.id, u.email::text, p.nombre_visible, u.created_at, u.email_confirmed_at,
           u.last_sign_in_at, coalesce(p.estado, 'activo') as estado,
           (a.usuario_id is not null) as es_admin
    from auth.users u
    left join public.perfiles p on p.id = u.id
    left join public.administradores a on a.usuario_id = u.id
    where u.email ilike patron or p.nombre_visible ilike patron
  )
  select f.id, f.email, f.nombre_visible, f.created_at, f.email_confirmed_at,
         f.last_sign_in_at, f.estado, f.es_admin, count(*) over ()
  from filtradas f
  order by f.created_at desc
  limit least(greatest(coalesce(p_limite, 50), 1), 200)
  offset greatest(coalesce(p_desde, 0), 0);
end;
$$;


-- --------------------------------------------------------------------------
-- Datos de una cuenta para operar sobre ella (y validaciones comunes).
-- --------------------------------------------------------------------------
create or replace function public.admin_cuenta_operable(p_usuario uuid, p_accion text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  correo text;
begin
  select u.email into correo from auth.users u where u.id = p_usuario;
  if correo is null then
    raise exception 'No existe esa cuenta' using errcode = 'no_data_found';
  end if;
  if p_usuario = auth.uid() then
    raise exception 'No podés % tu propia cuenta desde el panel', p_accion
      using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.administradores a where a.usuario_id = p_usuario) then
    raise exception 'Es una cuenta de administración: primero quitale el rol'
      using errcode = 'insufficient_privilege';
  end if;
  return correo;
end;
$$;

revoke all on function public.admin_cuenta_operable(uuid, text) from public, anon, authenticated;


-- --------------------------------------------------------------------------
-- Suspender: no puede ingresar ni renovar su sesión, ni publicar.
-- --------------------------------------------------------------------------
create or replace function public.admin_suspender(p_usuario uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  correo text;
  motivo text := left(trim(coalesce(p_motivo, '')), 300);
begin
  perform public.exigir_admin();
  correo := public.admin_cuenta_operable(p_usuario, 'suspender');
  if char_length(motivo) < 5 then
    raise exception 'Escribí el motivo de la suspensión (queda en el registro)'
      using errcode = 'check_violation';
  end if;

  update public.perfiles set estado = 'suspendido' where id = p_usuario;
  -- GoTrue rechaza el ingreso y la renovación del token mientras esté vigente.
  update auth.users set banned_until = 'infinity' where id = p_usuario;
  -- Y se cierran las sesiones abiertas: sin esto, seguiría adentro hasta que
  -- venza su token actual.
  delete from auth.sessions where user_id = p_usuario;

  perform public.anotar_admin('suspender', p_usuario, correo, jsonb_build_object('motivo', motivo));
end;
$$;


create or replace function public.admin_reactivar(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  correo text;
begin
  perform public.exigir_admin();
  correo := public.admin_cuenta_operable(p_usuario, 'reactivar');

  update public.perfiles set estado = 'activo' where id = p_usuario;
  update auth.users set banned_until = null where id = p_usuario;

  perform public.anotar_admin('reactivar', p_usuario, correo, null);
end;
$$;


-- --------------------------------------------------------------------------
-- Confirmar el correo a mano: para cuando el mail de confirmación no llega.
-- --------------------------------------------------------------------------
create or replace function public.admin_confirmar_correo(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  correo text;
begin
  perform public.exigir_admin();
  select u.email into correo from auth.users u where u.id = p_usuario;
  if correo is null then
    raise exception 'No existe esa cuenta' using errcode = 'no_data_found';
  end if;

  update auth.users set email_confirmed_at = now()
  where id = p_usuario and email_confirmed_at is null;

  if found then
    perform public.anotar_admin('confirmar_correo', p_usuario, correo, null);
  end if;
end;
$$;


-- --------------------------------------------------------------------------
-- Eliminar una cuenta. Pide escribir el correo, igual que al borrar la propia.
-- --------------------------------------------------------------------------
create or replace function public.admin_eliminar_usuario(p_usuario uuid, p_confirmacion text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  correo text;
begin
  perform public.exigir_admin();
  correo := public.admin_cuenta_operable(p_usuario, 'eliminar');

  if lower(trim(coalesce(p_confirmacion, ''))) <> lower(correo) then
    raise exception 'Para eliminar la cuenta, escribí su correo exactamente'
      using errcode = 'check_violation';
  end if;

  -- Primero el registro: después de borrar ya no se sabría a quién.
  perform public.anotar_admin('eliminar_cuenta', p_usuario, correo, null);
  delete from auth.users where id = p_usuario;
end;
$$;


-- --------------------------------------------------------------------------
-- Administradores
-- --------------------------------------------------------------------------
create or replace function public.admin_listar_admins()
returns table (id uuid, email text, nombre text, otorgado_at timestamptz, otorgado_por_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_admin();
  return query
  select a.usuario_id, u.email::text, p.nombre_visible, a.otorgado_at, o.email::text
  from public.administradores a
  join auth.users u on u.id = a.usuario_id
  left join public.perfiles p on p.id = a.usuario_id
  left join auth.users o on o.id = a.otorgado_por
  order by a.otorgado_at;
end;
$$;


create or replace function public.admin_otorgar(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  destino uuid;
  correo  text;
begin
  perform public.exigir_admin();

  select u.id, u.email into destino, correo
  from auth.users u where lower(u.email) = lower(trim(coalesce(p_email, '')));

  if destino is null then
    raise exception 'No hay ninguna cuenta con ese correo' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from auth.users u where u.id = destino and u.email_confirmed_at is not null) then
    raise exception 'Esa cuenta todavía no confirmó su correo' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.perfiles p where p.id = destino and p.estado = 'suspendido') then
    raise exception 'Esa cuenta está suspendida' using errcode = 'check_violation';
  end if;

  insert into public.administradores (usuario_id, otorgado_por)
  values (destino, auth.uid())
  on conflict (usuario_id) do nothing;

  if found then
    perform public.anotar_admin('otorgar_admin', destino, correo, null);
  end if;
end;
$$;


create or replace function public.admin_quitar(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  correo text;
begin
  perform public.exigir_admin();

  if p_usuario = auth.uid() then
    raise exception 'No podés quitarte el rol a vos: pedíselo a otra persona de administración'
      using errcode = 'insufficient_privilege';
  end if;

  select u.email into correo from auth.users u where u.id = p_usuario;
  delete from public.administradores where usuario_id = p_usuario;

  if found then
    perform public.anotar_admin('quitar_admin', p_usuario, correo, null);
  end if;
end;
$$;


-- --------------------------------------------------------------------------
-- Planillas de mesas y reválidas
-- --------------------------------------------------------------------------
create or replace function public.admin_guardar_planilla(p_clave text, p_sheet_id text, p_gid text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  anterior jsonb;
  nuevo    jsonb;
begin
  perform public.exigir_admin();

  if p_clave not in ('planilla_mesas', 'planilla_revalidas') then
    raise exception 'Planilla desconocida' using errcode = 'check_violation';
  end if;
  -- Los ids de Google Sheets: letras, números, guion y guion bajo.
  if coalesce(p_sheet_id, '') !~ '^[A-Za-z0-9_-]{20,100}$' then
    raise exception 'Ese no parece un enlace de Google Sheets' using errcode = 'check_violation';
  end if;
  if coalesce(p_gid, '0') !~ '^[0-9]{1,12}$' then
    raise exception 'La pestaña de la planilla no es válida' using errcode = 'check_violation';
  end if;

  select c.valor into anterior from public.configuracion_sitio c where c.clave = p_clave;
  nuevo := jsonb_build_object('sheet_id', p_sheet_id, 'gid', coalesce(p_gid, '0'));

  insert into public.configuracion_sitio (clave, valor, actualizado_at, actualizado_por)
  values (p_clave, nuevo, now(), auth.uid())
  on conflict (clave) do update
    set valor = excluded.valor, actualizado_at = excluded.actualizado_at,
        actualizado_por = excluded.actualizado_por;

  perform public.anotar_admin('cambiar_planilla', null, p_clave,
    jsonb_build_object('antes', anterior, 'despues', nuevo));
end;
$$;


-- --------------------------------------------------------------------------
-- Registro de acciones (sólo lectura)
-- --------------------------------------------------------------------------
create or replace function public.admin_registro(p_limite int default 100)
returns table (creado_at timestamptz, admin_email text, accion text, objetivo text, detalle jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_admin();
  return query
  select r.creado_at, r.admin_email, r.accion, r.objetivo, r.detalle
  from public.registro_admin r
  order by r.creado_at desc
  limit least(greatest(coalesce(p_limite, 100), 1), 500);
end;
$$;


-- --------------------------------------------------------------------------
-- Permisos: las funciones del panel, sólo para quien tiene sesión (y adentro
-- cada una verifica que sea admin). Postgres las abre a PUBLIC por defecto.
-- --------------------------------------------------------------------------
revoke all on function public.admin_resumen()                              from public, anon;
revoke all on function public.admin_listar_usuarios(text, int, int)        from public, anon;
revoke all on function public.admin_suspender(uuid, text)                  from public, anon;
revoke all on function public.admin_reactivar(uuid)                        from public, anon;
revoke all on function public.admin_confirmar_correo(uuid)                 from public, anon;
revoke all on function public.admin_eliminar_usuario(uuid, text)           from public, anon;
revoke all on function public.admin_listar_admins()                        from public, anon;
revoke all on function public.admin_otorgar(text)                          from public, anon;
revoke all on function public.admin_quitar(uuid)                           from public, anon;
revoke all on function public.admin_guardar_planilla(text, text, text)     from public, anon;
revoke all on function public.admin_registro(int)                          from public, anon;

grant execute on function public.admin_resumen()                           to authenticated;
grant execute on function public.admin_listar_usuarios(text, int, int)     to authenticated;
grant execute on function public.admin_suspender(uuid, text)               to authenticated;
grant execute on function public.admin_reactivar(uuid)                     to authenticated;
grant execute on function public.admin_confirmar_correo(uuid)              to authenticated;
grant execute on function public.admin_eliminar_usuario(uuid, text)        to authenticated;
grant execute on function public.admin_listar_admins()                     to authenticated;
grant execute on function public.admin_otorgar(text)                       to authenticated;
grant execute on function public.admin_quitar(uuid)                        to authenticated;
grant execute on function public.admin_guardar_planilla(text, text, text)  to authenticated;
grant execute on function public.admin_registro(int)                       to authenticated;

notify pgrst, 'reload schema';

commit;


-- ==========================================================================
-- VERIFICACIÓN: todas las tablas con RLS
-- (administradores y registro_admin quedan con RLS y sin políticas: a
-- propósito, sólo se leen a través de las funciones)
-- ==========================================================================
select t.tablename, t.rowsecurity as rls_activo, count(p.policyname) as politicas
from pg_tables t
left join pg_policies p
  on p.schemaname = t.schemaname and p.tablename = t.tablename
where t.schemaname = 'public'
group by t.tablename, t.rowsecurity
order by t.rowsecurity, politicas, t.tablename;
