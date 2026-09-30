-- ==========================================================================
-- OdontoCampus — Pruebas de seguridad del esquema (RLS y permisos)
--
-- Correr DESPUÉS de aplicar todas las migraciones (001 a 011, ...), y otra
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

-- Pasan las 24 horas (lo simula postgres). Desde 009 publicar pide además
-- legajo y teléfono: A ya cargó el teléfono en la prueba 10.
reset role;
update public.perfiles set puede_publicar_desde = now() - interval '1 day', legajo = '26778/6'
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

-- ==========================================================================
-- ADMINISTRACIÓN (005)
-- ==========================================================================
-- Preparación (como postgres): D y F administran, E es una cuenta común.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000d', 'admin-d@odontocampus.invalid', now(), '{"nombre_visible":"Admin D"}'),
  ('00000000-0000-4000-8000-00000000000e', 'comun-e@odontocampus.invalid', null, '{"nombre_visible":"Comun E"}'),
  ('00000000-0000-4000-8000-00000000000f', 'admin-f@odontocampus.invalid', now(), '{"nombre_visible":"Admin F"}');
insert into public.administradores (usuario_id) values ('00000000-0000-4000-8000-00000000000d'), ('00000000-0000-4000-8000-00000000000f');

-- ---------------------------------------------------------------- sin sesión
set local role anon;
do $$ begin perform set_config('request.jwt.claims', '{"role":"anon"}', true); end $$;

do $$ declare n int; begin
  select count(*) into n from public.configuracion_sitio where clave = 'planilla_mesas';
  if n = 1 then raise notice 'OK     47. Sin sesión se lee qué planillas usa el sitio';
  else raise notice 'FALLA  47. Sin sesión no se lee la configuración de planillas'; end if;
exception when others then
  raise notice 'FALLA  47. Sin sesión no se lee la configuración: %', sqlerrm;
end $$;

do $$ begin
  perform public.admin_resumen();
  raise notice 'FALLA  48. Sin sesión se puede llamar a una función del panel';
exception when insufficient_privilege then
  raise notice 'OK     48. Sin sesión no se llama a ninguna función del panel';
end $$;

reset role;

-- ---------------------------------------------------------------- cuenta común (B)
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
end $$;

do $$ begin
  if not public.es_admin() then raise notice 'OK     49. Una cuenta común no figura como admin';
  else raise notice 'FALLA  49. Una cuenta común figura como admin'; end if;
end $$;

do $$ begin
  perform public.admin_listar_usuarios(null, 50, 0);
  raise notice 'FALLA  50. Una cuenta común ve el listado de cuentas';
exception when insufficient_privilege then
  raise notice 'OK     50. Una cuenta común no ve el listado de cuentas';
end $$;

do $$ begin
  insert into public.administradores (usuario_id) values ('00000000-0000-4000-8000-00000000000b');
  raise notice 'FALLA  51. Una cuenta común se puede hacer admin sola';
exception when insufficient_privilege then
  raise notice 'OK     51. Nadie se hace admin solo';
end $$;

do $$ begin
  perform public.admin_otorgar('prueba-b@odontocampus.invalid');
  raise notice 'FALLA  52. Una cuenta común puede otorgar el rol';
exception when insufficient_privilege then
  raise notice 'OK     52. Una cuenta común no otorga el rol';
end $$;

do $$ begin
  update public.configuracion_sitio set valor = '{"sheet_id":"x"}' where clave = 'planilla_mesas';
  raise notice 'FALLA  53. Una cuenta común cambia las planillas';
exception when insufficient_privilege then
  raise notice 'OK     53. Una cuenta común no cambia las planillas';
end $$;

do $$ begin
  perform count(*) from public.registro_admin;
  raise notice 'FALLA  54. Una cuenta común lee el registro de administración';
exception when insufficient_privilege then
  raise notice 'OK     54. El registro de administración no se lee directo';
end $$;

-- ---------------------------------------------------------------- admin (D)
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
end $$;

do $$ declare r jsonb; begin
  r := public.admin_resumen();
  if public.es_admin() and (r ->> 'admins')::int >= 2 then raise notice 'OK     55. Un admin ve el resumen de cuentas';
  else raise notice 'FALLA  55. El resumen no salió bien: %', r; end if;
exception when others then
  raise notice 'FALLA  55. Un admin no pudo ver el resumen: %', sqlerrm;
end $$;

