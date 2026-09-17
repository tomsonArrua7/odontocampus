-- ==========================================================================
-- OdontoCampus — Pruebas de seguridad del esquema (RLS y permisos)
--
-- Correr DESPUÉS de aplicar todas las migraciones (001, 002, 003, 004, ...), y otra
-- vez después de cualquier cambio:
--
--   cd /opt/supabase
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < /home/odontocampus/htdocs/odontocampus.com.ar/infra/supabase/sql/pruebas_rls.sql
--
-- --------------------------------------------------------------------------
-- Todo corre dentro de UNA transacción que termina en ROLLBACK: crea usuarios
-- de prueba, intenta lo que intentaría alguien con malas intenciones y deshace
-- todo. No queda nada en la base, ni siquiera si el script se corta a mitad
-- de camino.
--
-- Cada prueba imprime OK o FALLA.
-- UNA SOLA FALLA ES UN AGUJERO DE SEGURIDAD: no se publica ningún cambio del
-- sitio que dependa de la base hasta que todas digan OK.
--
-- Cómo simula a los usuarios: `set local role` cambia al rol que usa la API
-- (anon o authenticated) y `request.jwt.claims` es exactamente lo que
-- PostgREST carga a partir del token de sesión. auth.uid() lo lee de ahí.
-- ==========================================================================

\set QUIET on
\set VERBOSITY terse

begin;

-- --------------------------------------------------------------------------
-- Preparación (como postgres)
-- --------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'prueba-a@odontocampus.invalid', '{"nombre_visible":"Prueba A"}'),
  ('00000000-0000-4000-8000-00000000000b', 'prueba-b@odontocampus.invalid', '{"nombre_visible":"Prueba B"}');

update public.perfiles set whatsapp = '2215559999'
where id = '00000000-0000-4000-8000-00000000000b';

-- Planes propios de las pruebas: así no dependen de que datos_planes.sql se
-- haya corrido, y el tope de tres planes se puede probar con cuatro.
insert into public.planes_estudio (id, carrera, titulo, facultad, nombre) values
  ('prueba1', 'Prueba', 'Prueba', 'Prueba', 'Plan de prueba 1'),
  ('prueba2', 'Prueba', 'Prueba', 'Prueba', 'Plan de prueba 2'),
  ('prueba3', 'Prueba', 'Prueba', 'Prueba', 'Plan de prueba 3'),
  ('prueba4', 'Prueba', 'Prueba', 'Prueba', 'Plan de prueba 4');
insert into public.plan_materias (plan_id, codigo, nombre, anio, periodo, orden) values
  ('prueba1', 'P0001', 'Materia 1', 1, '1c', 1),
  ('prueba1', 'P0002', 'Materia 2', 1, '2c', 2),
  ('prueba1', 'P0003', 'Materia 3', 1, 'anual', 3),
  ('prueba2', 'P0001', 'Materia 1', 1, '1c', 1),
  ('prueba3', 'P0001', 'Materia 1', 1, '1c', 1);

insert into public.planes_usuario (usuario_id, plan_id)
values ('00000000-0000-4000-8000-00000000000b', 'prueba1');
insert into public.materias_cursadas (usuario_id, plan_id, materia_id, estado, nota, aplazos)
values ('00000000-0000-4000-8000-00000000000b', 'prueba1', 'P0001', 'aprobada', 8, 0);
insert into public.complementarias_cursadas (id, usuario_id, plan_id, nombre, horas)
values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000b', 'prueba1', 'Curso de B', 30);

