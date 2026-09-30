-- ==========================================================================
-- OdontoCampus — Migración 011: exportar las cuentas desde el panel
--
-- Aplicar DESPUÉS de 001 a 010:
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < 011_exportar_cuentas.sql
--
-- Y después, siempre, pruebas_rls.sql.
--
-- --------------------------------------------------------------------------
-- QUÉ CAMBIA (decisión de FOE, septiembre de 2026)
--
-- Panel → Cuentas → «Descargar Excel»: una fila por cuenta con nombre,
-- apellido, correo, WhatsApp y legajo (si los cargó).
--
-- Son datos personales juntos en un archivo que sale de la base. Por eso:
-- · sólo admins (exigir_admin), como todo el panel;
-- · cada descarga queda en el registro, con quién y cuándo;
-- · no incluye materias, notas ni cursos: esos no los ve el panel.
-- ==========================================================================

begin;

create or replace function public.admin_exportar_cuentas()
returns table (
  nombre         text,
  apellido       text,
  nombre_visible text,
  email          text,
  whatsapp       text,
  legajo         text,
  creado_at      timestamptz,
  confirmado_at  timestamptz,
  estado         text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  cantidad int;
begin
  perform public.exigir_admin();

  select count(*) into cantidad from auth.users;
  perform public.anotar_admin('exportar_cuentas', null, null, jsonb_build_object('cuentas', cantidad));

  return query
  select p.nombre, p.apellido, p.nombre_visible, u.email::text, p.whatsapp, p.legajo,
         u.created_at, u.email_confirmed_at, coalesce(p.estado, 'activo')
  from auth.users u
  left join public.perfiles p on p.id = u.id
  order by p.apellido nulls last, p.nombre nulls last, u.email;
end;
$$;

revoke all on function public.admin_exportar_cuentas() from public, anon;
grant execute on function public.admin_exportar_cuentas() to authenticated;

notify pgrst, 'reload schema';

commit;
