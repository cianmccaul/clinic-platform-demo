/** Demo only: production makes the invoice PDF here (pdf-lib). The demo has no server data to make it from. */
export function GET() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice PDF · Northbank demo</title>
<style>body{font-family:system-ui,sans-serif;background:#F2F7F5;color:#13302B;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;border-radius:16px;padding:32px;max-width:440px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 8px}p{line-height:1.5;margin:0}</style></head>
<body><main><h1>Invoice PDFs aren't in the demo</h1><p>In the real system this opens the invoice or credit note as a PDF: the clinic's details, the therapist and their insurance reference numbers, the treatment, and "paid".</p></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
