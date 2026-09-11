-- ==========================================================================
-- OdontoCampus — Esquema inicial
--
-- Aplicar con:
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < 001_esquema.sql
--
-- Y después, SIEMPRE, las pruebas de seguridad (no dejan nada en la base):
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < pruebas_rls.sql
--
-- --------------------------------------------------------------------------
-- LEER ESTO ANTES DE TOCAR NADA
--
-- Con Supabase no hay una API nuestra que valide permisos. El navegador
-- habla directo con PostgREST usando la ANON_KEY, que es pública por diseño
-- y viaja dentro de nuestro JavaScript. Cualquiera puede leerla.
--
-- Lo único que impide que esa clave lea la base entera son las políticas
-- RLS de este archivo.
--
--   · Sin RLS, una tabla en el esquema `public` es legible y escribible
--     por cualquiera que abra el sitio.
--   · Con RLS mal escrito pasa lo mismo, pero cuesta más darse cuenta.
--
-- REGLA: ninguna tabla nueva en `public` sin `enable row level security`
-- y sin al menos una política. Verificación obligatoria al final.
-- ==========================================================================

begin;

create extension if not exists "pgcrypto";


-- ==========================================================================
-- AUXILIARES
-- ==========================================================================

-- Marca de tiempo de modificación.
create or replace function public.tocar_actualizado_at()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_at = now();
  return new;
end;
$$;


-- ==========================================================================
-- PERFILES
-- Fila 1:1 con auth.users. No guardamos nombre real: no lo necesitamos y
-- pedirlo espanta gente. `nombre_visible` puede ser un apodo.
-- ==========================================================================

create table if not exists public.perfiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  nombre_visible       text not null check (char_length(trim(nombre_visible)) between 2 and 60),
  anio_carrera         smallint check (anio_carrera between 1 and 5),
  whatsapp             text check (whatsapp ~ '^[0-9]{8,15}$'),
  estado               text not null default 'activo'
                         check (estado in ('activo', 'suspendido')),
  -- Ver public.puede_publicar()
  puede_publicar_desde timestamptz not null default (now() + interval '24 hours'),
  creado_at            timestamptz not null default now(),
  actualizado_at       timestamptz not null default now()
);

-- Esta función va DESPUÉS de la tabla, a propósito. Está escrita en
-- `language sql`, y Postgres valida el cuerpo de esas funciones en el
-- momento de crearlas: si `perfiles` todavía no existe, falla. (Las
-- funciones en plpgsql no se validan al crearse, por eso las demás pueden
-- ir antes.)
--
-- ¿Esta persona está habilitada para publicar?
--
-- Dos condiciones: cuenta activa y pasadas las primeras 24 horas.
-- La espera de 24 h es la medida antiabuso que más rinde con registro
-- abierto: imperceptible para alguien real, letal para el alta automatizada
-- de cuentas que publican spam y se descartan.
--
-- SECURITY DEFINER porque necesita leer `perfiles` sin quedar atrapada en
-- las políticas RLS de esa misma tabla. `search_path` fijo para que nadie
-- pueda secuestrar la resolución de nombres.
create or replace function public.puede_publicar(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.perfiles p
    where p.id = uid
      and p.estado = 'activo'
      and p.puede_publicar_desde <= now()
  );
$$;

create trigger perfiles_actualizado_at
  before update on public.perfiles
  for each row execute function public.tocar_actualizado_at();

alter table public.perfiles enable row level security;

-- Los perfiles son visibles entre estudiantes: sin esto, una publicación de
-- la bolsa no puede mostrar de quién es. Sólo para quien inició sesión.
create policy "perfiles: lectura autenticada"
  on public.perfiles for select
  to authenticated
  using (true);

create policy "perfiles: cada quien edita el suyo"
  on public.perfiles for update
  to authenticated
  using  ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Ojo: no hay política de INSERT. El perfil lo crea el disparador de abajo,
-- no el cliente. Y no hay política de DELETE: se borra en cascada al
-- eliminar la cuenta.


-- Crear el perfil automáticamente al registrarse.
create or replace function public.manejar_usuario_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.perfiles (id, nombre_visible)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'nombre_visible'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.manejar_usuario_nuevo();


