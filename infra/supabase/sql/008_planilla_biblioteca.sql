-- ==========================================================================
-- OdontoCampus — Migración 008: la planilla de la Biblioteca
--
-- Aplicar DESPUÉS de 001 a 007:
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < 008_planilla_biblioteca.sql
--
-- Y después, siempre, pruebas_rls.sql.
--
-- La Biblioteca del sitio lee un índice que mantienen los militantes en una
-- planilla de Google (una fila por material: Materia, Tipo, Título, Enlace,
-- Autor o cátedra, Revisado). Como las mesas, qué planilla se lee se cambia
-- desde el panel de administración. Vacía, el sitio usa la copia generada
-- desde el Drive (public/js/biblioteca-datos.js).
-- ==========================================================================

begin;

alter table public.configuracion_sitio
  drop constraint configuracion_sitio_clave_check;

alter table public.configuracion_sitio
  add constraint configuracion_sitio_clave_check
  check (clave in ('planilla_mesas', 'planilla_revalidas', 'planilla_preguntas', 'planilla_biblioteca'));

insert into public.configuracion_sitio (clave, valor)
values ('planilla_biblioteca', '{"sheet_id": "", "gid": "0"}')
on conflict (clave) do nothing;

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

  if p_clave not in ('planilla_mesas', 'planilla_revalidas', 'planilla_preguntas', 'planilla_biblioteca') then
    raise exception 'Planilla desconocida' using errcode = 'check_violation';
  end if;
  -- Vacío sólo vale para las que tienen respaldo o se pueden apagar: la de
  -- preguntas y la de la biblioteca. Mesas y reválidas no pueden quedar sin
  -- planilla.
  if coalesce(p_sheet_id, '') = '' then
    if p_clave not in ('planilla_preguntas', 'planilla_biblioteca') then
      raise exception 'Ese no parece un enlace de Google Sheets' using errcode = 'check_violation';
    end if;
  elsif p_sheet_id !~ '^[A-Za-z0-9_-]{20,100}$' then
    raise exception 'Ese no parece un enlace de Google Sheets' using errcode = 'check_violation';
  end if;
  if coalesce(p_gid, '0') !~ '^[0-9]{1,12}$' then
    raise exception 'La pestaña de la planilla no es válida' using errcode = 'check_violation';
  end if;

  select c.valor into anterior from public.configuracion_sitio c where c.clave = p_clave;
  nuevo := jsonb_build_object('sheet_id', coalesce(p_sheet_id, ''), 'gid', coalesce(p_gid, '0'));

  insert into public.configuracion_sitio (clave, valor, actualizado_at, actualizado_por)
  values (p_clave, nuevo, now(), auth.uid())
  on conflict (clave) do update
    set valor = excluded.valor, actualizado_at = excluded.actualizado_at,
        actualizado_por = excluded.actualizado_por;

  perform public.anotar_admin('cambiar_planilla', null, p_clave,
    jsonb_build_object('antes', anterior, 'despues', nuevo));
end;
$$;

revoke all on function public.admin_guardar_planilla(text, text, text) from public, anon;
grant execute on function public.admin_guardar_planilla(text, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
