import fs from 'node:fs/promises';
import path from 'node:path';

export default async function Page() {
  const html = await fs.readFile(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