do $$ declare n int; t bigint; begin
  select count(*), max(total) into n, t from public.admin_listar_usuarios('comun-e', 50, 0);
  if n = 1 and t = 1 then raise notice 'OK     56. Un admin busca cuentas por correo';
  else raise notice 'FALLA  56. La búsqueda devolvió % filas (total %)', n, t; end if;
exception when others then
  raise notice 'FALLA  56. Un admin no pudo listar cuentas: %', sqlerrm;
end $$;

do $$ begin
  perform public.admin_suspender('00000000-0000-4000-8000-00000000000e', 'x');
  raise notice 'FALLA  57. Se suspende sin motivo';
exception when check_violation then
  raise notice 'OK     57. Suspender pide un motivo';
end $$;

do $$ declare est text; ban timestamptz; begin
  perform public.admin_suspender('00000000-0000-4000-8000-00000000000e', 'Publicaciones falsas en la bolsa');
  reset role;
  select p.estado, u.banned_until into est, ban
  from public.perfiles p join auth.users u on u.id = p.id where p.id = '00000000-0000-4000-8000-00000000000e';
  set local role authenticated;
  if est = 'suspendido' and ban = 'infinity' then raise notice 'OK     58. Un admin suspende una cuenta (sin ingreso ni sesiones)';
  else raise notice 'FALLA  58. La suspensión quedó a medias (%, %)', est, ban; end if;
exception when others then
  raise notice 'FALLA  58. Un admin no pudo suspender: %', sqlerrm;
end $$;

do $$ declare est text; ban timestamptz; begin
  perform public.admin_reactivar('00000000-0000-4000-8000-00000000000e');
  reset role;
  select p.estado, u.banned_until into est, ban
  from public.perfiles p join auth.users u on u.id = p.id where p.id = '00000000-0000-4000-8000-00000000000e';
  set local role authenticated;
  if est = 'activo' and ban is null then raise notice 'OK     59. Un admin reactiva una cuenta';
  else raise notice 'FALLA  59. La reactivación quedó a medias (%, %)', est, ban; end if;
exception when others then
  raise notice 'FALLA  59. Un admin no pudo reactivar: %', sqlerrm;
end $$;

do $$ begin
  perform public.admin_suspender('00000000-0000-4000-8000-00000000000d', 'Me suspendo a mí');
  raise notice 'FALLA  60. Un admin se suspende a sí mismo';
exception when insufficient_privilege then
  raise notice 'OK     60. Un admin no opera sobre su propia cuenta';
end $$;

do $$ begin
  perform public.admin_eliminar_usuario('00000000-0000-4000-8000-00000000000f', 'admin-f@odontocampus.invalid');
  raise notice 'FALLA  61. Un admin elimina a otra persona admin';
exception when insufficient_privilege then
  raise notice 'OK     61. No se elimina ni suspende a otra admin sin quitarle el rol';
end $$;

do $$ begin
  perform public.admin_otorgar('comun-e@odontocampus.invalid');
  raise notice 'FALLA  62. Se otorga el rol a una cuenta sin confirmar';
exception when check_violation then
  raise notice 'OK     62. El rol sólo se otorga a cuentas confirmadas';
end $$;

do $$ declare conf timestamptz; begin
  perform public.admin_confirmar_correo('00000000-0000-4000-8000-00000000000e');
  reset role;
  select email_confirmed_at into conf from auth.users where id = '00000000-0000-4000-8000-00000000000e';
  set local role authenticated;
  if conf is not null then raise notice 'OK     63. Un admin confirma un correo a mano';
  else raise notice 'FALLA  63. El correo no quedó confirmado'; end if;
exception when others then
  raise notice 'FALLA  63. Un admin no pudo confirmar el correo: %', sqlerrm;
end $$;

do $$ begin
  perform public.admin_quitar('00000000-0000-4000-8000-00000000000d');
  raise notice 'FALLA  64. Un admin se quita el rol a sí mismo';
exception when insufficient_privilege then
  raise notice 'OK     64. Nadie se quita el rol a sí mismo (siempre queda alguien)';
end $$;

do $$ begin
  perform public.admin_guardar_planilla('planilla_mesas', 'no es un id', '0');
  raise notice 'FALLA  65. Se guardó una planilla inválida';
exception when check_violation then
  raise notice 'OK     65. No se guarda un enlace de planilla inválido';
end $$;

