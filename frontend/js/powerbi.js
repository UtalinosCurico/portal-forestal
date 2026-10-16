export async function initPowerBIView(context) {
  const messageEl = document.getElementById("powerbi-access-message");
  const wrapper = document.getElementById("powerbi-wrapper");
  const frame = document.getElementById("powerbi-frame");

  function mostrarMensaje(texto) {
    messageEl.textContent = texto;
    messageEl.classList.remove("hidden");
    wrapper.classList.add("hidden");
    // Se vacia el iframe: si no, al cambiar de empresa quedaria en pantalla el
    // informe de la anterior detras del mensaje.
    frame.src = "";
  }

  try {
    const payload = await context.apiRequest("/api/powerbi");
    const powerbi = payload.powerbi;

    // Cada empresa tiene su propio informe. Si a esta todavia no le cargaron
    // uno, se dice con todas sus letras en vez de dejar un recuadro en blanco.
    if (!powerbi?.src) {
      mostrarMensaje(payload.mensaje || "Todavía no hay un informe de Power BI para esta empresa.");
      return;
    }

    frame.src = powerbi.src;
    frame.title = powerbi.title || "Power BI";
    messageEl.classList.add("hidden");
    wrapper.classList.remove("hidden");
  } catch (error) {
    mostrarMensaje(error.message || "No se pudo cargar Power BI");
  }
}
