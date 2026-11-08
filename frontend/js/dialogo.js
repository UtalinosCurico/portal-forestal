// Dialogo de confirmacion con el estilo del portal.
//
// Reemplaza a window.confirm: la ventana nativa no se puede estilizar, en el
// celular parece un error del sistema, no distingue una accion que borra
// datos de una que no, y bloquea toda la pagina mientras esta abierta.
//
// Uso:  if (!(await confirmar({ titulo, mensaje, aceptar, peligro }))) return;
// Los textos se ponen con textContent: un nombre de usuario con "<" no se
// interpreta como HTML.

const ICONO_PELIGRO =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>';
const ICONO_PREGUNTA =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';

let dialogoAbierto = null;
let contador = 0;

export function confirmar({
  titulo = "¿Confirmas esta acción?",
  mensaje = "",
  aceptar = "Confirmar",
  cancelar = "Cancelar",
  peligro = false,
} = {}) {
  // Si quedara uno abierto (doble clic, por ejemplo), se cancela ese.
  dialogoAbierto?.cerrar(false);

  return new Promise((resolve) => {
    const focoAnterior = document.activeElement;
    const idTitulo = `dialogo-titulo-${++contador}`;
    const idMensaje = `dialogo-mensaje-${contador}`;

    const raiz = document.createElement("div");
    raiz.className = "modal dialogo";
    raiz.setAttribute("role", "alertdialog");
    raiz.setAttribute("aria-modal", "true");
    raiz.setAttribute("aria-labelledby", idTitulo);
    raiz.innerHTML = `
      <div class="modal-backdrop" data-dialogo-cancelar></div>
      <section class="modal-content dialogo-caja">
        <div class="dialogo-icono${peligro ? " es-peligro" : ""}" aria-hidden="true">
          ${peligro ? ICONO_PELIGRO : ICONO_PREGUNTA}
        </div>
        <h4 class="dialogo-titulo" id="${idTitulo}"></h4>
        <p class="dialogo-mensaje" id="${idMensaje}"></p>
        <div class="dialogo-acciones">
          <button type="button" class="action-btn secondary dialogo-cancelar" data-dialogo-cancelar></button>
          <button type="button" class="action-btn dialogo-aceptar${peligro ? " es-peligro" : ""}" data-dialogo-aceptar></button>
        </div>
      </section>
    `;

    raiz.querySelector(".dialogo-titulo").textContent = titulo;
    const parrafo = raiz.querySelector(".dialogo-mensaje");
    if (mensaje) {
      parrafo.textContent = mensaje;
      raiz.setAttribute("aria-describedby", idMensaje);
    } else {
      parrafo.remove();
    }
    const botonCancelar = raiz.querySelector(".dialogo-cancelar");
    const botonAceptar = raiz.querySelector(".dialogo-aceptar");
    botonCancelar.textContent = cancelar;
    botonAceptar.textContent = aceptar;

    function alPresionarTecla(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cerrar(false);
        return;
      }
      // El foco no sale del dialogo mientras esta abierto.
      if (event.key === "Tab") {
        const botones = [botonCancelar, botonAceptar];
        const indice = botones.indexOf(document.activeElement);
        event.preventDefault();
        const siguiente = event.shiftKey ? indice - 1 : indice + 1;
        botones[(siguiente + botones.length) % botones.length].focus();
      }
    }

    function cerrar(valor) {
      if (!raiz.isConnected) return;
      document.removeEventListener("keydown", alPresionarTecla, true);
      raiz.remove();
      dialogoAbierto = null;
      if (focoAnterior && typeof focoAnterior.focus === "function" && focoAnterior.isConnected) {
        focoAnterior.focus({ preventScroll: true });
      }
      resolve(valor);
    }

    raiz.addEventListener("click", (event) => {
      if (event.target.closest("[data-dialogo-aceptar]")) {
        cerrar(true);
      } else if (event.target.closest("[data-dialogo-cancelar]")) {
        cerrar(false);
      }
    });
    document.addEventListener("keydown", alPresionarTecla, true);

    document.body.appendChild(raiz);
    dialogoAbierto = { cerrar };
    // En las acciones que borran, el foco parte en "Cancelar": un Enter
    // apurado no debe borrar nada.
    (peligro ? botonCancelar : botonAceptar).focus({ preventScroll: true });
  });
}