-- ==========================================================================
-- CONSENTIMIENTOS  (Ley 25.326)
-- Registro de qué aceptó cada persona y con qué texto exacto. Si el texto
-- cambia, se pide de nuevo: por eso se guarda la versión.
-- ==========================================================================

create table if not exists public.consentimientos (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references auth.users(id) on delete cascade,
  tipo          text not null check (tipo in ('sincronizar_notas', 'terminos')),
  version_texto text not null,
  otorgado_at   timestamptz not null default now(),
  revocado_at   timestamptz
);

create index if not exists consentimientos_usuario_idx
  on public.consentimientos (usuario_id, tipo);

alter table public.consentimientos enable row level security;

create policy "consentimientos: sólo los propios"
  on public.consentimientos for select
  to authenticated
  using ((select auth.uid()) = usuario_id);

create policy "consentimientos: otorgar el propio"
  on public.consentimientos for insert
  to authenticated
  with check ((select auth.uid()) = usuario_id);

create policy "consentimientos: revocar el propio"
  on public.consentimientos for update
  to authenticated
  using  ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);


-- ==========================================================================
-- NOTAS ACADÉMICAS
--
-- Esta es la tabla políticamente delicada del proyecto.
--
-- FOE es una agrupación. Un estudiante puede razonablemente temer que sus
-- notas queden visibles para la conducción. RLS impide que un estudiante
-- lea las de otro, pero NO alcanza: SERVICE_ROLE_KEY y el acceso directo a
-- Postgres saltean RLS por completo. Quien administre el servidor podría
-- leer cualquier fila.
--
-- Por eso el contenido se cifra EN EL NAVEGADOR antes de enviarse.
-- `payload_cifrado` es texto opaco: base64 de un blob AES-GCM.
--
-- Consecuencia deliberada: no hay columna `nota`, ni `promedio`, ni
-- `materia`. NO SE PUEDE ARMAR UN RANKING DE PROMEDIOS, ni con acceso
-- total a la base, porque no hay contra qué consultar.
--
-- Si alguna vez alguien propone "desnormalizar el promedio para hacer
-- estadísticas", eso rompe la única garantía verificable que le estamos
-- dando a los estudiantes. La respuesta es no.
-- ==========================================================================

create table if not exists public.notas_academicas (
  usuario_id      uuid primary key references auth.users(id) on delete cascade,
  payload_cifrado text not null check (char_length(payload_cifrado) <= 200000),
  -- La sal de derivación (PBKDF2). No es secreta: sirve para que dos personas
  -- con la misma clave no produzcan el mismo material criptográfico. Sin ella
  -- las notas no se pueden descifrar ni siquiera con la clave correcta, así
  -- que viaja junto al paquete.
  sal             text not null check (char_length(sal) between 16 and 64),
  version_formato smallint not null default 1,
  actualizado_at  timestamptz not null default now()
);

create trigger notas_actualizado_at
  before update on public.notas_academicas
  for each row execute function public.tocar_actualizado_at();

alter table public.notas_academicas enable row level security;

-- Una sola política para todo: sólo el dueño, en cualquier operación.
create policy "notas: sólo el dueño"
  on public.notas_academicas for all
  to authenticated
  using  ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);


-- ==========================================================================
-- BOLSA DE COMPRA Y VENTA
-- Sin pagos en la plataforma, a propósito: el sitio dice "coordiná en la
-- facultad". Sin dinero de por medio, la estafa posible es mucho menor.
-- ==========================================================================

create table if not exists public.publicaciones_bolsa (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references auth.users(id) on delete cascade,
  titulo       text not null check (char_length(trim(titulo)) between 3 and 120),
  categoria    text not null check (char_length(trim(categoria)) between 2 and 60),
  precio_texto text not null check (char_length(trim(precio_texto)) between 1 and 40),
  estado_uso   text not null check (char_length(trim(estado_uso)) between 2 and 60),
  ubicacion    text not null check (char_length(trim(ubicacion)) between 2 and 120),
  descripcion  text check (char_length(descripcion) <= 600),
  estado       text not null default 'activa'
                 check (estado in ('activa', 'pausada', 'vendida', 'oculta')),
  creado_at    timestamptz not null default now(),
  expira_at    timestamptz not null default (now() + interval '60 days')
);

