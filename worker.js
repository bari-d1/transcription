export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/transcription")) {
      const renderUrl = new URL(request.url);
      renderUrl.hostname = "transcription-51bm.onrender.com";
      renderUrl.port = "";

      return fetch(renderUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "follow",
      });
    }

    // All other requests pass through to your main site
    return fetch(request);
  },
};
