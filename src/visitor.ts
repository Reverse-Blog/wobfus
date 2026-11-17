fetch("https://visitor.reverse.blog", {
  method: "POST",
  headers: { "Content-Type": "text/plain;charset=UTF-8" },
  body: JSON.stringify({
    url: window.location.href,
    languages: navigator.languages,
    referrer: document.referrer ? new URL(document.referrer).origin : "",
  }),
  keepalive: true,
})
  .then((response) => {
    if (!response.ok) console.error("Visitor notification failed:", response.status);
  })
  .catch(() => console.error("Could not reach the visitor Worker."));