do $$ declare v jsonb; begin
  perform public.admin_guardar_planilla('planilla_mesas', '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', '123');
  select valor into v from public.configuracion_sitio where clave = 'planilla_mesas';
  if v ->> 'gid' = '123' then raise notice 'OK     66. Un admin cambia la planilla de mesas';
  else raise notice 'FALLA  66. La planilla no cambió: %', v; end if;
exception when others then
  raise notice 'FALLA  66. Un admin no pudo cambiar la planilla: %', sqlerrm;
end $$;

do $$ begin
  perform public.admin_eliminar_usuario('00000000-0000-4000-8000-00000000000e', 'otro@correo.invalid');
  raise notice 'FALLA  67. Se elimina una cuenta sin escribir bien su correo';
exception when check_violation then
  raise notice 'OK     67. Eliminar una cuenta pide escribir su correo';
end $$;

do $$ declare existe boolean; begin
  perform public.admin_eliminar_usuario('00000000-0000-4000-8000-00000000000e', 'COMUN-E@odontocampus.invalid');
  reset role;
  select exists (select 1 from auth.users where id = '00000000-0000-4000-8000-00000000000e') into existe;
  set local role authenticated;
  if not existe then raise notice 'OK     68. Un admin elimina una cuenta común';
  else raise notice 'FALLA  68. La cuenta sigue existiendo'; end if;
exception when others then
  raise notice 'FALLA  68. Un admin no pudo eliminar la cuenta: %', sqlerrm;
end $$;

-- Sólo lo que hizo esta prueba: en una base que ya viene usándose, el
-- registro tiene además las acciones reales de quienes administran.
do $$ declare acciones text; begin
  select string_agg(accion, ',' order by accion) into acciones
  from (select distinct accion from public.admin_registro(500)
        where admin_email = 'admin-d@odontocampus.invalid') x;
  if acciones = 'cambiar_planilla,confirmar_correo,eliminar_cuenta,reactivar,suspender'
  then raise notice 'OK     69. Todo lo que hace un admin queda en el registro';
  else raise notice 'FALLA  69. El registro tiene: %', acciones; end if;
exception when others then
  raise notice 'FALLA  69. No se pudo leer el registro: %', sqlerrm;
end $$;

do $$ begin
  perform public.admin_quitar('00000000-0000-4000-8000-00000000000f');
  if not exists (select 1 from public.admin_listar_admins() where id = '00000000-0000-4000-8000-00000000000f')
  then raise notice 'OK     70. Un admin le quita el rol a otra persona';
  else raise notice 'FALLA  70. El rol no se quitó'; end if;
exception when others then
  raise notice 'FALLA  70. No se pudo quitar el rol: %', sqlerrm;
end $$;

reset role;

-- ==========================================================================
-- AGENDA PERSONAL Y PLANILLA DE PREGUNTAS (006)
-- ==========================================================================
-- Preparación (como postgres). La persona A ya no existe: la eliminó la
-- prueba 45, así que la agenda usa una cuenta nueva, G.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000011', 'agenda-g@odontocampus.invalid', now(), '{"nombre_visible":"Agenda G"}');

-- Un recordatorio de B, cargado por postgres.
insert into public.recordatorios (id, usuario_id, titulo, tipo, fecha)
values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b', 'Entrega de B', 'entrega', current_date + 3);

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
end $$;

do $$ declare n int; begin
  select count(*) into n from public.recordatorios;
  if n = 1 then raise notice 'OK     71. Cada quien ve sus propios recordatorios';
  else raise notice 'FALLA  71. Se ven % recordatorios en vez de 1', n; end if;
exception when others then
  raise notice 'FALLA  71. No se pudieron leer los recordatorios: %', sqlerrm;
end $$;

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
end $$;

do $$ declare n int; begin
  select count(*) into n from public.recordatorios;
  if n = 0 then raise notice 'OK     72. No se ven los recordatorios de otra persona';
  else raise notice 'FALLA  72. Se ven los recordatorios de otra persona'; end if;
end $$;

do $$ begin
  insert into public.recordatorios (id, usuario_id, titulo, tipo, fecha)
  values (gen_random_uuid(), '00000000-0000-4000-8000-00000000000b', 'Ajeno', 'entrega', current_date);
  raise notice 'FALLA  73. Se anotan recordatorios a nombre de otra persona';
exception when insufficient_privilege then
  raise notice 'OK     73. No se anotan recordatorios a nombre de otra persona';
