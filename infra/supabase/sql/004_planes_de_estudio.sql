-- ==========================================================================
-- OdontoCampus — Migración 004: planes de estudio reales, y el plan de cada cuenta
--
-- Aplicar DESPUÉS de 001, 002 y 003:
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < 004_planes_de_estudio.sql
--
-- Después, los datos del plan (se puede volver a correr cada vez que cambie):
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < datos_planes.sql
--
-- Y después, siempre, pruebas_rls.sql.
--
-- --------------------------------------------------------------------------
-- QUÉ CAMBIA Y POR QUÉ
--
-- 1. El plan de estudios pasa a vivir también en la base. Hasta ahora estaba
--    sólo en public/js/data.js, y era inventado: 29 materias con códigos
--    "OD-101" que no existen. El real (7v16) tiene 60, con los códigos del
--    SIU Guaraní (00011, 0002A...). Con los códigos del SIU, importar el
--    reporte de materias de una persona es buscar por código, no adivinar
--    por nombre.
--
-- 2. Cada cuenta dice qué plan cursa (`planes_usuario`). Hoy hay uno solo,
--    pero la tabla admite hasta tres por persona: un cambio de plan, o una
--    segunda carrera, no piden rehacer nada.
--
-- 3. Cada materia guardada queda atada a su plan con clave foránea. La base
--    ya no acepta un código que no existe en el plan. Eso también reemplaza
--    el tope de 60 filas de 003: ahora el máximo lo pone el propio plan.
--
-- 4. Se agregan columnas para lo que trae el reporte del SIU y hoy no se
--    guardaba: cómo y cuándo se aprobó, y hasta cuándo vale una regularidad.
--
-- 5. Formación complementaria (optativas y electivas): el plan pide 160 horas
--    y el SIU las cuenta en el promedio. Van en su propia tabla, porque no
--    son un casillero fijo del plan sino cursos que cada quien elige.
--
-- Lo que se dijo al registrarse sigue valiendo igual: se guarda lo que la
-- persona carga, sólo para mostrárselo a ella.
-- ==========================================================================

begin;


-- ==========================================================================
-- 1. PLANES (públicos: es información de la facultad)
-- ==========================================================================
create table public.planes_estudio (
  id                    text primary key check (id ~ '^[a-z0-9]{2,12}$'),
  carrera               text not null check (char_length(carrera) between 2 and 80),
  titulo                text not null check (char_length(titulo) between 2 and 80),
  facultad              text not null check (char_length(facultad) between 2 and 120),
  nombre                text not null check (char_length(nombre) between 2 and 120),
  -- Horas de formación complementaria que pide el plan para recibirse.
  horas_complementarias smallint not null default 0 check (horas_complementarias between 0 and 2000),
  -- Un plan que ya no admite inscriptos nuevos sigue existiendo para quien lo cursa.
  admite_nuevos         boolean not null default true,
  fuente                text
);

create table public.plan_materias (
  plan_id   text not null references public.planes_estudio(id) on delete restrict,
  -- El código del SIU Guaraní: cinco caracteres, dígitos y letras (00011, 0002A).
  codigo    text not null check (codigo ~ '^[0-9A-Z]{5}$'),
  nombre    text not null check (char_length(nombre) between 2 and 120),
  anio      smallint not null check (anio between 1 and 6),
  periodo   text not null check (periodo in ('anual', '1c', '2c', 'bimestral')),
  -- Orden en que la facultad la lista dentro del año.
  orden     smallint not null check (orden between 1 and 500),
  -- Requisito que no es otra materia: "Secundario completo", o la PPS, que
  -- pide todo lo anterior.
  condicion text check (condicion is null or char_length(condicion) between 2 and 300),
  primary key (plan_id, codigo),
  unique (plan_id, orden)
);

create table public.plan_correlativas (
  plan_id  text not null,
  materia  text not null,
  requiere text not null,
  primary key (plan_id, materia, requiere),
  foreign key (plan_id, materia)  references public.plan_materias(plan_id, codigo) on delete cascade,
  foreign key (plan_id, requiere) references public.plan_materias(plan_id, codigo) on delete cascade,
  check (materia <> requiere)
);