do $$ begin
  if (select count(*) from public.perfiles
      where id in ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b')) = 2 then
    raise notice 'OK     00. Al registrarse se crea el perfil automáticamente';
  else
    raise notice 'FALLA  00. El registro no creó los perfiles';
  end if;
end $$;

-- Registro con un correo de una letra y un nombre de una letra: con la versión
-- de 001, esto hacía fallar el alta entera.
do $$ begin
  insert into auth.users (id, email, raw_user_meta_data) values
    ('00000000-0000-4000-8000-00000000000c', 'x@odontocampus.invalid',
     '{"nombre_visible":"y","version_terminos":"prueba-v"}');
  if exists (select 1 from public.perfiles
             where id = '00000000-0000-4000-8000-00000000000c'
               and char_length(nombre_visible) >= 2) then
    raise notice 'OK     01. Un correo o un nombre muy corto no rompen el registro';
  else
    raise notice 'FALLA  01. El registro no creó el perfil';
  end if;
exception when others then
  raise notice 'FALLA  01. Un nombre corto rompe el registro: %', sqlerrm;
end $$;

do $$ begin
  if exists (select 1 from public.consentimientos
             where usuario_id = '00000000-0000-4000-8000-00000000000c'
               and tipo = 'terminos' and version_texto = 'prueba-v') then
    raise notice 'OK     02. Al registrarse queda anotado qué versión de los términos aceptó';
  else
    raise notice 'FALLA  02. El registro no dejó el consentimiento';
  end if;
end $$;


-- ==========================================================================
-- SIN SESIÓN (anon): lo que puede hacer cualquiera con la clave pública
-- ==========================================================================
set local role anon;
do $$ begin perform set_config('request.jwt.claims', '{"role":"anon"}', true); end $$;

do $$ begin
  perform count(*) from public.perfiles;
  raise notice 'FALLA  03. Sin sesión se pueden leer los perfiles';
exception when insufficient_privilege then
  raise notice 'OK     03. Sin sesión no se leen los perfiles';
end $$;

do $$ begin
  perform count(*) from public.materias_cursadas;
  raise notice 'FALLA  04. Sin sesión se pueden leer las materias';
exception when insufficient_privilege then
  raise notice 'OK     04. Sin sesión no se leen las materias';
end $$;

do $$ declare n int; begin
  select count(*) into n from public.plan_materias where plan_id = 'prueba1';
  if n = 3 then raise notice 'OK     04b. Sin sesión se lee el plan de estudios (es público)';
  else raise notice 'FALLA  04b. Sin sesión no se lee el plan de estudios (% filas)', n; end if;
exception when others then
  raise notice 'FALLA  04b. Sin sesión no se lee el plan de estudios: %', sqlerrm;
end $$;

do $$ begin
  insert into public.plan_materias (plan_id, codigo, nombre, anio, periodo, orden)
  values ('prueba1', 'P0009', 'Inventada', 1, '1c', 9);
  raise notice 'FALLA  04c. Sin sesión se pueden agregar materias al plan';
exception when insufficient_privilege then
  raise notice 'OK     04c. Sin sesión no se modifica el plan de estudios';
end $$;

do $$ begin
  perform public.eliminar_mi_cuenta();
  raise notice 'FALLA  05. Sin sesión se puede llamar a eliminar_mi_cuenta';
exception
  when insufficient_privilege then
    raise notice 'OK     05. Sin sesión no se puede llamar a eliminar_mi_cuenta';
  when others then
    raise notice 'FALLA  05. eliminar_mi_cuenta es ejecutable sin sesión (%)', sqlerrm;
end $$;

do $$ begin
  perform public.puedo_publicar();
  raise notice 'FALLA  06. Sin sesión se puede llamar a puedo_publicar';
exception when insufficient_privilege then
  raise notice 'OK     06. Sin sesión no se puede llamar a puedo_publicar';
end $$;

reset role;


-- ==========================================================================
-- CON SESIÓN, como la persona A
-- ==========================================================================
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
end $$;

-- ---------------------------------------------------------------- perfil
do $$ declare n int; begin
  update public.perfiles set nombre_visible = 'Prueba A editada'
  where id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n = 1 then raise notice 'OK     07. Cada quien edita su propio nombre';
  else raise notice 'FALLA  07. No se pudo editar el propio nombre (% filas)', n; end if;
exception when others then
  raise notice 'FALLA  07. No se pudo editar el propio nombre: %', sqlerrm;
end $$;

do $$ begin
  update public.perfiles set estado = 'activo'
  where id = '00000000-0000-4000-8000-00000000000a';
  raise notice 'FALLA  08. Un usuario puede cambiar su estado (se reactivaría tras una suspensión)';
exception when insufficient_privilege then
  raise notice 'OK     08. Un usuario no puede cambiar su propio estado';
end $$;

do $$ begin
  update public.perfiles set puede_publicar_desde = now() - interval '1 day'
  where id = '00000000-0000-4000-8000-00000000000a';
  raise notice 'FALLA  09. Un usuario puede saltearse la espera de 24 h';
exception when insufficient_privilege then
  raise notice 'OK     09. Un usuario no puede saltearse la espera de 24 h';
end $$;

do $$ declare n int; begin
  update public.perfiles set whatsapp = '2215550000'
  where id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n = 1 then raise notice 'OK     10. Cada quien carga su propio WhatsApp';
  else raise notice 'FALLA  10. No se pudo cargar el propio WhatsApp (% filas)', n; end if;
exception when others then
  raise notice 'FALLA  10. No se pudo cargar el propio WhatsApp: %', sqlerrm;
end $$;

do $$ declare n int; begin
  select count(*) into n from public.perfiles
  where id = '00000000-0000-4000-8000-00000000000b' and nombre_visible is not null;
  if n = 1 then raise notice 'OK     11. Se ve el nombre de otra persona (para mostrar quién publica)';
  else raise notice 'FALLA  11. No se ve el nombre de otra persona'; end if;
exception when others then
  raise notice 'FALLA  11. No se ve el nombre de otra persona: %', sqlerrm;
end $$;

do $$ begin
  perform whatsapp from public.perfiles
  where id = '00000000-0000-4000-8000-00000000000b';
  raise notice 'FALLA  12. Se ve el WhatsApp de otra persona';
exception when insufficient_privilege then
  raise notice 'OK     12. No se ve el WhatsApp de otra persona';
end $$;

do $$ declare n int; begin
  select count(*) into n from public.mi_perfil() where whatsapp = '2215550000';
  if n = 1 then raise notice 'OK     13. Cada quien ve su perfil completo con mi_perfil()';
  else raise notice 'FALLA  13. mi_perfil() no devolvió el perfil propio completo'; end if;
exception when others then
  raise notice 'FALLA  13. mi_perfil() falló: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- plan de la cuenta
do $$ begin
  insert into public.plan_materias (plan_id, codigo, nombre, anio, periodo, orden)
  values ('prueba1', 'P0009', 'Inventada', 1, '1c', 9);
  raise notice 'FALLA  14. Con sesión se pueden agregar materias al plan';
exception when insufficient_privilege then
  raise notice 'OK     14. Con sesión tampoco se modifica el plan de estudios';
end $$;

do $$ declare n int; begin
  insert into public.planes_usuario (usuario_id, plan_id) values ('00000000-0000-4000-8000-00000000000a', 'prueba1');
  select count(*) into n from public.planes_usuario where usuario_id = '00000000-0000-4000-8000-00000000000a';
  if n = 1 then raise notice 'OK     15. Cada quien elige su plan de estudios';
  else raise notice 'FALLA  15. No quedó elegido el plan (% filas)', n; end if;
exception when others then
  raise notice 'FALLA  15. No se pudo elegir el plan: %', sqlerrm;
end $$;

do $$ declare n int; begin
  select count(*) into n from public.planes_usuario where usuario_id = '00000000-0000-4000-8000-00000000000b';
  if n = 0 then raise notice 'OK     16. No se ve el plan de otra persona';
  else raise notice 'FALLA  16. Se ve el plan de otra persona'; end if;
end $$;

do $$ begin
  insert into public.planes_usuario (usuario_id, plan_id) values ('00000000-0000-4000-8000-00000000000b', 'prueba2');
  raise notice 'FALLA  17. Se puede elegir un plan a nombre de otra persona';
exception when insufficient_privilege then
  raise notice 'OK     17. No se elige un plan a nombre de otra persona';
end $$;

do $$ begin
  insert into public.planes_usuario (usuario_id, plan_id, principal) values ('00000000-0000-4000-8000-00000000000a', 'prueba2', false);
  insert into public.planes_usuario (usuario_id, plan_id, principal) values ('00000000-0000-4000-8000-00000000000a', 'prueba3', false);
  insert into public.planes_usuario (usuario_id, plan_id, principal) values ('00000000-0000-4000-8000-00000000000a', 'prueba4', false);
  raise notice 'FALLA  18. Se superó el tope de tres planes por persona';
exception when insufficient_privilege then
  raise notice 'OK     18. No se supera el tope de tres planes por persona';
end $$;

do $$ begin
  insert into public.planes_usuario (usuario_id, plan_id, principal) values ('00000000-0000-4000-8000-00000000000a', 'prueba2', true);
  raise notice 'FALLA  19. Una persona puede tener dos planes principales';
exception when unique_violation then
  raise notice 'OK     19. Hay un solo plan principal por persona';
end $$;

-- ---------------------------------------------------------------- materias
do $$ declare n int; begin
  select count(*) into n from public.materias_cursadas where usuario_id = '00000000-0000-4000-8000-00000000000b';
  if n = 0 then raise notice 'OK     20. No se ven las materias de otra persona';
  else raise notice 'FALLA  20. Se ven las materias de otra persona'; end if;
exception when others then
  raise notice 'FALLA  20. Error inesperado al leer materias: %', sqlerrm;
end $$;

do $$ begin
  insert into public.materias_cursadas (usuario_id, plan_id, materia_id, estado, nota, aplazos)
  values ('00000000-0000-4000-8000-00000000000b', 'prueba1', 'P0002', 'aprobada', 10, 0);
  raise notice 'FALLA  21. Se pueden guardar materias a nombre de otra persona';
exception when insufficient_privilege then
  raise notice 'OK     21. No se guardan materias a nombre de otra persona';
end $$;

do $$ declare n int; begin
  update public.materias_cursadas set nota = 4 where usuario_id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'OK     22. No se modifican las materias de otra persona';
  else raise notice 'FALLA  22. Se modificó la nota de otra persona'; end if;
exception when others then
  raise notice 'OK     22. No se modifican las materias de otra persona (%)', sqlerrm;
end $$;

-- Exactamente lo que manda la API al guardar: insertar o actualizar.
do $$ declare n int; e text; begin
  insert into public.materias_cursadas (usuario_id, plan_id, materia_id, estado, nota, aplazos)
  values ('00000000-0000-4000-8000-00000000000a', 'prueba1', 'P0001', 'regular', null, 0)
  on conflict (usuario_id, plan_id, materia_id) do update
    set usuario_id = excluded.usuario_id, plan_id = excluded.plan_id, materia_id = excluded.materia_id,
        estado = excluded.estado, nota = excluded.nota, aplazos = excluded.aplazos;

  insert into public.materias_cursadas (usuario_id, plan_id, materia_id, estado, nota, aplazos)
  values ('00000000-0000-4000-8000-00000000000a', 'prueba1', 'P0001', 'aprobada', 8.5, 1)
  on conflict (usuario_id, plan_id, materia_id) do update
    set usuario_id = excluded.usuario_id, plan_id = excluded.plan_id, materia_id = excluded.materia_id,
        estado = excluded.estado, nota = excluded.nota, aplazos = excluded.aplazos;

  select count(*), max(estado) into n, e from public.materias_cursadas where usuario_id = '00000000-0000-4000-8000-00000000000a';
  if n = 1 and e = 'aprobada' then raise notice 'OK     23. Cada quien guarda y corrige sus materias';
  else raise notice 'FALLA  23. No se guardó bien la materia propia (% filas, estado %)', n, e; end if;
exception when others then
  raise notice 'FALLA  23. No se pudo guardar la materia propia: %', sqlerrm;
end $$;

do $$ begin
  insert into public.materias_cursadas (usuario_id, plan_id, materia_id, estado)
  values ('00000000-0000-4000-8000-00000000000a', 'prueba1', 'X9999', 'cursando');
  raise notice 'FALLA  24. Se guardó una materia que no existe en el plan';
exception when foreign_key_violation then
  raise notice 'OK     24. No se guarda una materia que no existe en el plan';
end $$;

-- prueba3 existe y tiene la materia, pero la persona A no eligió ese plan.
do $$ begin
  insert into public.materias_cursadas (usuario_id, plan_id, materia_id, estado)
  values ('00000000-0000-4000-8000-00000000000a', 'prueba3', 'P0001', 'cursando');
  raise notice 'FALLA  25. Se guardan materias de un plan que la cuenta no eligió';
exception when foreign_key_violation then
  raise notice 'OK     25. Sólo se guardan materias de un plan elegido';
end $$;

do $$ begin
  insert into public.materias_cursadas (usuario_id, plan_id, materia_id, estado, actualizado_at)
  values ('00000000-0000-4000-8000-00000000000a', 'prueba1', 'P0002', 'cursando', now() + interval '10 years');
  raise notice 'FALLA  26. Se puede elegir la fecha de actualización';
exception when insufficient_privilege then
  raise notice 'OK     26. La fecha de actualización la pone la base, no el navegador';
end $$;

do $$ begin
  insert into public.materias_cursadas (usuario_id, plan_id, materia_id, estado, nota)
  values ('00000000-0000-4000-8000-00000000000a', 'prueba1', 'P0002', 'aprobada', 11);
  raise notice 'FALLA  27. Se guardó una nota fuera de rango';
exception when check_violation then
  raise notice 'OK     27. No se guardan notas fuera del 4 al 10';
end $$;

do $$ begin
  insert into public.materias_cursadas (usuario_id, plan_id, materia_id, estado, nota)
  values ('00000000-0000-4000-8000-00000000000a', 'prueba1', 'P0002', 'regular', 7);
  raise notice 'FALLA  28. Se guardó una nota en una materia no aprobada';
exception when check_violation then
  raise notice 'OK     28. Sólo una materia aprobada tiene nota';
end $$;

do $$ begin
  insert into public.materias_cursadas (usuario_id, plan_id, materia_id, estado, fecha_aprobacion)
  values ('00000000-0000-4000-8000-00000000000a', 'prueba1', 'P0002', 'cursando', date '2025-07-01');
  raise notice 'FALLA  29. Se guardó fecha de aprobación en una materia no aprobada';
exception when check_violation then
  raise notice 'OK     29. La fecha de aprobación es sólo de materias aprobadas';
end $$;

do $$ declare n int; begin
  insert into public.materias_cursadas (usuario_id, plan_id, materia_id, estado, regular_vence)
  values ('00000000-0000-4000-8000-00000000000a', 'prueba1', 'P0003', 'regular', date '2027-11-16');
  select count(*) into n from public.materias_cursadas
  where usuario_id = '00000000-0000-4000-8000-00000000000a' and regular_vence is not null;
  if n = 1 then raise notice 'OK     30. Se guarda hasta cuándo vale una regularidad';
  else raise notice 'FALLA  30. No se guardó el vencimiento de la regularidad'; end if;
exception when others then
  raise notice 'FALLA  30. No se pudo guardar el vencimiento: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- complementarias
do $$ declare n int; begin
  select count(*) into n from public.complementarias_cursadas where usuario_id = '00000000-0000-4000-8000-00000000000b';
  if n = 0 then raise notice 'OK     31. No se ven los cursos complementarios de otra persona';
  else raise notice 'FALLA  31. Se ven los cursos complementarios de otra persona'; end if;
end $$;

do $$ begin
  insert into public.complementarias_cursadas (id, usuario_id, plan_id, nombre, horas)
  values (gen_random_uuid(), '00000000-0000-4000-8000-00000000000b', 'prueba1', 'Curso ajeno', 30);
  raise notice 'FALLA  32. Se guardan cursos a nombre de otra persona';
exception when insufficient_privilege then
  raise notice 'OK     32. No se guardan cursos a nombre de otra persona';
end $$;

do $$ declare n int; begin
  insert into public.complementarias_cursadas (id, usuario_id, plan_id, nombre, horas, nota)
  select gen_random_uuid(), '00000000-0000-4000-8000-00000000000a', 'prueba1', 'Curso ' || g, 10, 7
  from generate_series(1, 40) g;
  get diagnostics n = row_count;
  if n = 40 then raise notice 'OK     33. Se guardan cursos complementarios propios';
  else raise notice 'FALLA  33. No se guardaron los 40 cursos (% filas)', n; end if;
exception when others then
  raise notice 'FALLA  33. No se pudieron guardar cursos propios: %', sqlerrm;
end $$;

do $$ begin
  insert into public.complementarias_cursadas (id, usuario_id, plan_id, nombre, horas)
  values (gen_random_uuid(), '00000000-0000-4000-8000-00000000000a', 'prueba1', 'Curso 41', 10);
  raise notice 'FALLA  34. Se superó el tope de 40 cursos complementarios';
exception when insufficient_privilege then
  raise notice 'OK     34. No se supera el tope de 40 cursos complementarios';
end $$;

do $$ declare n int; m int; begin
  insert into public.planes_usuario (usuario_id, plan_id, principal) values ('00000000-0000-4000-8000-00000000000a', 'prueba2', false);
  insert into public.materias_cursadas (usuario_id, plan_id, materia_id, estado)
  values ('00000000-0000-4000-8000-00000000000a', 'prueba2', 'P0001', 'cursando');
  delete from public.planes_usuario where usuario_id = '00000000-0000-4000-8000-00000000000a' and plan_id = 'prueba2';
  select count(*) into n from public.materias_cursadas where usuario_id = '00000000-0000-4000-8000-00000000000a' and plan_id = 'prueba2';
  select count(*) into m from public.materias_cursadas where usuario_id = '00000000-0000-4000-8000-00000000000a' and plan_id = 'prueba1';
  if n = 0 and m = 2 then raise notice 'OK     35. Quitar un plan de la cuenta borra sus materias y no las del otro';
  else raise notice 'FALLA  35. Quitar un plan dejó materias (% del quitado, % del otro)', n, m; end if;
exception when others then
  raise notice 'FALLA  35. No se pudo quitar un plan de la cuenta: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- bolsa
do $$ begin
  insert into public.publicaciones_bolsa (usuario_id, titulo, categoria, precio_texto, estado_uso, ubicacion)
  values ('00000000-0000-4000-8000-00000000000a', 'Turbina de prueba', 'Instrumental', '$10.000', 'Usada', 'Hall');
  raise notice 'FALLA  36. Una cuenta recién creada puede publicar';
exception when insufficient_privilege then
  raise notice 'OK     36. Una cuenta recién creada no puede publicar en las primeras 24 h';
end $$;

-- Pasan las 24 horas (lo simula postgres)
reset role;
update public.perfiles set puede_publicar_desde = now() - interval '1 day'
where id = '00000000-0000-4000-8000-00000000000a';
set local role authenticated;

do $$ declare n int; begin
  insert into public.publicaciones_bolsa (usuario_id, titulo, categoria, precio_texto, estado_uso, ubicacion)
  values ('00000000-0000-4000-8000-00000000000a', 'Turbina de prueba', 'Instrumental', '$10.000', 'Usada', 'Hall');
  get diagnostics n = row_count;
  if n = 1 then raise notice 'OK     37. Pasadas las 24 h se puede publicar';
  else raise notice 'FALLA  37. Pasadas las 24 h no se pudo publicar'; end if;
exception when others then
  raise notice 'FALLA  37. Pasadas las 24 h no se pudo publicar: %', sqlerrm;
end $$;

-- Con una sola publicación activa: lo único que puede frenar esto es el
-- permiso de columna (el límite de 5 todavía no aplica).
do $$ begin
  insert into public.publicaciones_bolsa (usuario_id, titulo, categoria, precio_texto, estado_uso, ubicacion, expira_at)
  values ('00000000-0000-4000-8000-00000000000a', 'Turbina eterna', 'Instrumental', '$1', 'Usada', 'Hall', now() + interval '50 years');
  raise notice 'FALLA  38. Se puede publicar con vencimiento a elección';
exception when insufficient_privilege then
  raise notice 'OK     38. No se puede elegir el vencimiento de una publicación';
end $$;

do $$ declare n int; begin
  insert into public.publicaciones_bolsa (usuario_id, titulo, categoria, precio_texto, estado_uso, ubicacion) values
    ('00000000-0000-4000-8000-00000000000a', 'Articulo 2', 'Instrumental', '$1', 'Usado', 'Hall'),
    ('00000000-0000-4000-8000-00000000000a', 'Articulo 3', 'Instrumental', '$1', 'Usado', 'Hall'),
    ('00000000-0000-4000-8000-00000000000a', 'Articulo 4', 'Instrumental', '$1', 'Usado', 'Hall'),
    ('00000000-0000-4000-8000-00000000000a', 'Articulo 5', 'Instrumental', '$1', 'Usado', 'Hall');
  get diagnostics n = row_count;
  if n = 4 then raise notice 'OK     39. Se puede llegar a 5 publicaciones activas';
  else raise notice 'FALLA  39. No se pudo llegar a 5 publicaciones activas (% filas)', n; end if;
exception when others then
  raise notice 'FALLA  39. No se pudo llegar a 5 publicaciones activas: %', sqlerrm;
end $$;

-- Inserción múltiple: con la versión de 001 del límite, esto pasaba.
do $$ begin
  insert into public.publicaciones_bolsa (usuario_id, titulo, categoria, precio_texto, estado_uso, ubicacion) values
    ('00000000-0000-4000-8000-00000000000a', 'Articulo 6', 'Instrumental', '$1', 'Usado', 'Hall'),
    ('00000000-0000-4000-8000-00000000000a', 'Articulo 7', 'Instrumental', '$1', 'Usado', 'Hall');
  raise notice 'FALLA  40. Se superó el límite de 5 publicaciones con una inserción múltiple';
exception when insufficient_privilege then
  raise notice 'OK     40. No se supera el límite de 5, ni con una inserción múltiple';
end $$;

-- Moderación oculta las publicaciones (lo simula postgres)
reset role;
update public.publicaciones_bolsa set estado = 'oculta'
where usuario_id = '00000000-0000-4000-8000-00000000000a';
set local role authenticated;

do $$ declare n int; begin
  update public.publicaciones_bolsa set estado = 'activa'
  where usuario_id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'OK     41. No se reactiva una publicación ocultada por moderación';
  else raise notice 'FALLA  41. Se reactivó una publicación ocultada por moderación'; end if;
exception when others then
  raise notice 'OK     41. No se reactiva una publicación ocultada por moderación (%)', sqlerrm;
end $$;

do $$ declare n int; begin
  delete from public.publicaciones_bolsa
  where usuario_id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'OK     42. No se borra una publicación ocultada por moderación';
  else raise notice 'FALLA  42. Se borró una publicación ocultada por moderación'; end if;
exception when others then
  raise notice 'OK     42. No se borra una publicación ocultada por moderación (%)', sqlerrm;
end $$;

-- ---------------------------------------------------------------- consentimientos
do $$ declare n int; begin
  insert into public.consentimientos (usuario_id, tipo, version_texto)
  values ('00000000-0000-4000-8000-00000000000a', 'terminos', 'prueba');
  get diagnostics n = row_count;
  if n = 1 then raise notice 'OK     43. Se registra el propio consentimiento';
  else raise notice 'FALLA  43. No se pudo registrar el consentimiento'; end if;
exception when others then
  raise notice 'FALLA  43. No se pudo registrar el consentimiento: %', sqlerrm;
end $$;

do $$ begin
  insert into public.consentimientos (usuario_id, tipo, version_texto, otorgado_at)
  values ('00000000-0000-4000-8000-00000000000a', 'terminos', 'prueba', now() - interval '2 years');
  raise notice 'FALLA  44. Se puede antedatar un consentimiento';
exception when insufficient_privilege then
  raise notice 'OK     44. No se puede antedatar un consentimiento';
end $$;

-- ---------------------------------------------------------------- eliminar cuenta
do $$ begin
  perform public.eliminar_mi_cuenta();
  raise notice 'OK     45. Se puede eliminar la propia cuenta';
exception when others then
  raise notice 'FALLA  45. No se pudo eliminar la propia cuenta: %', sqlerrm;
end $$;

reset role;

do $$ begin
  if not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-00000000000a')
     and not exists (select 1 from public.perfiles where id = '00000000-0000-4000-8000-00000000000a')
     and not exists (select 1 from public.materias_cursadas where usuario_id = '00000000-0000-4000-8000-00000000000a')
     and not exists (select 1 from public.planes_usuario where usuario_id = '00000000-0000-4000-8000-00000000000a')
     and not exists (select 1 from public.complementarias_cursadas where usuario_id = '00000000-0000-4000-8000-00000000000a')
     and not exists (select 1 from public.publicaciones_bolsa where usuario_id = '00000000-0000-4000-8000-00000000000a')
     and not exists (select 1 from public.consentimientos where usuario_id = '00000000-0000-4000-8000-00000000000a')
     and exists (select 1 from auth.users where id = '00000000-0000-4000-8000-00000000000b')
     and exists (select 1 from public.materias_cursadas where usuario_id = '00000000-0000-4000-8000-00000000000b')
     and exists (select 1 from public.complementarias_cursadas where usuario_id = '00000000-0000-4000-8000-00000000000b')
  then
    raise notice 'OK     46. Eliminar la cuenta borra todo lo suyo y nada de nadie más';
  else
    raise notice 'FALLA  46. La eliminación dejó datos propios o tocó datos ajenos';
  end if;
end $$;

rollback;

\echo
\echo 'Pruebas terminadas (00 a 46). Todo se deshizo con ROLLBACK: no quedó nada en la base.'
\echo 'Si alguna línea dice FALLA, no publiques el cambio en el sitio.'