end $$;

do $$ declare t text; begin
  insert into public.recordatorios (id, usuario_id, titulo, tipo, fecha, hora, materia)
  values ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000011', 'Historia clínica', 'entrega', current_date + 7, '14:30', 'Operatoria Dental IV')
  on conflict (id) do update set titulo = excluded.titulo;

  insert into public.recordatorios (id, usuario_id, titulo, tipo, fecha, hecho)
  values ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000011', 'Historia clínica corregida', 'entrega', current_date + 7, true)
  on conflict (id) do update
    set titulo = excluded.titulo, fecha = excluded.fecha, hecho = excluded.hecho;

  select titulo into t from public.recordatorios where id = '00000000-0000-4000-8000-00000000000b';
  if t = 'Historia clínica corregida' then raise notice 'OK     74. Cada quien anota y corrige sus recordatorios';
  else raise notice 'FALLA  74. El recordatorio quedó como %', t; end if;
exception when others then
  raise notice 'FALLA  74. No se pudo anotar el recordatorio: %', sqlerrm;
end $$;

do $$ begin
  insert into public.recordatorios (id, usuario_id, titulo, tipo, fecha)
  values (gen_random_uuid(), '00000000-0000-4000-8000-000000000011', 'Cualquiera', 'cumpleaños', current_date);
  raise notice 'FALLA  75. Se guardó un tipo de recordatorio inventado';
exception when check_violation then
  raise notice 'OK     75. Sólo se guardan entregas, finales y otros';
end $$;

do $$ begin
  insert into public.recordatorios (id, usuario_id, titulo, tipo, fecha)
  select gen_random_uuid(), '00000000-0000-4000-8000-000000000011', 'Clase ' || g, 'otro', current_date
  from generate_series(1, 200) g;
  raise notice 'FALLA  76. Se superó el tope de 200 recordatorios';
exception
  when insufficient_privilege then
    raise notice 'OK     76. No se supera el tope de 200 recordatorios';
  when others then
    raise notice 'FALLA  76. Error inesperado al probar el tope: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- preguntas
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
end $$;

do $$ declare v jsonb; begin
  perform public.admin_guardar_planilla('planilla_preguntas', '1PreguntasAbCdEfGhIjKlMnOpQrStUvWx', '7');
  select valor into v from public.configuracion_sitio where clave = 'planilla_preguntas';
  if v ->> 'gid' = '7' then raise notice 'OK     77. Un admin carga la planilla de preguntas';
  else raise notice 'FALLA  77. La planilla de preguntas no cambió: %', v; end if;
exception when others then
  raise notice 'FALLA  77. No se pudo cargar la planilla de preguntas: %', sqlerrm;
end $$;

do $$ declare v jsonb; begin
  perform public.admin_guardar_planilla('planilla_preguntas', '', '0');
  select valor into v from public.configuracion_sitio where clave = 'planilla_preguntas';
  if v ->> 'sheet_id' = '' then raise notice 'OK     78. La planilla de preguntas se puede vaciar (apaga el juego)';
  else raise notice 'FALLA  78. No se pudo vaciar la planilla de preguntas'; end if;
exception when others then
  raise notice 'FALLA  78. No se pudo vaciar la planilla de preguntas: %', sqlerrm;
end $$;

do $$ begin
  perform public.admin_guardar_planilla('planilla_mesas', '', '0');
  raise notice 'FALLA  79. Se vació la planilla de mesas (dejaría al sitio sin fechas)';
exception when check_violation then
  raise notice 'OK     79. Las planillas de mesas y reválidas no se pueden vaciar';
end $$;

reset role;

do $$ declare n int; begin
  delete from auth.users where id = '00000000-0000-4000-8000-00000000000b';
  select count(*) into n from public.recordatorios where usuario_id = '00000000-0000-4000-8000-00000000000b';
  if n = 0 then raise notice 'OK     80. Eliminar una cuenta borra también sus recordatorios';
  else raise notice 'FALLA  80. Quedaron % recordatorios de una cuenta eliminada', n; end if;
end $$;

-- ==========================================================================
-- CONSULTAS SIN RESPUESTA DEL BOT (007)
-- ==========================================================================
set local role anon;
do $$ begin perform set_config('request.jwt.claims', '{"role":"anon"}', true); end $$;

