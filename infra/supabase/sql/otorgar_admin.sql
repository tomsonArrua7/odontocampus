-- ==========================================================================
-- OdontoCampus — Dar el rol de administrador desde el servidor
--
-- Para la PRIMERA persona administradora (o para recuperar el acceso si nadie
-- más lo tiene). Las siguientes se suman desde el panel del sitio.
--
--   cd /opt/supabase
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -v email="nombre@ejemplo.com" \
--     < /home/odontocampus/htdocs/odontocampus.com.ar/infra/supabase/sql/otorgar_admin.sql
--
-- La cuenta tiene que existir y tener el correo confirmado. Queda anotado en
-- el registro del panel como otorgado "desde el servidor".
-- ==========================================================================

\set ON_ERROR_STOP on

begin;

select set_config('odontocampus.email_admin', :'email', true);

do $$
declare
  correo  text := lower(trim(current_setting('odontocampus.email_admin')));
  destino uuid;
begin
  select u.id into destino from auth.users u
  where lower(u.email) = correo and u.email_confirmed_at is not null;

  if destino is null then
    raise exception 'No hay una cuenta confirmada con el correo %', correo;
  end if;

  insert into public.administradores (usuario_id) values (destino)
  on conflict (usuario_id) do nothing;

  insert into public.registro_admin (admin_email, accion, objetivo_id, objetivo, detalle)
  values ('(servidor)', 'otorgar_admin', destino, correo, null);

  raise notice 'Listo: % es administradora/or.', correo;
end $$;

commit;

select u.email, a.otorgado_at
from public.administradores a join auth.users u on u.id = a.usuario_id
order by a.otorgado_at;