alter table public.planes_estudio    enable row level security;
alter table public.plan_materias     enable row level security;
alter table public.plan_correlativas enable row level security;

create policy "planes: lectura pública" on public.planes_estudio
  for select to anon, authenticated using (true);
create policy "materias del plan: lectura pública" on public.plan_materias
  for select to anon, authenticated using (true);
create policy "correlativas: lectura pública" on public.plan_correlativas
  for select to anon, authenticated using (true);

-- Leer, sí. Escribir, sólo quien administra la base (datos_planes.sql).
revoke all on public.planes_estudio, public.plan_materias, public.plan_correlativas
  from anon, authenticated;
grant select on public.planes_estudio, public.plan_materias, public.plan_correlativas
  to anon, authenticated;


-- ==========================================================================
-- 2. EL PLAN DE CADA CUENTA
-- ==========================================================================
create table public.planes_usuario (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  plan_id    text not null references public.planes_estudio(id) on delete restrict,
  -- El que se abre por defecto en Mi carrera.
  principal  boolean not null default true,
  creado_at  timestamptz not null default now(),
  primary key (usuario_id, plan_id)
);

-- Un solo plan principal por persona.
create unique index planes_usuario_un_principal
  on public.planes_usuario (usuario_id) where principal;

-- Tope: tres planes por persona. Mismo patrón que los topes de 002 y 003
-- (disparador BEFORE ROW, que ve lo que la misma sentencia ya insertó).
create or replace function public.limitar_planes_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (
    select count(*) from public.planes_usuario p
    where p.usuario_id = new.usuario_id and p.plan_id <> new.plan_id
  ) >= 3 then
    raise exception 'Llegaste al máximo de planes de estudio en tu cuenta'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger planes_usuario_limite
  before insert on public.planes_usuario
  for each row execute function public.limitar_planes_usuario();

alter table public.planes_usuario enable row level security;

create policy "planes de la cuenta: sólo el dueño"
  on public.planes_usuario for all
  to authenticated
  using  ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

revoke all on public.planes_usuario from anon, authenticated;
grant select, delete on public.planes_usuario to authenticated;
grant insert (usuario_id, plan_id, principal) on public.planes_usuario to authenticated;
grant update (usuario_id, plan_id, principal) on public.planes_usuario to authenticated;


-- ==========================================================================
-- 3. MATERIAS CURSADAS, ATADAS AL PLAN
--
-- Las filas que ya hubiera son del plan inventado: sus códigos ("101",
-- "203") no existen en ningún plan real y no hay forma honesta de
-- traducirlos ("Anatomía General e Histología" no es ninguna materia de
-- 7v16). No se borran en silencio: se apartan en una tabla sin ningún
-- permiso, por si alguien las reclama, y se avisa cuántas eran.
-- ==========================================================================
create table public.materias_cursadas_plan_inventado (
  like public.materias_cursadas including defaults,
  apartado_at timestamptz not null default now()
);
alter table public.materias_cursadas_plan_inventado enable row level security;
revoke all on public.materias_cursadas_plan_inventado from anon, authenticated;

do $$
declare n int;
begin
  insert into public.materias_cursadas_plan_inventado
    (usuario_id, materia_id, estado, nota, aplazos, actualizado_at)
  select usuario_id, materia_id, estado, nota, aplazos, actualizado_at
  from public.materias_cursadas;
  get diagnostics n = row_count;

  delete from public.materias_cursadas;

  if n > 0 then
    raise notice 'Se apartaron % fila(s) del plan inventado en materias_cursadas_plan_inventado.', n;
  end if;
end $$;

-- El tope de 60 filas ya no hace falta: la clave foránea sólo acepta códigos
-- del plan, y cada persona tiene como mucho tres planes.
drop trigger materias_limite on public.materias_cursadas;
drop function public.limitar_materias_cursadas();

alter table public.materias_cursadas drop constraint materias_cursadas_pkey;