do $$ begin
  perform public.anotar_consulta_bot('  ¿Cuándo abre la INSCRIPCIÓN   a cursadas? ');
  perform public.anotar_consulta_bot('¿cuándo abre la inscripción a cursadas?');
  raise notice 'OK     81. Sin sesión se puede anotar una consulta que el bot no supo';
exception when others then
  raise notice 'FALLA  81. Sin sesión no se pudo anotar la consulta: %', sqlerrm;
end $$;

do $$ begin
  perform count(*) from public.consultas_bot;
  raise notice 'FALLA  82. Sin sesión se lee la lista de consultas';
exception when insufficient_privilege then
  raise notice 'OK     82. La lista de consultas no se lee directo';
end $$;

do $$ begin
  perform public.anotar_consulta_bot('escribime a nombre.apellido@gmail.com o al 2211234567 dni 40123456');
  raise notice 'OK     83a. Se anota una consulta con datos personales adentro';
exception when others then
  raise notice 'FALLA  83a. No se pudo anotar: %', sqlerrm;
end $$;

reset role;

do $$ declare n int; guardado text; begin
  select count(*) into n from public.consultas_bot where texto like '%inscripcion%' or texto like '%inscripción%';
  select texto into guardado from public.consultas_bot where texto like 'escribime%';
  if n = 1 and guardado = 'escribime a (correo) o al (número) dni (número)' then
    raise notice 'OK     83. Se juntan las repetidas y no se guardan correos ni números largos';
  else
    raise notice 'FALLA  83. Quedó: % (repetidas: %)', guardado, n;
  end if;
end $$;

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
end $$;

do $$ begin
  perform public.admin_consultas_bot(100, false);
  raise notice 'FALLA  84. Una cuenta común ve las consultas del bot';
exception when insufficient_privilege then
  raise notice 'OK     84. Una cuenta común no ve las consultas del bot';
end $$;

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
end $$;

do $$ declare v int; begin
  select veces into v from public.admin_consultas_bot(100, false)
  where texto like '%inscripci_n a cursadas%';
  if v = 2 then raise notice 'OK     85. Un admin ve las consultas pendientes, con cuántas veces se repitieron';
  else raise notice 'FALLA  85. El listado devolvió veces = %', v; end if;
exception when others then
  raise notice 'FALLA  85. Un admin no pudo ver las consultas: %', sqlerrm;
end $$;

do $$ declare pendientes int; begin
  perform public.admin_marcar_consulta('¿cuándo abre la inscripción a cursadas?', true);
  select count(*) into pendientes from public.admin_consultas_bot(100, false)
  where texto like '%inscripci_n a cursadas%';
  if pendientes = 0 then raise notice 'OK     86. Marcar una consulta como respondida la saca de las pendientes';
  else raise notice 'FALLA  86. La consulta sigue pendiente'; end if;
exception when others then
  raise notice 'FALLA  86. No se pudo marcar la consulta: %', sqlerrm;
end $$;

do $$ declare n int; begin
  perform public.admin_borrar_consulta('escribime a (correo) o al (número) dni (número)');
  select count(*) into n from public.admin_consultas_bot(100, true) where texto like 'escribime%';
  if n = 0 then raise notice 'OK     87. Un admin puede borrar una consulta de la lista';
  else raise notice 'FALLA  87. La consulta no se borró'; end if;
exception when others then
  raise notice 'FALLA  87. No se pudo borrar la consulta: %', sqlerrm;
end $$;

reset role;

-- ==========================================================================
-- PLANILLA DE LA BIBLIOTECA (008)
-- ==========================================================================
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
end $$;

do $$ declare v jsonb; begin
  perform public.admin_guardar_planilla('planilla_biblioteca', '1BibliotecaAbCdEfGhIjKlMnOpQrStUv', '0');
  select valor into v from public.configuracion_sitio where clave = 'planilla_biblioteca';
  if v ->> 'sheet_id' = '1BibliotecaAbCdEfGhIjKlMnOpQrStUv' then raise notice 'OK     88. Un admin carga la planilla de la biblioteca';
  else raise notice 'FALLA  88. La planilla de la biblioteca no cambió: %', v; end if;
exception when others then
  raise notice 'FALLA  88. No se pudo cargar la planilla de la biblioteca: %', sqlerrm;
end $$;

