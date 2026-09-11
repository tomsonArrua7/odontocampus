-- ==========================================================================
-- OdontoCampus — Migración 003: cuentas con contraseña y materias en la cuenta
--
-- Aplicar DESPUÉS de 001 y 002:
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < 003_cuentas_con_contrasena.sql
--
-- Y después, siempre, pruebas_rls.sql.
--
-- --------------------------------------------------------------------------
-- QUÉ CAMBIA Y POR QUÉ (decisión del equipo, septiembre de 2026)
--
-- 1. Se entra con correo y contraseña. El correo sirve para confirmar la
--    cuenta una sola vez y para recuperar la contraseña.
--
-- 2. Mi promedio pide cuenta. Las materias se guardan en la cuenta, en
--    columnas legibles, y dejan de cifrarse en el navegador con una segunda
--    clave. Esa segunda clave era un paso más, y quien la olvidaba perdía sus
--    notas para siempre: recuperar la contraseña no las recuperaba.
--
-- LO QUE ESTO SIGNIFICA, DICHO DE FRENTE:
--   · RLS sigue impidiendo que un estudiante vea las materias de otro.
--   · Quien administra el servidor SÍ puede leerlas. Se le dice así a cada
--     persona al crear la cuenta.
--   · Usar estos datos para cualquier otra cosa que mostrarle a cada quien lo
--     suyo (estadísticas, rankings, listados) requiere un consentimiento
--     nuevo, explícito y aparte. No entra en el que se pide al registrarse.
-- ==========================================================================

begin;


-- ==========================================================================
-- 1. FUERA LA TABLA CIFRADA
--
-- Sólo se borra si está vacía. Si alguien llegó a sincronizar notas cifradas,
-- el servidor no puede descifrarlas (ese era el punto), así que borrarlas en
-- silencio sería perder datos de una persona. En ese caso la migración se
-- detiene y no cambia nada.
-- ==========================================================================
do $$
begin
  if exists (select 1 from public.notas_academicas) then
    raise exception 'notas_academicas tiene % fila(s) cifradas. No se borra nada: avisale a esas personas antes de seguir.',
      (select count(*) from public.notas_academicas);
  end if;
end $$;

drop table public.notas_academicas;


