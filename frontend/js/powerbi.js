export async function initPowerBIView(context) {
  const messageEl = document.getElementById("powerbi-access-message");
  const wrapper = document.getElementById("powerbi-wrapper");
  const frame = document.getElementById("powerbi-frame");

  try {
    const payload = await context.apiRequest("/api/powerbi");
    frame.src = payload.powerbi?.src || "";
    frame.title = payload.powerbi?.title || "Power BI";
    messageEl.classList.add("hidden");
    wrapper.classList.remove("hidden");
  } catch (error) {
    messageEl.textContent = error.message || "No se pudo cargar Power BI";
    messageEl.classList.remove("hidden");
    wrapper.classList.add("hidden");
  }
}