do $$ declare v jsonb; begin
  perform public.admin_guardar_planilla('planilla_biblioteca', '', '0');
  select valor into v from public.configuracion_sitio where clave = 'planilla_biblioteca';
  if v ->> 'sheet_id' = '' then raise notice 'OK     89. La planilla de la biblioteca se puede vaciar (vuelve a la copia del Drive)';
  else raise notice 'FALLA  89. No se pudo vaciar la planilla de la biblioteca'; end if;
exception when others then
  raise notice 'FALLA  89. No se pudo vaciar la planilla de la biblioteca: %', sqlerrm;
end $$;

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
  perform public.admin_guardar_planilla('planilla_biblioteca', '1BibliotecaAbCdEfGhIjKlMnOpQrStUv', '0');
  raise notice 'FALLA  90. Una cuenta común cambia la planilla de la biblioteca';
exception when insufficient_privilege then
  raise notice 'OK     90. Una cuenta común no cambia la planilla de la biblioteca';
end $$;

reset role;

-- ==========================================================================
-- BOLSA MODERADA (009)
-- G publica; H es otra cuenta común, nueva (A, B, E y F ya se eliminaron
-- en pruebas anteriores); D administra.
-- ==========================================================================
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000012', 'bolsa-h@odontocampus.invalid', now(), '{"nombre_visible":"Bolsa H"}');
update public.perfiles set puede_publicar_desde = now() - interval '1 day' where id = '00000000-0000-4000-8000-000000000011';

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
end $$;

do $$ begin
  insert into public.publicaciones_bolsa (usuario_id, tipo, titulo, categoria, precio_texto, estado_uso, ubicacion)
  values ('00000000-0000-4000-8000-000000000011', 'venta', 'Turbina Kavo', 'Instrumental', '$50.000', 'Usada', 'Facultad');
  raise notice 'FALLA  91. Se publica sin legajo ni teléfono';
exception when insufficient_privilege then
  raise notice 'OK     91. Sin legajo y teléfono no se publica';
end $$;

do $$ begin
  update public.perfiles set legajo = '12345' where id = '00000000-0000-4000-8000-000000000011';
  raise notice 'FALLA  92. Se guardó un legajo con formato inválido';
exception when check_violation then
  raise notice 'OK     92. El legajo tiene que tener el formato de la UNLP (12345/6)';
end $$;

do $$ declare est text; v1 uuid; v2 uuid; begin
  update public.perfiles set legajo = '31234/5', whatsapp = '2215551234' where id = '00000000-0000-4000-8000-000000000011';
  -- El id lo pone la base (no se puede elegir): se guarda para las pruebas siguientes.
  insert into public.publicaciones_bolsa (usuario_id, tipo, titulo, categoria, precio_texto, estado_uso, ubicacion)
  values ('00000000-0000-4000-8000-000000000011', 'venta', 'Turbina Kavo', 'Instrumental', '$50.000', 'Usada', 'Facultad')
  returning id into v1;
  insert into public.publicaciones_bolsa (usuario_id, tipo, titulo, categoria, precio_texto, ubicacion)
  values ('00000000-0000-4000-8000-000000000011', 'compra', 'Busco articulador', 'Instrumental', 'Hasta $30.000', 'Facultad')
  returning id into v2;
  perform set_config('odontocampus.p1', v1::text, false);
  perform set_config('odontocampus.p2', v2::text, false);
  select estado into est from public.publicaciones_bolsa where id = current_setting('odontocampus.p1')::uuid;
  if est = 'pendiente' then raise notice 'OK     93. Con legajo y teléfono se publica, y queda pendiente de aprobación';
  else raise notice 'FALLA  93. La publicación quedó %', est; end if;
exception when others then
  raise notice 'FALLA  93. No se pudo publicar con los datos completos: %', sqlerrm;
end $$;

do $$ begin
  update public.publicaciones_bolsa set estado = 'activa' where id = current_setting('odontocampus.p1')::uuid;
  raise notice 'FALLA  94. Quien publica se aprueba solo';
exception when insufficient_privilege then
  raise notice 'OK     94. Quien publica no se aprueba solo';
end $$;

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000012","role":"authenticated"}', true);
end $$;

do $$ declare n int; begin
  select count(*) into n from public.publicaciones_bolsa where usuario_id = '00000000-0000-4000-8000-000000000011';
  if n = 0 then raise notice 'OK     95. Las pendientes no las ve nadie más';
  else raise notice 'FALLA  95. Otra cuenta ve % publicaciones pendientes', n; end if;
