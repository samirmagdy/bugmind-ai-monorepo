import React from 'react';

interface JiraMarkdownProps {
  content: string;
  className?: string;
}

const JiraMarkdown: React.FC<JiraMarkdownProps> = ({ content, className = "" }) => {
  if (!content) return null;

  const parseContent = (text: string) => {
    const lines = text.split('\n');
    const result: React.ReactNode[] = [];
    
    let currentList: { type: 'ul' | 'ol'; items: React.ReactNode[] } | null = null;

    const flushList = (key: number) => {
      if (currentList) {
        const ListTag = currentList.type;
        result.push(
          <ListTag key={`list-${key}`} className={ListTag === 'ul' ? "list-disc ml-6 my-2 space-y-1" : "list-decimal ml-6 my-2 space-y-1"}>
            {currentList.items.map((item, i) => <li key={i} className="pl-1">{item}</li>)}
          </ListTag>
        );
        currentList = null;
      }
    };

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      
      // Match Numbered List:  # Step text
      const olMatch = line.match(/^(\s*)#\s+(.*)/);
      // Match Bullet List:  * Item text
      const ulMatch = line.match(/^(\s*)\*\s+(.*)/);

      if (olMatch) {
        if (!currentList || currentList.type !== 'ol') {
          flushList(index);
          currentList = { type: 'ol', items: [] };
        }
        currentList.items.push(renderInline(olMatch[2]));
      } else if (ulMatch) {
        if (!currentList || currentList.type !== 'ul') {
          flushList(index);
          currentList = { type: 'ul', items: [] };
        }
        currentList.items.push(renderInline(ulMatch[2]));
      } else {
        flushList(index);
        if (trimmedLine) {
          result.push(<p key={index} className="mb-3 last:mb-0 leading-relaxed">{renderInline(trimmedLine)}</p>);
        } else {
          result.push(<div key={index} className="h-2" />);
        }
      }
    });

    flushList(lines.length);
    return result;
  };

  const renderInline = (text: string) => {
    // Basic regex for bold (*text*) and italic (_text_)
    // We split by tokens to maintain Order
    const parts = text.split(/(\*[^*]+\*|_[^_]+_)/g);
    
    return parts.map((part, i) => {
      if (part.startsWith('*') && part.endsWith('*')) {
        return <strong key={i} className="font-black text-[var(--text-main)]">{part.slice(1, -1)}</strong>;
      }
      if (part.startsWith('_') && part.endsWith('_')) {
        return <em key={i} className="italic opacity-90">{part.slice(1, -1)}</em>;
      }
      return part;
    });
  };

  return (
    <div className={`text-xs text-[var(--text-main)]/90 selection:bg-[var(--status-info)]/20 ${className}`}>
      {parseContent(content)}
    </div>
  );
};

export default JiraMarkdown;
