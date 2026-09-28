-- ==========================================================================
-- OdontoCampus — Migración 006: agenda personal y planilla de preguntas
--
-- Aplicar DESPUÉS de 001 a 005:
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < 006_agenda_y_preguntas.sql
--
-- Y después, siempre, pruebas_rls.sql.
--
-- --------------------------------------------------------------------------
-- QUÉ AGREGA
--
-- 1. `recordatorios`: las entregas y los finales que cada quien anota en su
--    cuenta. Son personales: nadie ve los de nadie. Las mesas oficiales no se
--    guardan acá, salen de la planilla de cátedra y se muestran al lado.
--
-- 2. Una tercera planilla configurable desde el panel: la de preguntas de
--    Odontopreguntados. Mismo mecanismo que mesas y reválidas.
-- ==========================================================================

begin;


-- ==========================================================================
-- 1. AGENDA PERSONAL
-- ==========================================================================
create table public.recordatorios (
  -- Lo genera el navegador, como en complementarias_cursadas: así se puede
  -- anotar algo sin conexión y subirlo después sin duplicarlo.
  id             uuid primary key,
  usuario_id     uuid not null references auth.users(id) on delete cascade,
  titulo         text not null check (char_length(trim(titulo)) between 2 and 120),
  tipo           text not null check (tipo in ('entrega', 'final', 'otro')),
  fecha          date not null check (fecha between date '2000-01-01' and date '2100-01-01'),
  -- Sin hora es "ese día", que es como se anota la mayoría de las entregas.
  hora           time,
  materia        text check (materia is null or char_length(trim(materia)) between 2 and 120),
  nota           text check (nota is null or char_length(nota) <= 300),
  hecho          boolean not null default false,
  creado_at      timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

create index recordatorios_usuario_fecha_idx
  on public.recordatorios (usuario_id, fecha);

create trigger recordatorios_actualizado_at
  before update on public.recordatorios
  for each row execute function public.tocar_actualizado_at();

-- Tope por persona, como en la bolsa y en las materias.
create or replace function public.limitar_recordatorios()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (
    select count(*) from public.recordatorios r
    where r.usuario_id = new.usuario_id and r.id <> new.id
  ) >= 200 then
    raise exception 'Llegaste al máximo de recordatorios guardados'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger recordatorios_limite
  before insert on public.recordatorios
  for each row execute function public.limitar_recordatorios();

alter table public.recordatorios enable row level security;

create policy "recordatorios: sólo el dueño"
  on public.recordatorios for all
  to authenticated
  using  ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

revoke all on public.recordatorios from anon, authenticated;
grant select, delete on public.recordatorios to authenticated;
grant insert (id, usuario_id, titulo, tipo, fecha, hora, materia, nota, hecho)
  on public.recordatorios to authenticated;
grant update (id, usuario_id, titulo, tipo, fecha, hora, materia, nota, hecho)
  on public.recordatorios to authenticated;

revoke all on function public.limitar_recordatorios() from public, anon, authenticated;


-- ==========================================================================
-- 2. LA PLANILLA DE PREGUNTAS
--
-- `configuracion_sitio` aceptaba dos claves. Se amplía la restricción en
-- lugar de tocar 005, que ya está aplicada.
-- ==========================================================================
alter table public.configuracion_sitio
  drop constraint configuracion_sitio_clave_check;

alter table public.configuracion_sitio
  add constraint configuracion_sitio_clave_check
  check (clave in ('planilla_mesas', 'planilla_revalidas', 'planilla_preguntas'));

-- Sin planilla cargada todavía: el juego avisa que no hay preguntas y el
-- panel muestra el campo para pegar el enlace.
insert into public.configuracion_sitio (clave, valor)
values ('planilla_preguntas', '{"sheet_id": "", "gid": "0"}')
on conflict (clave) do nothing;

-- La función que guarda desde el panel también acepta la clave nueva, y deja
-- vaciar una planilla (sheet_id en blanco) para apagar el juego.
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

  if p_clave not in ('planilla_mesas', 'planilla_revalidas', 'planilla_preguntas') then
    raise exception 'Planilla desconocida' using errcode = 'check_violation';
  end if;
  -- Los ids de Google Sheets: letras, números, guion y guion bajo. Vacío sólo
  -- se acepta en la de preguntas: es la forma de apagar el juego.
  if coalesce(p_sheet_id, '') = '' then
    if p_clave <> 'planilla_preguntas' then
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


-- ==========================================================================
-- VERIFICACIÓN
-- ==========================================================================
select t.tablename, t.rowsecurity as rls_activo, count(p.policyname) as politicas
from pg_tables t
left join pg_policies p
  on p.schemaname = t.schemaname and p.tablename = t.tablename
where t.schemaname = 'public'
group by t.tablename, t.rowsecurity
order by t.rowsecurity, politicas, t.tablename;
