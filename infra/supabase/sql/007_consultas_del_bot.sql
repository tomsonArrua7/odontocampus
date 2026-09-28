-- ==========================================================================
-- OdontoCampus — Migración 007: lo que el OdontoBot no supo responder
--
-- Aplicar DESPUÉS de 001 a 006:
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < 007_consultas_del_bot.sql
--
-- Y después, siempre, pruebas_rls.sql.
--
-- --------------------------------------------------------------------------
-- PARA QUÉ
--
-- El bot responde con una lista de temas escrita a mano. Hoy no hay forma de
-- saber qué le preguntan y no puede contestar: quien escribe las respuestas
-- adivina. Esta tabla guarda esas consultas y las agrupa, para que el panel
-- muestre "esto lo preguntaron 14 veces y no sabemos contestarlo".
--
-- QUÉ SE GUARDA, Y QUÉ NO
--
-- · Se guarda el texto de la consulta, normalizado, y cuántas veces se hizo.
-- · NO se guarda quién preguntó: ni la cuenta, ni nada que permita volver a
--   esa persona. La función es la misma para quien tiene sesión y para quien
--   no, y ninguna de las dos escribe un identificador.
-- · Antes de guardar se borran correos y números largos (teléfonos, DNI): si
--   alguien escribe "mi mail es tal", eso no queda en la base.
-- · El chat lo avisa en pantalla.
-- ==========================================================================

begin;


create table public.consultas_bot (
  texto      text primary key check (char_length(texto) between 3 and 200),
  veces      integer not null default 1 check (veces > 0),
  primera_at timestamptz not null default now(),
  ultima_at  timestamptz not null default now(),
  -- La marca alguien de administración cuando ya cargó la respuesta.
  resuelta   boolean not null default false
);

create index consultas_bot_pendientes_idx
  on public.consultas_bot (veces desc) where not resuelta;

alter table public.consultas_bot enable row level security;
-- Sin políticas ni permisos: se escribe y se lee sólo por las funciones.
revoke all on public.consultas_bot from anon, authenticated;


-- --------------------------------------------------------------------------
-- Anotar una consulta sin respuesta.
--
-- La llama el chat, tenga o no sesión, así que es lo único de la base que
-- puede escribir alguien sin cuenta. Por eso hace poco y con límites:
-- normaliza, tapa datos personales y no deja crecer la tabla sin freno.
-- --------------------------------------------------------------------------
create or replace function public.anotar_consulta_bot(p_texto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  limpio text;
begin
  limpio := lower(trim(coalesce(p_texto, '')));
  -- Correos y números largos (teléfono, DNI, legajo) no se guardan.
  limpio := regexp_replace(limpio, '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '(correo)', 'g');
  limpio := regexp_replace(limpio, '[[:digit:]]{6,}', '(número)', 'g');
  limpio := regexp_replace(limpio, '[[:space:]]+', ' ', 'g');
  limpio := left(limpio, 200);

  if char_length(limpio) < 3 then
    return;
  end if;

  -- Tope de la tabla: una consulta nueva se guarda sólo si hay lugar. Las que
  -- ya existen siguen sumando, que es lo que importa para priorizar.
  if not exists (select 1 from public.consultas_bot c where c.texto = limpio)
     and (select count(*) from public.consultas_bot) >= 2000 then
    return;
  end if;

  insert into public.consultas_bot (texto)
  values (limpio)
  on conflict (texto) do update
    set veces = public.consultas_bot.veces + 1,
        ultima_at = now();
end;
$$;

revoke all on function public.anotar_consulta_bot(text) from public;
grant execute on function public.anotar_consulta_bot(text) to anon, authenticated;


-- --------------------------------------------------------------------------
-- Para el panel
-- --------------------------------------------------------------------------
create or replace function public.admin_consultas_bot(
  p_limite    int     default 100,
  p_resueltas boolean default false
)
returns table (texto text, veces integer, primera_at timestamptz, ultima_at timestamptz, resuelta boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_admin();
  return query
  select c.texto, c.veces, c.primera_at, c.ultima_at, c.resuelta
  from public.consultas_bot c
  where p_resueltas or not c.resuelta
  order by c.resuelta, c.veces desc, c.ultima_at desc
  limit least(greatest(coalesce(p_limite, 100), 1), 500);
end;
$$;


create or replace function public.admin_marcar_consulta(p_texto text, p_resuelta boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_admin();
  update public.consultas_bot set resuelta = coalesce(p_resuelta, true)
  where texto = p_texto;
  if found then
    perform public.anotar_admin('consulta_bot', null, left(p_texto, 80),
      jsonb_build_object('resuelta', coalesce(p_resuelta, true)));
  end if;
end;
$$;


create or replace function public.admin_borrar_consulta(p_texto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_admin();
  delete from public.consultas_bot where texto = p_texto;
  if found then
    perform public.anotar_admin('consulta_bot_borrada', null, left(p_texto, 80), null);
  end if;
end;
$$;


revoke all on function public.admin_consultas_bot(int, boolean)  from public, anon;
revoke all on function public.admin_marcar_consulta(text, boolean) from public, anon;
revoke all on function public.admin_borrar_consulta(text)          from public, anon;

grant execute on function public.admin_consultas_bot(int, boolean)   to authenticated;
grant execute on function public.admin_marcar_consulta(text, boolean) to authenticated;
grant execute on function public.admin_borrar_consulta(text)          to authenticated;

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