end $$;

do $$ begin
  perform public.admin_bolsa_pendientes();
  raise notice 'FALLA  96. Una cuenta común ve las pendientes de moderación';
exception when insufficient_privilege then
  raise notice 'OK     96. Una cuenta común no ve la cola de moderación';
end $$;

do $$ begin
  perform public.contacto_bolsa(current_setting('odontocampus.p1')::uuid);
  raise notice 'FALLA  97. Se obtiene el teléfono de una publicación sin aprobar';
exception when no_data_found then
  raise notice 'OK     97. El teléfono no se entrega mientras no esté aprobada';
end $$;

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
end $$;

do $$ declare leg text; begin
  select autor_legajo into leg from public.admin_bolsa_pendientes() where id = current_setting('odontocampus.p1')::uuid;
  if leg = '31234/5' then raise notice 'OK     98. Un admin ve las pendientes con el legajo para verificar';
  else raise notice 'FALLA  98. El listado de pendientes no trae el legajo (%)', leg; end if;
exception when others then
  raise notice 'FALLA  98. Un admin no pudo ver las pendientes: %', sqlerrm;
end $$;

do $$ begin
  perform public.admin_moderar_bolsa(current_setting('odontocampus.p2')::uuid, false, 'no');
  raise notice 'FALLA  99. Se rechaza sin motivo';
exception when check_violation then
  raise notice 'OK     99. Rechazar pide un motivo';
end $$;

do $$ declare est text; begin
  perform public.admin_moderar_bolsa(current_setting('odontocampus.p1')::uuid, true);
  perform public.admin_moderar_bolsa(current_setting('odontocampus.p2')::uuid, false, 'Falta el precio máximo');
  select estado into est from public.publicaciones_bolsa where id = current_setting('odontocampus.p1')::uuid;
  if est = 'activa' then raise notice 'OK     100. Un admin aprueba y rechaza publicaciones';
  else raise notice 'FALLA  100. La aprobada quedó %', est; end if;
exception when others then
  raise notice 'FALLA  100. No se pudo moderar: %', sqlerrm;
end $$;

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000012","role":"authenticated"}', true);
end $$;

do $$ declare n int; tel text; begin
  select count(*) into n from public.publicaciones_bolsa where usuario_id = '00000000-0000-4000-8000-000000000011';
  tel := public.contacto_bolsa(current_setting('odontocampus.p1')::uuid);
  if n = 1 and tel = '2215551234' then raise notice 'OK     101. La aprobada se ve y se puede contactar; la rechazada no se ve';
  else raise notice 'FALLA  101. Se ven % y el contacto dio %', n, tel; end if;
exception when others then
  raise notice 'FALLA  101. No se pudo ver o contactar la aprobada: %', sqlerrm;
end $$;

do $$ declare leg text; begin
  select legajo into leg from public.perfiles where id = '00000000-0000-4000-8000-000000000011';
  raise notice 'FALLA  102. Se lee el legajo de otra persona';
exception when insufficient_privilege then
  raise notice 'OK     102. El legajo de otra persona no se lee';
end $$;

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
end $$;

do $$ declare est text; begin
  update public.publicaciones_bolsa set precio_texto = '$1' where id = current_setting('odontocampus.p1')::uuid;
  select estado into est from public.publicaciones_bolsa where id = current_setting('odontocampus.p1')::uuid;
  if est = 'pendiente' then raise notice 'OK     103. Cambiar el contenido la vuelve a revisión';
  else raise notice 'FALLA  103. Después de editarla quedó %', est; end if;
exception when others then
  raise notice 'FALLA  103. No se pudo editar la propia: %', sqlerrm;
end $$;

reset role;

-- ==========================================================================
-- NOMBRE Y APELLIDO (010)
-- I se registra con nombre y apellido; H (común) intenta leerlos; D administra.
-- ==========================================================================
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000013', 'perfil-i@odontocampus.invalid', now(),
   '{"nombre_visible":"Tomi","nombre":"Tomás","apellido":"Zapiola"}'),
  ('00000000-0000-4000-8000-000000000014', 'perfil-j@odontocampus.invalid', now(),
   '{"nombre_visible":"Juli","nombre":"J","apellido":""}');

