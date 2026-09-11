-- ==========================================================================
-- OdontoCampus — Pruebas de seguridad del esquema (RLS y permisos)
--
-- Correr DESPUÉS de aplicar todas las migraciones (001, 002, ...), y otra
-- vez después de cualquier cambio:
--
--   cd /opt/supabase
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < /home/odontocampus/htdocs/odontocampus.com.ar/infra/supabase/sql/pruebas_rls.sql
--
-- --------------------------------------------------------------------------
-- Todo corre dentro de UNA transacción que termina en ROLLBACK: crea dos
-- usuarios de prueba, intenta lo que intentaría alguien con malas
-- intenciones y deshace todo. No queda nada en la base, ni siquiera si el
-- script se corta a mitad de camino.
--
-- Cada prueba imprime OK o FALLA.
-- UNA SOLA FALLA ES UN AGUJERO DE SEGURIDAD: las cuentas no se habilitan en
-- el sitio hasta que todas digan OK.
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

insert into public.notas_academicas (usuario_id, payload_cifrado, sal)
values ('00000000-0000-4000-8000-00000000000b', 'v1.cifrado-de-b', repeat('s', 24));

do $$ begin
  if (select count(*) from public.perfiles
      where id in ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b')) = 2 then
    raise notice 'OK     00. Al registrarse se crea el perfil automáticamente';
  else
    raise notice 'FALLA  00. El registro no creó los perfiles';
  end if;
end $$;


-- ==========================================================================
-- SIN SESIÓN (anon): lo que puede hacer cualquiera con la clave pública
-- ==========================================================================
set local role anon;
do $$ begin perform set_config('request.jwt.claims', '{"role":"anon"}', true); end $$;

do $$ begin
  perform count(*) from public.perfiles;
  raise notice 'FALLA  01. Sin sesión se pueden leer los perfiles';
exception when insufficient_privilege then
  raise notice 'OK     01. Sin sesión no se leen los perfiles';
end $$;

do $$ begin
  perform count(*) from public.notas_academicas;
  raise notice 'FALLA  02. Sin sesión se puede leer la tabla de notas';
exception when insufficient_privilege then
  raise notice 'OK     02. Sin sesión no se lee la tabla de notas';
end $$;

do $$ begin
  perform public.eliminar_mi_cuenta();
  raise notice 'FALLA  03. Sin sesión se puede llamar a eliminar_mi_cuenta';
exception
  when insufficient_privilege then
    raise notice 'OK     03. Sin sesión no se puede llamar a eliminar_mi_cuenta';
  when others then
    raise notice 'FALLA  03. eliminar_mi_cuenta es ejecutable sin sesión (%)', sqlerrm;
end $$;

do $$ begin
  perform public.puedo_publicar();
  raise notice 'FALLA  04. Sin sesión se puede llamar a puedo_publicar';
exception when insufficient_privilege then
  raise notice 'OK     04. Sin sesión no se puede llamar a puedo_publicar';
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
  if n = 1 then raise notice 'OK     05. Cada quien edita su propio nombre';
  else raise notice 'FALLA  05. No se pudo editar el propio nombre (% filas)', n; end if;
exception when others then
  raise notice 'FALLA  05. No se pudo editar el propio nombre: %', sqlerrm;
end $$;

do $$ begin
  update public.perfiles set estado = 'activo'
  where id = '00000000-0000-4000-8000-00000000000a';
  raise notice 'FALLA  06. Un usuario puede cambiar su estado (se reactivaría tras una suspensión)';
exception when insufficient_privilege then
  raise notice 'OK     06. Un usuario no puede cambiar su propio estado';
end $$;

do $$ begin
  update public.perfiles set puede_publicar_desde = now() - interval '1 day'
  where id = '00000000-0000-4000-8000-00000000000a';
  raise notice 'FALLA  07. Un usuario puede saltearse la espera de 24 h';
exception when insufficient_privilege then
  raise notice 'OK     07. Un usuario no puede saltearse la espera de 24 h';
end $$;

do $$ declare n int; begin
  update public.perfiles set whatsapp = '2215550000'
  where id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n = 1 then raise notice 'OK     08. Cada quien carga su propio WhatsApp';
  else raise notice 'FALLA  08. No se pudo cargar el propio WhatsApp (% filas)', n; end if;
exception when others then
  raise notice 'FALLA  08. No se pudo cargar el propio WhatsApp: %', sqlerrm;
end $$;

do $$ declare n int; begin
  select count(*) into n from public.perfiles
  where id = '00000000-0000-4000-8000-00000000000b' and nombre_visible is not null;
  if n = 1 then raise notice 'OK     09. Se ve el nombre de otra persona (para mostrar quién publica)';
  else raise notice 'FALLA  09. No se ve el nombre de otra persona'; end if;
exception when others then
  raise notice 'FALLA  09. No se ve el nombre de otra persona: %', sqlerrm;
end $$;

do $$ begin
  perform whatsapp from public.perfiles
  where id = '00000000-0000-4000-8000-00000000000b';
  raise notice 'FALLA  10. Se ve el WhatsApp de otra persona';
exception when insufficient_privilege then
  raise notice 'OK     10. No se ve el WhatsApp de otra persona';
end $$;

do $$ declare n int; begin
  select count(*) into n from public.mi_perfil() where whatsapp = '2215550000';
  if n = 1 then raise notice 'OK     11. Cada quien ve su perfil completo con mi_perfil()';
  else raise notice 'FALLA  11. mi_perfil() no devolvió el perfil propio completo'; end if;
exception when others then
  raise notice 'FALLA  11. mi_perfil() falló: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- notas
do $$ declare n int; begin
  select count(*) into n from public.notas_academicas
  where usuario_id = '00000000-0000-4000-8000-00000000000b';
  if n = 0 then raise notice 'OK     12. No se ven las notas de otra persona';
  else raise notice 'FALLA  12. Se ven las notas de otra persona'; end if;
exception when others then
  raise notice 'FALLA  12. Error inesperado al leer notas: %', sqlerrm;
end $$;

do $$ begin
  insert into public.notas_academicas (usuario_id, payload_cifrado, sal)
  values ('00000000-0000-4000-8000-00000000000b', 'v1.falso', repeat('s', 24));
  raise notice 'FALLA  13. Se pueden guardar notas a nombre de otra persona';
exception
  when insufficient_privilege then
    raise notice 'OK     13. No se guardan notas a nombre de otra persona';
  when unique_violation then
    raise notice 'FALLA  13. El intento llegó hasta la tabla (lo frenó la clave primaria, no la seguridad)';
end $$;

-- ---------------------------------------------------------------- bolsa
do $$ begin
  insert into public.publicaciones_bolsa (usuario_id, titulo, categoria, precio_texto, estado_uso, ubicacion)
  values ('00000000-0000-4000-8000-00000000000a', 'Turbina de prueba', 'Instrumental', '$10.000', 'Usada', 'Hall');
  raise notice 'FALLA  14. Una cuenta recién creada puede publicar';
exception when insufficient_privilege then
  raise notice 'OK     14. Una cuenta recién creada no puede publicar en las primeras 24 h';
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
  if n = 1 then raise notice 'OK     15. Pasadas las 24 h se puede publicar';
  else raise notice 'FALLA  15. Pasadas las 24 h no se pudo publicar'; end if;
exception when others then
  raise notice 'FALLA  15. Pasadas las 24 h no se pudo publicar: %', sqlerrm;
end $$;

-- Con una sola publicación activa: lo único que puede frenar esto es el
-- permiso de columna (el límite de 5 todavía no aplica).
do $$ begin
  insert into public.publicaciones_bolsa (usuario_id, titulo, categoria, precio_texto, estado_uso, ubicacion, expira_at)
  values ('00000000-0000-4000-8000-00000000000a', 'Turbina eterna', 'Instrumental', '$1', 'Usada', 'Hall', now() + interval '50 years');
  raise notice 'FALLA  16. Se puede publicar con vencimiento a elección';
exception when insufficient_privilege then
  raise notice 'OK     16. No se puede elegir el vencimiento de una publicación';
end $$;

do $$ declare n int; begin
  insert into public.publicaciones_bolsa (usuario_id, titulo, categoria, precio_texto, estado_uso, ubicacion) values
    ('00000000-0000-4000-8000-00000000000a', 'Articulo 2', 'Instrumental', '$1', 'Usado', 'Hall'),
    ('00000000-0000-4000-8000-00000000000a', 'Articulo 3', 'Instrumental', '$1', 'Usado', 'Hall'),
    ('00000000-0000-4000-8000-00000000000a', 'Articulo 4', 'Instrumental', '$1', 'Usado', 'Hall'),
    ('00000000-0000-4000-8000-00000000000a', 'Articulo 5', 'Instrumental', '$1', 'Usado', 'Hall');
  get diagnostics n = row_count;
  if n = 4 then raise notice 'OK     17. Se puede llegar a 5 publicaciones activas';
  else raise notice 'FALLA  17. No se pudo llegar a 5 publicaciones activas (% filas)', n; end if;
exception when others then
  raise notice 'FALLA  17. No se pudo llegar a 5 publicaciones activas: %', sqlerrm;
end $$;

-- Inserción múltiple: con la versión anterior del límite, esto pasaba.
do $$ begin
  insert into public.publicaciones_bolsa (usuario_id, titulo, categoria, precio_texto, estado_uso, ubicacion) values
    ('00000000-0000-4000-8000-00000000000a', 'Articulo 6', 'Instrumental', '$1', 'Usado', 'Hall'),
    ('00000000-0000-4000-8000-00000000000a', 'Articulo 7', 'Instrumental', '$1', 'Usado', 'Hall');
  raise notice 'FALLA  18. Se superó el límite de 5 publicaciones con una inserción múltiple';
exception when insufficient_privilege then
  raise notice 'OK     18. No se supera el límite de 5, ni con una inserción múltiple';
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
  if n = 0 then raise notice 'OK     19. No se reactiva una publicación ocultada por moderación';
  else raise notice 'FALLA  19. Se reactivó una publicación ocultada por moderación'; end if;
exception when others then
  raise notice 'OK     19. No se reactiva una publicación ocultada por moderación (%)', sqlerrm;
end $$;

do $$ declare n int; begin
  delete from public.publicaciones_bolsa
  where usuario_id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'OK     20. No se borra una publicación ocultada por moderación';
  else raise notice 'FALLA  20. Se borró una publicación ocultada por moderación'; end if;
exception when others then
  raise notice 'OK     20. No se borra una publicación ocultada por moderación (%)', sqlerrm;
end $$;

-- ---------------------------------------------------------------- consentimientos
do $$ declare n int; begin
  insert into public.consentimientos (usuario_id, tipo, version_texto)
  values ('00000000-0000-4000-8000-00000000000a', 'sincronizar_notas', 'prueba');
  get diagnostics n = row_count;
  if n = 1 then raise notice 'OK     21. Se registra el propio consentimiento';
  else raise notice 'FALLA  21. No se pudo registrar el consentimiento'; end if;
exception when others then
  raise notice 'FALLA  21. No se pudo registrar el consentimiento: %', sqlerrm;
end $$;

do $$ begin
  insert into public.consentimientos (usuario_id, tipo, version_texto, otorgado_at)
  values ('00000000-0000-4000-8000-00000000000a', 'terminos', 'prueba', now() - interval '2 years');
  raise notice 'FALLA  22. Se puede antedatar un consentimiento';
exception when insufficient_privilege then
  raise notice 'OK     22. No se puede antedatar un consentimiento';
end $$;

-- ---------------------------------------------------------------- eliminar cuenta
do $$ begin
  perform public.eliminar_mi_cuenta();
  raise notice 'OK     23. Se puede eliminar la propia cuenta';
exception when others then
  raise notice 'FALLA  23. No se pudo eliminar la propia cuenta: %', sqlerrm;
end $$;

reset role;

do $$ begin
  if not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-00000000000a')
     and not exists (select 1 from public.perfiles where id = '00000000-0000-4000-8000-00000000000a')
     and not exists (select 1 from public.publicaciones_bolsa where usuario_id = '00000000-0000-4000-8000-00000000000a')
     and not exists (select 1 from public.consentimientos where usuario_id = '00000000-0000-4000-8000-00000000000a')
     and exists (select 1 from auth.users where id = '00000000-0000-4000-8000-00000000000b')
     and exists (select 1 from public.notas_academicas where usuario_id = '00000000-0000-4000-8000-00000000000b')
  then
    raise notice 'OK     24. Eliminar la cuenta borra todo lo suyo y nada de nadie más';
  else
    raise notice 'FALLA  24. La eliminación dejó datos propios o tocó datos ajenos';
  end if;
end $$;

rollback;

\echo
\echo 'Pruebas terminadas (00 a 24). Todo se deshizo con ROLLBACK: no quedó nada en la base.'
\echo 'Si alguna línea dice FALLA, no habilites las cuentas en el sitio.'
