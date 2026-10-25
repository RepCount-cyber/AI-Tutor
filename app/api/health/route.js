export async function GET() {
  return Response.json({ ok: true, app: 'family-tutor', framework: 'nextjs' });
}
