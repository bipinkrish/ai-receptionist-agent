/** Inject runtime config into public/index.html (safe JSON, any key chars). */
export function injectAppConfig(html, config) {
  const json = JSON.stringify({
    apiBase: (config.apiBase ?? "").replace(/\/$/, ""),
    vapiPublicKey: config.vapiPublicKey ?? "",
    vapiAssistantId: config.vapiAssistantId ?? "",
  });
  return html.replace("<!--APP_CONFIG-->", json);
}