create index if not exists bolsa_vigentes_idx
  on public.publicaciones_bolsa (categoria)
  where estado = 'activa';

alter table public.publicaciones_bolsa enable row level security;

create policy "bolsa: ver las vigentes"
  on public.publicaciones_bolsa for select
  to authenticated
  using (
    estado = 'activa' and expira_at > now()
    or (select auth.uid()) = usuario_id
  );

create policy "bolsa: publicar la propia"
  on public.publicaciones_bolsa for insert
  to authenticated
  with check (
    (select auth.uid()) = usuario_id
    and public.puede_publicar((select auth.uid()))
    and (
      select count(*)
      from public.publicaciones_bolsa b
      where b.usuario_id = (select auth.uid())
        and b.estado = 'activa'
        and b.expira_at > now()
    ) < 5
  );

-- Una publicación ocultada por moderación no la puede tocar su dueño: si
-- pudiera, la reactivaría. Y el dueño sólo la mueve entre los estados que le
-- corresponden a él: 'oculta' es una decisión de moderación.
create policy "bolsa: editar la propia"
  on public.publicaciones_bolsa for update
  to authenticated
  using  ((select auth.uid()) = usuario_id and estado <> 'oculta')
  with check ((select auth.uid()) = usuario_id and estado in ('activa', 'pausada', 'vendida'));

-- Tampoco se puede borrar una publicación ocultada: sería borrar la evidencia
-- de lo que se moderó. (Al eliminar la cuenta sí se borra, en cascada.)
create policy "bolsa: borrar la propia"
  on public.publicaciones_bolsa for delete
  to authenticated
  using ((select auth.uid()) = usuario_id and estado <> 'oculta');


-- ==========================================================================
-- REPORTES
-- Con registro abierto, la comunidad es el mejor detector de abuso.
-- Cada quien ve solamente los reportes que hizo: si pudiera ver los ajenos,
-- sabría quién lo denunció.
-- ==========================================================================

create table if not exists public.reportes (
  id            uuid primary key default gen_random_uuid(),
  tipo_objeto   text not null check (tipo_objeto in ('bolsa', 'perfil')),
  objeto_id     uuid not null,
  reportante_id uuid not null references auth.users(id) on delete cascade,
  motivo        text not null check (char_length(trim(motivo)) between 5 and 500),
  estado        text not null default 'pendiente'
                  check (estado in ('pendiente', 'revisado', 'descartado')),
  creado_at     timestamptz not null default now(),
  unique (tipo_objeto, objeto_id, reportante_id)  -- un reporte por persona
);

alter table public.reportes enable row level security;

create policy "reportes: ver los propios"
  on public.reportes for select
  to authenticated
  using ((select auth.uid()) = reportante_id);

create policy "reportes: reportar"
  on public.reportes for insert
  to authenticated
  with check ((select auth.uid()) = reportante_id);

-- Sin UPDATE ni DELETE para el cliente: los resuelve moderación con
-- service_role, desde el panel.


-- ==========================================================================
-- ELIMINAR MI CUENTA  (Ley 25.326, derecho de supresión)
--
-- Desde el navegador no se puede borrar una fila de auth.users, y está bien
-- que así sea. Esta función corre con los permisos de su dueño (SECURITY
-- DEFINER), pero sólo sabe borrar UNA cuenta: la de quien la llama. No
-- recibe parámetros, así que no hay forma de pasarle el id de otra persona.
--
-- El borrado arrastra todo lo demás: perfil, notas cifradas,
-- consentimientos, publicaciones y reportes están declarados con
-- `on delete cascade` hacia auth.users.
--
-- Se llama desde el sitio con:  POST /rest/v1/rpc/eliminar_mi_cuenta
-- ==========================================================================

create or replace function public.eliminar_mi_cuenta()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Se necesita una sesión iniciada' using errcode = '28000';
  end if;

  delete from auth.users where id = uid;
end;
$$;

