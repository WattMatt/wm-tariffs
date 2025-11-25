import React from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  // Parse markdown images and render them
  const renderContent = () => {
    // Check if this is a markdown image
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const match = imageRegex.exec(content);
    
    if (match) {
      const [fullMatch, altText, imageUrl] = match;
      return (
        <div className={`flex flex-col gap-2 ${className}`}>
          <img 
            src={imageUrl} 
            alt={altText} 
            className="w-full h-auto rounded-lg border shadow-sm"
          />
          {altText && (
            <p className="text-sm text-center text-muted-foreground italic">
              {altText}
            </p>
          )}
        </div>
      );
    }
    
    // Regular markdown text - split by headers and paragraphs
    const lines = content.split('\n');
    return (
      <div className={`prose prose-sm max-w-none ${className}`}>
        {lines.map((line, index) => {
          if (line.startsWith('# ')) {
            return <h1 key={index} className="text-2xl font-bold mt-6 mb-4">{line.substring(2)}</h1>;
          } else if (line.startsWith('## ')) {
            return <h2 key={index} className="text-xl font-bold mt-5 mb-3">{line.substring(3)}</h2>;
          } else if (line.startsWith('### ')) {
            return <h3 key={index} className="text-lg font-semibold mt-4 mb-2">{line.substring(4)}</h3>;
          } else if (line.startsWith('**') && line.endsWith('**')) {
            return <p key={index} className="font-semibold my-2">{line.substring(2, line.length - 2)}</p>;
          } else if (line.trim()) {
            return <p key={index} className="my-2">{line}</p>;
          }
          return <br key={index} />;
        })}
      </div>
    );
  };
  
  return <>{renderContent()}</>;
}
