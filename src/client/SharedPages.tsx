import { FileText } from 'lucide-react';
// Pages shared through Agent Contacts, shown exactly as sent or as they
// will be sent. Content is plain text: it may come from another person.
export function SharedPages({
  pages,
  label = 'Shared pages',
}: {
  pages: { title: string; content: string; revision: number }[];
  label?: string;
}) {
  if (!pages.length) return null;
  return (
    <div className="shared-pages">
      <strong>{label}</strong>
      {pages.map((page, index) => (
        <details key={`${page.title}-${page.revision}-${index}`}>
          <summary>
            <FileText size={14} />
            <span>{page.title}</span>
            <small>
              Version {page.revision} · {page.content.length.toLocaleString()}{' '}
              characters
            </small>
          </summary>
          <pre>{page.content || '(empty page)'}</pre>
        </details>
      ))}
    </div>
  );
}
