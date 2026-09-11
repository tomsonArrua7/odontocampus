-- ==========================================================================
-- OdontoCampus — Migración 002: límite de la bolsa y privacidad de perfiles
--
-- Aplicar DESPUÉS de 001_esquema.sql:
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < 002_bolsa_y_privacidad.sql
--
-- Y después, siempre, pruebas_rls.sql.
--
-- --------------------------------------------------------------------------
-- 001 ya está aplicado en producción y no se edita: una migración aplicada
-- es historia, y cambiarla hace que el archivo y la base dejen de coincidir.
-- Los cambios van en archivos nuevos, numerados, que se aplican en orden.
-- ==========================================================================

begin;


-- ==========================================================================
-- 1. PUBLICAR EN LA BOLSA
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1a. El límite de 5 publicaciones activas
--
-- En 001 la política de INSERT contaba las publicaciones con una subconsulta
-- sobre la MISMA tabla. Postgres no lo permite: para evaluarla aplica las
-- políticas de la tabla, que vuelven a contener la subconsulta, y corta con
-- "infinite recursion detected in policy". Lo encontró pruebas_rls.sql.
--
-- Pasarlo a una función llamada desde la política tampoco alcanza: con una
-- inserción múltiple (la API acepta un arreglo de filas en un solo pedido)
-- el conteo se resuelve una vez, antes de insertar, y se pueden meter diez
-- publicaciones de golpe.
--
-- Por eso el límite lo controla un disparador BEFORE ROW. Postgres garantiza
-- que las consultas dentro de un disparador de fila ven las filas que la
-- misma sentencia ya insertó: la sexta fila de un lote ve las cinco
-- anteriores y se rechaza.
-- --------------------------------------------------------------------------
create or replace function public.limitar_publicaciones_activas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.estado = 'activa'
     and (tg_op = 'INSERT' or old.estado is distinct from 'activa')
     and (
       select count(*)
       from public.publicaciones_bolsa b
       where b.usuario_id = new.usuario_id
         and b.estado = 'activa'
         and b.expira_at > now()
         and b.id <> new.id
     ) >= 5
  then
    raise exception 'Llegaste al máximo de 5 publicaciones activas'
      using errcode = 'insufficient_privilege',
            hint = 'Pausá o marcá como vendida alguna para publicar otra.';
  end if;
  return new;
end;
$$;

drop trigger if exists bolsa_limite_activas on public.publicaciones_bolsa;
create trigger bolsa_limite_activas
  before insert or update of estado on public.publicaciones_bolsa
  for each row execute function public.limitar_publicaciones_activas();


-- --------------------------------------------------------------------------
-- 1b. ¿Puedo publicar?
--
-- Reemplaza a puede_publicar(uid), que recibía un id: cualquier persona con
-- sesión podía preguntar por el id de OTRA y enterarse de si estaba
-- suspendida. Esta no recibe nada y sólo responde por quien pregunta.
-- En plpgsql, para que Postgres no la valide ni la inline al crear la
-- política.
-- --------------------------------------------------------------------------
create or replace function public.puedo_publicar()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return exists (
    select 1
    from public.perfiles p
    where p.id = auth.uid()
      and p.estado = 'activo'
      and p.puede_publicar_desde <= now()
  );
end;
$$;

revoke all on function public.puedo_publicar() from public, anon;
grant execute on function public.puedo_publicar() to authenticated;


-- --------------------------------------------------------------------------
-- 1c. La política, sin la subconsulta recursiva
-- --------------------------------------------------------------------------
drop policy if exists "bolsa: publicar la propia" on public.publicaciones_bolsa;

create policy "bolsa: publicar la propia"
  on public.publicaciones_bolsa for insert
  to authenticated
  with check (
    (select auth.uid()) = usuario_id
    and (select public.puedo_publicar())
  );

drop function if exists public.puede_publicar(uuid);


-- ==========================================================================
-- 2. PRIVACIDAD DE LOS PERFILES
--
-- En 001 cualquier persona con sesión podía leer TODAS las columnas de TODOS
-- los perfiles, incluido el WhatsApp. Con registro abierto, eso es entregarle
-- la lista de teléfonos de la facultad a quien cree una cuenta.
--
-- Ahora, de los perfiles ajenos sólo se ve lo necesario para mostrar quién
-- publica algo. El perfil propio completo se pide con mi_perfil().
-- ==========================================================================
revoke select on public.perfiles from authenticated;
grant select (id, nombre_visible, anio_carrera, creado_at)
  on public.perfiles to authenticated;

create or replace function public.mi_perfil()
returns setof public.perfiles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return query
    select * from public.perfiles where id = auth.uid();
end;
$$;

revoke all on function public.mi_perfil() from public, anon;
grant execute on function public.mi_perfil() to authenticated;


-- PostgREST guarda en memoria qué tablas y funciones existen: sin este aviso,
-- mi_perfil y puedo_publicar responderían 404 hasta reiniciar el contenedor.
notify pgrst, 'reload schema';

commit;