alter table public.materias_cursadas
  add column plan_id          text not null,
  -- Lo que trae el reporte del SIU. Todo opcional: quien carga a mano puede
  -- no saberlo, y está bien.
  add column forma_aprobacion text check (forma_aprobacion in ('examen', 'promocion', 'equivalencia')),
  add column fecha_aprobacion date check (fecha_aprobacion between date '1950-01-01' and date '2100-01-01'),
  add column regular_vence    date check (regular_vence between date '1950-01-01' and date '2100-01-01'),
  add primary key (usuario_id, plan_id, materia_id),
  add constraint materia_del_plan
    foreign key (plan_id, materia_id) references public.plan_materias(plan_id, codigo)
    on update cascade on delete restrict,
  -- Borrar el plan de la cuenta borra sus materias.
  add constraint plan_de_la_cuenta
    foreign key (usuario_id, plan_id) references public.planes_usuario(usuario_id, plan_id)
    on delete cascade,
  add constraint aprobacion_solo_si_aprobada
    check ((forma_aprobacion is null and fecha_aprobacion is null) or estado = 'aprobada'),
  add constraint vencimiento_solo_si_regular
    check (regular_vence is null or estado = 'regular');

-- Las mismas reglas de columnas que en 003, con las columnas nuevas.
revoke insert, update on public.materias_cursadas from authenticated;
grant insert (usuario_id, plan_id, materia_id, estado, nota, aplazos,
              forma_aprobacion, fecha_aprobacion, regular_vence)
  on public.materias_cursadas to authenticated;
grant update (usuario_id, plan_id, materia_id, estado, nota, aplazos,
              forma_aprobacion, fecha_aprobacion, regular_vence)
  on public.materias_cursadas to authenticated;


-- ==========================================================================
-- 4. FORMACIÓN COMPLEMENTARIA
--
-- El `id` lo genera el navegador: así una carga sin conexión se puede subir
-- después con "insertar o actualizar" sin duplicarse.
-- ==========================================================================
create table public.complementarias_cursadas (
  id             uuid primary key,
  usuario_id     uuid not null,
  plan_id        text not null,
  nombre         text not null check (char_length(nombre) between 2 and 160),
  horas          smallint not null check (horas between 1 and 400),
  nota           numeric(4,2) check (nota between 1 and 10),
  fecha          date check (fecha between date '1950-01-01' and date '2100-01-01'),
  actualizado_at timestamptz not null default now(),
  foreign key (usuario_id, plan_id) references public.planes_usuario(usuario_id, plan_id)
    on delete cascade
);

create trigger complementarias_actualizado_at
  before update on public.complementarias_cursadas
  for each row execute function public.tocar_actualizado_at();

create or replace function public.limitar_complementarias()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (
    select count(*) from public.complementarias_cursadas c
    where c.usuario_id = new.usuario_id and c.id <> new.id
  ) >= 40 then
    raise exception 'Llegaste al máximo de cursos complementarios guardados'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger complementarias_limite
  before insert on public.complementarias_cursadas
  for each row execute function public.limitar_complementarias();

alter table public.complementarias_cursadas enable row level security;

create policy "complementarias: sólo el dueño"
  on public.complementarias_cursadas for all
  to authenticated
  using  ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

revoke all on public.complementarias_cursadas from anon, authenticated;
grant select, delete on public.complementarias_cursadas to authenticated;
grant insert (id, usuario_id, plan_id, nombre, horas, nota, fecha)
  on public.complementarias_cursadas to authenticated;
grant update (id, usuario_id, plan_id, nombre, horas, nota, fecha)
  on public.complementarias_cursadas to authenticated;


-- Las funciones de tope no se llaman desde la API.
revoke all on function public.limitar_planes_usuario() from public, anon, authenticated;
revoke all on function public.limitar_complementarias() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;


-- ==========================================================================
-- VERIFICACIÓN: todas las tablas con RLS y con al menos una política
-- (materias_cursadas_plan_inventado queda con RLS y sin políticas: a
-- propósito, nadie la lee desde la API)
-- ==========================================================================
select t.tablename, t.rowsecurity as rls_activo, count(p.policyname) as politicas
from pg_tables t
left join pg_policies p
  on p.schemaname = t.schemaname and p.tablename = t.tablename
where t.schemaname = 'public'
group by t.tablename, t.rowsecurity
order by t.rowsecurity, politicas, t.tablename;