do $$ declare n text; a text; v text; begin
  select nombre, apellido, nombre_visible into n, a, v from public.perfiles where id = '00000000-0000-4000-8000-000000000013';
  if n = 'Tomás' and a = 'Zapiola' and v = 'Tomi' then raise notice 'OK     104. Al registrarse quedan el nombre, el apellido y cómo quiere que la llamen';
  else raise notice 'FALLA  104. El perfil quedó con % / % / %', n, a, v; end if;
end $$;

do $$ declare n text; a text; begin
  select nombre, apellido into n, a from public.perfiles where id = '00000000-0000-4000-8000-000000000014';
  if n is null and a is null then raise notice 'OK     105. Un nombre o apellido inválido no frena el alta: queda vacío y se pide después';
  else raise notice 'FALLA  105. Quedaron % / %', n, a; end if;
end $$;

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000012","role":"authenticated"}', true);
end $$;

do $$ declare a text; begin
  select apellido into a from public.perfiles where id = '00000000-0000-4000-8000-000000000013';
  raise notice 'FALLA  106. Se lee el apellido de otra persona';
exception when insufficient_privilege then
  raise notice 'OK     106. El nombre y apellido de otra persona no se leen';
end $$;

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000014","role":"authenticated"}', true);
end $$;

do $$ begin
  update public.perfiles set nombre = 'J' where id = '00000000-0000-4000-8000-000000000014';
  raise notice 'FALLA  107. Se guardó un nombre de una letra';
exception when check_violation then
  raise notice 'OK     107. El nombre necesita al menos 2 letras';
end $$;

do $$ declare n int; r jsonb; begin
  update public.perfiles set nombre = 'Julieta', apellido = 'Ferreyra', nombre_visible = 'Juli'
  where id = '00000000-0000-4000-8000-000000000014';
  get diagnostics n = row_count;
  select to_jsonb(m) into r from public.mi_perfil() m;
  if n = 1 and r ->> 'apellido' = 'Ferreyra' then raise notice 'OK     108. Cada quien completa su nombre y apellido, y los ve en mi_perfil';
  else raise notice 'FALLA  108. No se completó el perfil (% filas, %)', n, r ->> 'apellido'; end if;
exception when others then
  raise notice 'FALLA  108. No se pudo completar el perfil: %', sqlerrm;
end $$;

do $$ declare n int; begin
  update public.perfiles set apellido = 'Otro' where id = '00000000-0000-4000-8000-000000000013';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'OK     109. No se cambia el nombre de otra persona';
  else raise notice 'FALLA  109. Se cambió el apellido de otra persona'; end if;
exception when insufficient_privilege then
  raise notice 'OK     109. No se cambia el nombre de otra persona';
end $$;

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
end $$;

do $$ declare n text; begin
  select nombre into n from public.admin_listar_usuarios('Zapiola', 10, 0) limit 1;
  if n = 'Tomás Zapiola' then raise notice 'OK     110. El panel busca por apellido y muestra nombre y apellido';
  else raise notice 'FALLA  110. El panel devolvió %', n; end if;
exception when others then
  raise notice 'FALLA  110. El panel no pudo listar: %', sqlerrm;
end $$;

reset role;

-- ==========================================================================
-- EXPORTAR CUENTAS (011)
-- ==========================================================================
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000012","role":"authenticated"}', true);
end $$;

do $$ begin
  perform public.admin_exportar_cuentas();
  raise notice 'FALLA  111. Una cuenta común exporta los datos de todas';
exception when insufficient_privilege then
  raise notice 'OK     111. Una cuenta común no puede exportar las cuentas';
end $$;

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
end $$;

do $$ declare correo text; n int; begin
  select e.email into correo from public.admin_exportar_cuentas() e
  where e.nombre = 'Tomás' and e.apellido = 'Zapiola';
  select count(*) into n from public.admin_registro(50) r where r.accion = 'exportar_cuentas';
  if correo = 'perfil-i@odontocampus.invalid' and n >= 1 then
    raise notice 'OK     112. Un admin exporta nombre, apellido y correo, y queda en el registro';
  else raise notice 'FALLA  112. Exportó % y el registro tiene % descargas', correo, n; end if;
exception when others then
  raise notice 'FALLA  112. Un admin no pudo exportar: %', sqlerrm;
end $$;

reset role;

rollback;

\echo
\echo 'Pruebas terminadas (00 a 112). Todo se deshizo con ROLLBACK: no quedó nada en la base.'
\echo 'Si alguna línea dice FALLA, no publiques el cambio en el sitio.'