-- Postgres deja ejecutar cualquier función nueva a PUBLIC por defecto.
-- Sin este revoke, la función quedaría expuesta también a `anon`.
revoke all on function public.eliminar_mi_cuenta() from public, anon;
grant execute on function public.eliminar_mi_cuenta() to authenticated;

-- ==========================================================================
-- PERMISOS
-- Supabase concede permisos amplios a `anon` y `authenticated` por defecto.
-- Acá los recortamos a lo mínimo. RLS filtra las filas; esto limita
-- además qué operaciones son siquiera posibles.
-- ==========================================================================

-- `anon` (quien no inició sesión) no toca ninguna de estas tablas.
-- Todo el contenido público del sitio (mesas, reválidas, historias
-- clínicas, biblioteca) sigue siendo estático: no pasa por acá.
revoke all on all tables in schema public from anon;

-- Supabase también le concede TODO a `authenticated` por defecto, sobre todas
-- las columnas. RLS decide QUÉ FILAS puede tocar cada quien, pero no QUÉ
-- COLUMNAS. Sin recortar esto, un usuario podría, en su propia fila:
--   · reactivarse después de una suspensión   (perfiles.estado)
--   · saltearse la espera de 24 horas          (perfiles.puede_publicar_desde)
--   · extender sin límite una publicación     (publicaciones_bolsa.expira_at)
--   · antedatar un consentimiento             (consentimientos.otorgado_at)
-- Se revoca todo y se concede columna por columna lo que el sitio necesita.
-- Las pruebas de pruebas_rls.sql intentan cada una de estas cosas.
revoke all on all tables in schema public from authenticated;

grant usage on schema public to authenticated;

grant select on public.perfiles to authenticated;
grant update (nombre_visible, anio_carrera, whatsapp)
  on public.perfiles to authenticated;

grant select on public.consentimientos to authenticated;
grant insert (usuario_id, tipo, version_texto)
  on public.consentimientos to authenticated;
grant update (revocado_at)
  on public.consentimientos to authenticated;

-- Las notas son de su dueño por completo: es un texto cifrado que sólo él
-- puede descifrar, y RLS impide tocar las de otra persona.
grant select, insert, update, delete on public.notas_academicas to authenticated;

grant select, delete on public.publicaciones_bolsa to authenticated;
grant insert (usuario_id, titulo, categoria, precio_texto, estado_uso, ubicacion, descripcion)
  on public.publicaciones_bolsa to authenticated;
grant update (titulo, categoria, precio_texto, estado_uso, ubicacion, descripcion, estado)
  on public.publicaciones_bolsa to authenticated;

grant select on public.reportes to authenticated;
grant insert (tipo_objeto, objeto_id, reportante_id, motivo)
  on public.reportes to authenticated;

-- puede_publicar() es SECURITY DEFINER y Postgres deja ejecutar funciones
-- nuevas a PUBLIC. Sin esto, cualquiera sin sesión podría preguntar por
-- /rest/v1/rpc/puede_publicar si un id de usuario está activo o suspendido.
revoke all on function public.puede_publicar(uuid) from public, anon;
grant execute on function public.puede_publicar(uuid) to authenticated;

-- PostgREST guarda en memoria qué tablas y funciones existen. Sin este
-- aviso, lo recién creado responde 404 hasta reiniciar el contenedor.
notify pgrst, 'reload schema';

commit;


-- ==========================================================================
-- VERIFICACIÓN — correr SIEMPRE después de aplicar esto
-- Las dos consultas tienen que dar el resultado esperado antes de
-- considerar el despliegue terminado.
-- ==========================================================================

-- 1) Todas las tablas de `public` deben tener rowsecurity = t
select tablename, rowsecurity as rls_activo
from pg_tables
where schemaname = 'public'
order by rowsecurity, tablename;

-- 2) Ninguna tabla puede quedar con RLS activo pero sin políticas:
--    eso la vuelve inaccesible y suele confundirse con "está protegida".
select t.tablename, count(p.policyname) as politicas
from pg_tables t
left join pg_policies p
  on p.schemaname = t.schemaname and p.tablename = t.tablename
where t.schemaname = 'public'
group by t.tablename
order by politicas, t.tablename;