-- ==========================================================================
-- 2. MATERIAS DE CADA ESTUDIANTE
--
-- Una fila por materia. Así cada cambio viaja solo (no se reescribe todo el
-- promedio por tocar una nota) y dos dispositivos que editan materias
-- distintas no se pisan.
--
-- `materia_id` es el id del plan de estudios de public/js/data.js. No hay
-- clave foránea porque el plan vive en el sitio, no en la base.
--
-- Las materias en estado "pendiente" no se guardan: pendiente es no tener
-- fila.
-- ==========================================================================
create table public.materias_cursadas (
  usuario_id     uuid not null references auth.users(id) on delete cascade,
  materia_id     text not null check (materia_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  estado         text not null check (estado in ('cursando', 'regular', 'aprobada')),
  nota           numeric(4,2) check (nota between 4 and 10),
  aplazos        smallint not null default 0 check (aplazos between 0 and 30),
  actualizado_at timestamptz not null default now(),
  primary key (usuario_id, materia_id),
  -- La calculadora nunca inventa una nota: sólo una materia aprobada la tiene.
  constraint nota_solo_si_aprobada check (nota is null or estado = 'aprobada')
);

create trigger materias_actualizado_at
  before update on public.materias_cursadas
  for each row execute function public.tocar_actualizado_at();


-- --------------------------------------------------------------------------
-- Tope de filas por persona
--
-- El plan tiene 29 materias. Sin tope, cualquiera con cuenta podría llenar la
-- base con millones de filas "propias" de ids inventados. 60 deja margen para
-- un cambio de plan.
--
-- Mismo patrón que el límite de la bolsa (002): disparador BEFORE ROW, que ve
-- las filas que la misma sentencia ya insertó, así que una inserción múltiple
-- tampoco lo saltea.
--
-- `materia_id <> new.materia_id`: la API guarda con "insertar o actualizar"
-- (INSERT ... ON CONFLICT). Postgres dispara este disparador ANTES de saber
-- si la fila ya existe. Sin esa condición, quien tuviera 60 materias no
-- podría corregir la nota de ninguna.
-- --------------------------------------------------------------------------
create or replace function public.limitar_materias_cursadas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (
    select count(*)
    from public.materias_cursadas m
    where m.usuario_id = new.usuario_id
      and m.materia_id <> new.materia_id
  ) >= 60 then
    raise exception 'Llegaste al máximo de materias guardadas'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger materias_limite
  before insert on public.materias_cursadas
  for each row execute function public.limitar_materias_cursadas();


-- --------------------------------------------------------------------------
-- Seguridad: sólo el dueño, en cualquier operación
-- --------------------------------------------------------------------------
alter table public.materias_cursadas enable row level security;

create policy "materias: sólo el dueño"
  on public.materias_cursadas for all
  to authenticated
  using  ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

-- Supabase les concede todo a anon y authenticated sobre cada tabla nueva.
-- Se revoca y se concede columna por columna, como en 001.
--
-- `usuario_id` y `materia_id` figuran en UPDATE porque el "insertar o
-- actualizar" de la API los vuelve a escribir con su mismo valor. No abre
-- nada: la política exige que la fila siga siendo de quien la escribe.
--
-- `actualizado_at` no se concede: lo pone la base, no el navegador.
revoke all on public.materias_cursadas from anon, authenticated;

grant select, delete on public.materias_cursadas to authenticated;
grant insert (usuario_id, materia_id, estado, nota, aplazos)
  on public.materias_cursadas to authenticated;
grant update (usuario_id, materia_id, estado, nota, aplazos)
  on public.materias_cursadas to authenticated;


-- ==========================================================================
-- 3. REGISTRO: PERFIL Y CONSENTIMIENTO EN EL MISMO PASO
--
-- El formulario de registro manda, junto con el correo y la contraseña:
--   nombre_visible     cómo quiere que lo llamen
--   version_terminos   la versión del texto que aceptó al tildar la casilla
--
-- El consentimiento se registra acá, dentro de la misma transacción que crea
-- la cuenta, porque en ese momento todavía no hay sesión: el navegador no
-- podría insertarlo. Y así no existe una cuenta nueva sin su registro.
--
-- También corrige un defecto de 001: `nombre_visible` exige entre 2 y 60
-- caracteres, y la versión anterior copiaba el valor tal cual. Un nombre de
-- una letra, uno de 70, o un correo como a@gmail.com hacían fallar el alta
-- entera con un "Database error saving new user" imposible de entender.
-- ==========================================================================
create or replace function public.manejar_usuario_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  nombre           text := left(trim(coalesce(new.raw_user_meta_data ->> 'nombre_visible', '')), 60);
  version_aceptada text := left(nullif(trim(new.raw_user_meta_data ->> 'version_terminos'), ''), 20);
begin
  if char_length(nombre) < 2 then
    nombre := left(split_part(coalesce(new.email, ''), '@', 1), 60);
  end if;
  if char_length(nombre) < 2 then
    nombre := 'Estudiante';
  end if;

  insert into public.perfiles (id, nombre_visible)
  values (new.id, nombre)
  on conflict (id) do nothing;

  if version_aceptada is not null then
    insert into public.consentimientos (usuario_id, tipo, version_texto)
    values (new.id, 'terminos', version_aceptada);
  end if;

  return new;
end;
$$;


-- PostgREST guarda en memoria qué tablas existen: sin este aviso,
-- materias_cursadas respondería 404 hasta reiniciar el contenedor.
notify pgrst, 'reload schema';

commit;


-- ==========================================================================
-- VERIFICACIÓN: todas las tablas con RLS y con al menos una política
-- ==========================================================================
select t.tablename, t.rowsecurity as rls_activo, count(p.policyname) as politicas
from pg_tables t
left join pg_policies p
  on p.schemaname = t.schemaname and p.tablename = t.tablename
where t.schemaname = 'public'
group by t.tablename, t.rowsecurity
order by t.rowsecurity, politicas, t.tablename;
