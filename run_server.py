"""
Servidor local de desarrollo para OdontoCampus (FOE Odontologia UNLP).

Uso:
    python run_server.py            # arranca en el puerto 8080
    python run_server.py 3000       # arranca en otro puerto

Envia cabeceras "no-cache": mientras se trabaja en el sitio, el navegador
siempre pide la ultima version de cada CSS y cada JS. Sin esto uno edita un
archivo, recarga y sigue viendo el anterior, y termina depurando un fantasma.
"""
import http.server
import os
import socketserver
import sys
import webbrowser

RAIZ = os.path.dirname(os.path.abspath(__file__))
# El sitio vive en public/. Es exactamente lo que se sube a htdocs/ en
# el servidor: nada de docs/ ni infra/ llega nunca al navegador.
DIRECTORY = os.path.join(RAIZ, "public")
DEFAULT_PORT = 8080


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def guess_type(self, path):
        # Aseguramos UTF-8 explicito: los textos del sitio estan en espanol
        # con acentos y algunos navegadores adivinan mal sin esta cabecera.
        base = super().guess_type(path)
        if base in ("text/html", "text/css", "text/javascript", "application/javascript"):
            return base + "; charset=utf-8"
        return base

    def log_message(self, fmt, *args):
        # Silenciamos los 200 para que en la consola solo se vean los errores
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


class DevServer(socketserver.ThreadingTCPServer):
    """Servidor multihilo.

    Con un servidor de un solo hilo, el navegador abre varias conexiones a la
    vez (HTML, cinco CSS, siete JS) y quedan encoladas: la pagina tarda o se
    cuelga. Ademas silenciamos los cortes de conexion del navegador, que son
    normales al recargar y solo ensucian la consola con trazas alarmantes.
    """

    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        error = sys.exc_info()[1]
        if isinstance(error, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def main():
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"Puerto invalido: {sys.argv[1]}. Uso el {DEFAULT_PORT}.")

    os.chdir(DIRECTORY)

    try:
        httpd = DevServer(("", port), Handler)
    except OSError as error:
        print(f"No se pudo abrir el puerto {port}: {error}")
        print("Probablemente ya haya un servidor corriendo. Cerralo o usa otro puerto.")
        return 1

    url = f"http://localhost:{port}/index.html"
    print("=" * 56)
    print("  OdontoCampus - FOE Odontologia UNLP")
    print(f"  Servidor listo en: {url}")
    print("  Ctrl+C para detenerlo")
    print("=" * 56)

    try:
        webbrowser.open(url)
    except Exception:
        pass

    with httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
