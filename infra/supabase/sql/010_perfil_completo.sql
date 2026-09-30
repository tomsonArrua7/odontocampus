-- ==========================================================================
-- OdontoCampus — Migración 010: nombre y apellido en el perfil
--
-- Aplicar DESPUÉS de 001 a 009:
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < 010_perfil_completo.sql
--
-- Y después, siempre, pruebas_rls.sql.
--
-- --------------------------------------------------------------------------
-- QUÉ CAMBIA (decisión de FOE, septiembre de 2026)
--
-- Cada cuenta tiene nombre y apellido reales, además de `nombre_visible`
-- (cómo quiere que la salude la plataforma: puede ser un apodo).
--
-- · Se piden al crear la cuenta. Las cuentas que ya existen los completan
--   la próxima vez que entran: el sitio no deja usar lo que pide cuenta
--   hasta completarlos.
-- · Son privados, como el legajo: no entran en las columnas de perfiles que
--   se pueden leer. Los ve cada quien (mi_perfil) y el panel de
--   administración, que los necesita para saber quién es quién.
-- ==========================================================================

begin;


-- ==========================================================================
-- 1. COLUMNAS
-- ==========================================================================
alter table public.perfiles
  add column if not exists nombre text
    check (nombre is null or char_length(trim(nombre)) between 2 and 60),
  add column if not exists apellido text
    check (apellido is null or char_length(trim(apellido)) between 2 and 60);

-- Se editan los propios (la política de perfiles ya limita a la fila propia).
-- No se agregan al grant de SELECT: el de otra persona no se lee.
grant update (nombre, apellido) on public.perfiles to authenticated;


-- ==========================================================================
-- 2. REGISTRO: el formulario ahora manda nombre y apellido
--
-- Igual que con nombre_visible (ver 003): un valor fuera de rango no hace
-- fallar el alta, se descarta, y el sitio lo vuelve a pedir al entrar.
-- ==========================================================================
create or replace function public.manejar_usuario_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  nombre           text := left(trim(coalesce(new.raw_user_meta_data ->> 'nombre_visible', '')), 60);
  nombre_real      text := left(trim(coalesce(new.raw_user_meta_data ->> 'nombre', '')), 60);
  apellido_real    text := left(trim(coalesce(new.raw_user_meta_data ->> 'apellido', '')), 60);
  version_aceptada text := left(nullif(trim(new.raw_user_meta_data ->> 'version_terminos'), ''), 20);
begin
  if char_length(nombre_real) < 2 then nombre_real := null; end if;
  if char_length(apellido_real) < 2 then apellido_real := null; end if;

  if char_length(nombre) < 2 then
    nombre := coalesce(nombre_real, left(split_part(coalesce(new.email, ''), '@', 1), 60));
  end if;
  if char_length(nombre) < 2 then
    nombre := 'Estudiante';
  end if;

  insert into public.perfiles (id, nombre_visible, nombre, apellido)
  values (new.id, nombre, nombre_real, apellido_real)
  on conflict (id) do nothing;

  if version_aceptada is not null then
    insert into public.consentimientos (usuario_id, tipo, version_texto)
    values (new.id, 'terminos', version_aceptada);
  end if;

  return new;
end;
$$;


-- ==========================================================================
-- 3. PANEL: el listado de cuentas muestra y busca por nombre y apellido
--
-- Misma firma que en 005: la columna `nombre` ahora trae "Nombre Apellido"
-- cuando están cargados, y si no, el nombre visible.
-- ==========================================================================
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
    select u.id, u.email::text,
           coalesce(nullif(trim(concat_ws(' ', p.nombre, p.apellido)), ''), p.nombre_visible) as nombre,
           u.created_at, u.email_confirmed_at,
           u.last_sign_in_at, coalesce(p.estado, 'activo') as estado,
           (a.usuario_id is not null) as es_admin
    from auth.users u
    left join public.perfiles p on p.id = u.id
    left join public.administradores a on a.usuario_id = u.id
    where u.email ilike patron
       or p.nombre_visible ilike patron
       or concat_ws(' ', p.nombre, p.apellido) ilike patron
  )
  select f.id, f.email, f.nombre, f.created_at, f.email_confirmed_at,
         f.last_sign_in_at, f.estado, f.es_admin, count(*) over ()
  from filtradas f
  order by f.created_at desc
  limit least(greatest(coalesce(p_limite, 50), 1), 200)
  offset greatest(coalesce(p_desde, 0), 0);
end;
$$;


-- La cola de la bolsa: para comprobar el legajo sirve el nombre real.
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
         b.usuario_id,
         coalesce(nullif(trim(concat_ws(' ', p.nombre, p.apellido)), ''), p.nombre_visible),
         u.email::text, p.legajo, p.whatsapp
  from public.publicaciones_bolsa b
  join auth.users u on u.id = b.usuario_id
  left join public.perfiles p on p.id = b.usuario_id
  where b.estado = 'pendiente'
  order by b.creado_at;
end;
$$;

notify pgrst, 'reload schema';

commit;
